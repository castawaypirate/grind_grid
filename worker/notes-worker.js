// Saves day notes (notes.json), meetings (meetings.json) and goals (goals.json) in the repo, so the GitHub key never reaches a browser.
// Secrets (set with `wrangler secret put`): GITHUB_TOKEN, NOTES_PASSCODE.
// PASSCODE_LIMITER (wrangler.toml) caps passcode attempts, so the passcode can't be found by trying many.
const CONTENTS_URL = 'https://api.github.com/repos/castawaypirate/grind_grid/contents/';
const BRANCH = 'main';
const USERNAMES = new Set(['castawaypirate', 'barbalias', 'Spl4sssh', 'jimmy_hawkins']);
const MAX_NOTE_LENGTH = 200;
const MAX_SAVE_ATTEMPTS = 3;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const GOAL_KINDS = new Set(['week', 'month', 'custom']);
const MAX_CUSTOM_GOALS = 3;
const CUSTOM_MONTHS_AHEAD = 3;
// The group's time zone (common.js and fetch-data.js have the same setting): "this week" and "today" are its days.
const GROUP_TIME_ZONE = 'Europe/Athens';
const ALLOWED_ORIGIN = /^(https:\/\/castawaypirate\.github\.io|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_ORIGIN.test(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Notes-Passcode',
    'Vary': 'Origin'
  };
}

function json(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request) }
  });
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Compares hashes so the check takes the same time however much of the passcode is right.
async function passcodeMatches(request, env) {
  const given = await sha256(request.headers.get('X-Notes-Passcode') || '');
  const expected = await sha256(env.NOTES_PASSCODE || '');
  let diff = env.NOTES_PASSCODE ? 0 : 1;
  for (let i = 0; i < given.length; i++) diff |= given[i] ^ expected[i];
  return diff === 0;
}

function githubHeaders(env) {
  return {
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'grind-grid-notes-worker'
  };
}

function decodeContent(base64) {
  const bytes = Uint8Array.from(atob(base64.replace(/\s/g, '')), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function encodeContent(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n');
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// A file that doesn't exist yet reads as empty, and the first save creates it.
async function readJsonFile(env, file) {
  const res = await fetch(CONTENTS_URL + file + '?ref=' + BRANCH, { headers: githubHeaders(env) });
  if (res.status === 404) return { data: {}, sha: undefined };
  if (!res.ok) throw new Error('GitHub read of ' + file + ' failed: HTTP ' + res.status);
  const body = await res.json();
  return { data: decodeContent(body.content), sha: body.sha };
}

function applyNote(notes, username, date, text) {
  const days = { ...notes[username] };
  if (text) days[date] = text;
  else delete days[date];

  const updated = { ...notes };
  delete updated[username];
  const sortedDates = Object.keys(days).sort();
  if (sortedDates.length) {
    updated[username] = Object.fromEntries(sortedDates.map(d => [d, days[d]]));
  }
  return updated;
}

// change(data) returns the new contents, or null when there is nothing to write. Returns the file's contents after.
async function updateJsonFile(env, file, message, change) {
  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
    const { data, sha } = await readJsonFile(env, file);
    const updated = change(data);
    if (!updated) return data;

    const res = await fetch(CONTENTS_URL + file, {
      method: 'PUT',
      headers: { ...githubHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: encodeContent(updated), sha, branch: BRANCH })
    });
    if (res.ok) return updated;
    // 409 (or 422 when two saves race to create the file) means someone else changed it after we read it, so read it again.
    if (res.status !== 409 && res.status !== 422) throw new Error('GitHub write of ' + file + ' failed: HTTP ' + res.status);
  }
  throw new Error('GitHub write of ' + file + ' kept conflicting');
}

function sortedByKey(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
}

function applyMeeting(meetings, date, time, from) {
  const updated = { ...meetings };
  if (from) delete updated[from];
  if (time) updated[date] = time;
  else delete updated[date];
  return sortedByKey(updated);
}

function meetingMessage(date, time, from) {
  if (!time) return `chore: remove meeting on ${date}`;
  if (from && from !== date) return `chore: move meeting from ${from} to ${date} at ${time}`;
  return `chore: set meeting on ${date} at ${time}`;
}

function isRealDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return !isNaN(parsed) && parsed.toISOString().slice(0, 10) === date;
}

