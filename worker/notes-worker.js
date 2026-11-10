// Saves day notes (notes.json) and meetings (meetings.json) in the repo, so the GitHub key never reaches a browser.
// Secrets (set with `wrangler secret put`): GITHUB_TOKEN, NOTES_PASSCODE.
const CONTENTS_URL = 'https://api.github.com/repos/castawaypirate/grind_grid/contents/';
const BRANCH = 'main';
const USERNAMES = new Set(['castawaypirate', 'barbalias', 'Spl4sssh', 'jimmy_hawkins']);
const MAX_NOTE_LENGTH = 200;
const MAX_SAVE_ATTEMPTS = 3;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
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

// change(data) returns the new contents, or null when there is nothing to write.
async function updateJsonFile(env, file, message, change) {
  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
    const { data, sha } = await readJsonFile(env, file);
    const updated = change(data);
    if (!updated) return;

    const res = await fetch(CONTENTS_URL + file, {
      method: 'PUT',
      headers: { ...githubHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: encodeContent(updated), sha, branch: BRANCH })
    });
    if (res.ok) return;
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

async function handleMeetingSave(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, 400, { error: 'Invalid JSON' });
  }

  const { date, time, from } = body || {};
  if (!isRealDate(date)) return json(request, 400, { error: 'Invalid date' });
  if (from !== undefined && from !== null && !isRealDate(from)) return json(request, 400, { error: 'Invalid previous date' });
  if (typeof time !== 'string' || (time && !TIME_PATTERN.test(time))) return json(request, 400, { error: 'Invalid time' });

  const message = meetingMessage(date, time, from);
  await updateJsonFile(env, 'meetings.json', message, meetings => {
    const updated = applyMeeting(meetings, date, time, from);
    return JSON.stringify(updated) === JSON.stringify(sortedByKey(meetings)) ? null : updated;
  });
  return json(request, 200, { ok: true });
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

      const handlers = {
        '/notes': handleSave,
        '/meetings': handleMeetingSave,
        '/verify': () => json(request, 200, { ok: true })
      };
      const handler = request.method === 'POST' && Object.hasOwn(handlers, pathname) ? handlers[pathname] : null;
      if (!handler) return json(request, 404, { error: 'Not found' });

      if (!await passcodeMatches(request, env)) return json(request, 401, { error: 'Wrong passcode' });
      return await handler(request, env);
    } catch (err) {
      console.error(err.message);
      return json(request, 502, { error: 'Could not reach GitHub' });
    }
  }
};