async function handleSave(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, 400, { error: 'Invalid JSON' });
  }

  const { username, date, text } = body || {};
  if (!USERNAMES.has(username)) return json(request, 400, { error: 'Unknown user' });
  if (!isRealDate(date)) return json(request, 400, { error: 'Invalid date' });
  if (typeof text !== 'string') return json(request, 400, { error: 'Invalid text' });

  const trimmed = text.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) return json(request, 400, { error: 'Note is too long' });

  await updateJsonFile(env, 'notes.json', `chore: update note for ${username} on ${date}`, notes =>
    (notes[username]?.[date] || '') === trimmed ? null : applyNote(notes, username, date, trimmed));
  return json(request, 200, { ok: true });
}

// Thrown when the day a save targets changed on the server after the browser read it.
class MeetingConflict extends Error {}

async function handleMeetingSave(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, 400, { error: 'Invalid JSON' });
  }

  // expected is the time the browser last saw on date ('' for none). Leaving it out skips that check (older pages).
  const { date, time, from, expected } = body || {};
  if (!isRealDate(date)) return json(request, 400, { error: 'Invalid date' });
  if (from !== undefined && from !== null && !isRealDate(from)) return json(request, 400, { error: 'Invalid previous date' });
  if (typeof time !== 'string' || (time && !TIME_PATTERN.test(time))) return json(request, 400, { error: 'Invalid time' });
  if (expected !== undefined && (typeof expected !== 'string' || (expected && !TIME_PATTERN.test(expected)))) {
    return json(request, 400, { error: 'Invalid expected time' });
  }

  const message = meetingMessage(date, time, from);
  try {
    await updateJsonFile(env, 'meetings.json', message, meetings => {
      // Someone else changed this day since the browser loaded it, so don't overwrite their meeting.
      if (expected !== undefined && (meetings[date] || '') !== expected) throw new MeetingConflict();
      if (from && from !== date && meetings[date]) throw new MeetingConflict();
      const updated = applyMeeting(meetings, date, time, from);
      return JSON.stringify(updated) === JSON.stringify(sortedByKey(meetings)) ? null : updated;
    });
  } catch (err) {
    if (err instanceof MeetingConflict) return json(request, 409, { error: 'Someone else changed the meeting on ' + date });
    throw err;
  }
  return json(request, 200, { ok: true });
}

// --- Goals ---
// goals.json is { username: [{ id, kind, start, end, minutes }] }: reach minutes logged from start to end (both
// included). A week goal runs Monday to Sunday, a month goal 1st to last; a custom one from any start to a deadline.

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function groupToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: GROUP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function weekStartOf(dateStr) {
  return addDays(dateStr, -((new Date(dateStr + 'T00:00:00Z').getUTCDay() + 6) % 7));
}

function monthEndOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// The same day some months later, or that month's last day when it is shorter (31 Aug + 3 months = 30 Nov).
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

function daysInRange(start, end) {
  return Math.round((new Date(end + 'T00:00:00Z') - new Date(start + 'T00:00:00Z')) / 86400000) + 1;
}

// Thrown inside a goals change: a request that doesn't fit the goals on the server (status 409) or is wrong (400).
class GoalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Checks a goal from the browser and returns it as stored (without id), or throws a GoalError.
// Week and month goals can only be set for the current ones; a custom deadline is today up to 3 months ahead.
function checkGoal(goal, today) {
  const { kind, start, end, minutes } = goal || {};
  if (!GOAL_KINDS.has(kind)) throw new GoalError(400, 'Invalid goal kind');
  if (!isRealDate(start) || !isRealDate(end) || start > end) throw new GoalError(400, 'Invalid goal dates');
  if (kind === 'week' && (start !== weekStartOf(today) || end !== addDays(start, 6))) throw new GoalError(400, 'A week goal is for this week');
  if (kind === 'month' && (start !== today.slice(0, 8) + '01' || end !== monthEndOf(today))) throw new GoalError(400, 'A month goal is for this month');
  if (kind === 'custom' && (start > today || end < today || end > addMonths(today, CUSTOM_MONTHS_AHEAD))) {
    throw new GoalError(400, 'A custom goal starts by today and ends today to 3 months ahead');
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > daysInRange(start, end) * 1440) throw new GoalError(400, 'Invalid goal hours');
  return { kind, start, end, minutes };
}

function sortGoals(goals) {
  const order = { week: 0, month: 1, custom: 2 };
  return [...goals].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || order[a.kind] - order[b.kind] || (a.end < b.end ? -1 : 1));
}

// Returns the user's goals after the change. A week or month goal replaces the one already set for that week or
// month; a custom goal with an id replaces that goal, one without is a new one (up to 3 still running).
function applyGoalChange(userGoals, body, today) {
  if (body.action === 'delete') {
    if (!userGoals.some(g => g.id === body.id)) throw new GoalError(409, 'That goal was already deleted');
    return userGoals.filter(g => g.id !== body.id);
  }
  if (body.action !== 'set') throw new GoalError(400, 'Invalid action');

  const goal = checkGoal(body.goal, today);
  const id = body.goal.id;
  let rest;
  if (goal.kind === 'custom' && id !== undefined) {
    const old = userGoals.find(g => g.id === id);
    if (!old || old.kind !== 'custom') throw new GoalError(409, 'That goal was deleted');
    if (old.end < today) throw new GoalError(409, 'That goal has ended');
    rest = userGoals.filter(g => g.id !== id);
  } else if (goal.kind === 'custom') {
    if (userGoals.filter(g => g.kind === 'custom' && g.end >= today).length >= MAX_CUSTOM_GOALS) {
      throw new GoalError(409, 'There are already ' + MAX_CUSTOM_GOALS + ' custom goals running');
    }
    rest = userGoals;
  } else {
    rest = userGoals.filter(g => !(g.kind === goal.kind && g.start === goal.start));
  }
  const kept = id !== undefined && goal.kind === 'custom' ? id : crypto.randomUUID().slice(0, 8);
  return sortGoals([...rest, { id: kept, ...goal }]);
}

function goalMessage(username, body) {
  if (body.action === 'delete') return `chore: delete a goal for ${username}`;
  const { kind, start, end } = body.goal;
  return `chore: set ${kind} goal for ${username} (${start} to ${end})`;
}

async function handleGoalSave(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, 400, { error: 'Invalid JSON' });
  }
  const { username } = body || {};
  if (!USERNAMES.has(username)) return json(request, 400, { error: 'Unknown user' });
  if (body.action === 'delete' && typeof body.id !== 'string') return json(request, 400, { error: 'Invalid goal id' });
  if (body.action === 'set' && body.goal?.id !== undefined && typeof body.goal.id !== 'string') return json(request, 400, { error: 'Invalid goal id' });

  const today = groupToday();
  let saved;
  try {
    saved = await updateJsonFile(env, 'goals.json', goalMessage(username, body), goals => {
      const before = goals[username] || [];
      const after = applyGoalChange(before, body, today);
      const updated = { ...goals };
      if (after.length) updated[username] = after;
      else delete updated[username];
      return sortedByKey(updated);
    });
  } catch (err) {
    if (err instanceof GoalError) return json(request, err.status, { error: err.message });
    throw err;
  }
  return json(request, 200, { ok: true, goals: saved[username] || [] });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      if (request.method === 'GET' && pathname === '/notes') {
        return json(request, 200, (await readJsonFile(env, 'notes.json')).data);
      }
      if (request.method === 'GET' && pathname === '/meetings') {
        return json(request, 200, (await readJsonFile(env, 'meetings.json')).data);
      }
      if (request.method === 'GET' && pathname === '/goals') {
        return json(request, 200, (await readJsonFile(env, 'goals.json')).data);
      }

      const handlers = {
        '/notes': handleSave,
        '/meetings': handleMeetingSave,
        '/goals': handleGoalSave,
        '/verify': () => json(request, 200, { ok: true })
      };
      const handler = request.method === 'POST' && Object.hasOwn(handlers, pathname) ? handlers[pathname] : null;
      if (!handler) return json(request, 404, { error: 'Not found' });

      // Counted before the passcode is checked, so a blocked visitor learns nothing about their guesses.
      if (!env.PASSCODE_LIMITER) throw new Error('PASSCODE_LIMITER is missing: deploy with wrangler.toml');
      const visitor = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.PASSCODE_LIMITER.limit({ key: visitor });
      if (!success) return json(request, 429, { error: 'Too many tries, wait a minute' });

      if (!await passcodeMatches(request, env)) return json(request, 401, { error: 'Wrong passcode' });
      return await handler(request, env);
    } catch (err) {
      console.error(err.message);
      return json(request, 502, { error: 'Could not reach GitHub' });
    }
  }
};
