const USER_AGENT = 'GrindGrid/1.0 (github.com/castawaypirate/grind_grid)';
const SLEEP_MIN = 0;
const SLEEP_MAX = 240;
const RETRY_DELAY_MS = 30000;

function randomSleep(min, max) {
  const ms = (Math.random() * (max - min) + min) * 60000;
  console.log(`Sleeping ${(ms / 60000).toFixed(0)} min before fetch...`);
  return new Promise(r => setTimeout(r, ms));
}

const USERS = [
  { username: 'castawaypirate', displayName: 'CastawayPirate' },
  { username: 'barbalias', displayName: 'Barbalias' },
  { username: 'Spl4sssh', displayName: 'Spl4sssh' },
  { username: 'jimmy_hawkins', displayName: 'Jimmy_hawkins' }
];

// Hours a day. The pages make the weekly goal 7 days of it and each month's goal that month's days of it.
const GOALS = { daily: 5 };

// The group's time zone (common.js has the same setting). data.json stops at the last day that is over there,
// so the charts never end on a half-logged day; that day is picked up by the next run.
const GROUP_TIME_ZONE = 'Europe/Athens';

function lastFinishedDayUTC() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: GROUP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function startOfCurrentYearUTC() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), 0, 1));
}

// The API isn't a public one and can change without notice. Errors say which it was: the site not answering,
// or an answer in a shape this script doesn't know (the API changed, so this script needs updating).
function apiChanged(username, what) {
  return new Error(`API changed for ${username}: ${what}`);
}

function checkShape(username, body) {
  const data = body?.result?.data;
  if (!data || typeof data !== 'object') throw apiChanged(username, 'no result.data in the response');
  if (!Array.isArray(data.habits)) throw apiChanged(username, 'result.data.habits is missing or not a list');
  if (!data.habits.length) throw new Error(`No habits for ${username}`);
  const habit = data.habits[0];
  if (typeof habit.title !== 'string') throw apiChanged(username, 'the habit has no title');
  if (habit.heatmap != null && !Array.isArray(habit.heatmap)) throw apiChanged(username, 'the habit heatmap is not a list');
  for (const e of habit.heatmap || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.day)) throw apiChanged(username, `heatmap day ${JSON.stringify(e?.day)} is not YYYY-MM-DD`);
    if (e.value != null && typeof e.value !== 'number') throw apiChanged(username, `heatmap value ${JSON.stringify(e.value)} is not a number`);
  }
  return data;
}

async function fetchUserData(username) {
  const url = 'https://www.lifeofdiscipline.com/api/trpc/profile.getProfilePageForUsername?input='
    + encodeURIComponent(JSON.stringify({ username }));
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch (err) {
    throw new Error(`Site not reachable for ${username}: ${err.cause?.message || err.message}`);
  }
  if (res.status === 404) throw apiChanged(username, 'HTTP 404 (endpoint or user gone)');
  if (!res.ok) throw new Error(`Site error for ${username}: HTTP ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw apiChanged(username, 'the response is not JSON');
  }
  return checkShape(username, body);
}

async function fetchUserDataWithRetry(username) {
  try {
    return await fetchUserData(username);
  } catch (err) {
    console.error(`Retrying ${username} after error: ${err.message}`);
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    return fetchUserData(username);
  }
}

function processHabit(username, displayName, habit, globalStart, globalEnd) {
  const hm = habit.heatmap || [];
  const map = {};
  for (const e of hm) {
    map[e.day] = e.value || 0;
  }

  // Whole minutes, so totals over any range are exact; the pages turn them into hours (loadData in common.js)
  // and work out the weekly and monthly running totals from them (index.html).
  const dailyMinutes = [];
  const cur = new Date(globalStart);
  while (cur <= globalEnd) {
    dailyMinutes.push(Math.round(map[cur.toISOString().slice(0, 10)] || 0));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return { username, displayName, habitTitle: habit.title.trim(), dailyMinutes };
}

async function main() {
  if (process.env.SKIP_SLEEP !== 'true') await randomSleep(SLEEP_MIN, SLEEP_MAX);
  const rawResults = await Promise.all(USERS.map(async u => {
    try {
      const data = await fetchUserDataWithRetry(u.username);
      return { ...u, data };
    } catch (err) {
      console.error('Failed to fetch ' + u.username + ': ' + err.message);
      return null;
    }
  }));

  // Keep the last complete data.json rather than publish one with users missing.
  const validResults = rawResults.filter(Boolean);
  if (validResults.length !== USERS.length) {
    console.error(`Fetched ${validResults.length} of ${USERS.length} users; leaving data.json unchanged`);
    process.exit(1);
  }

  const lastDay = lastFinishedDayUTC();
  const lastDayStr = lastDay.toISOString().slice(0, 10);

  let globalStart = null;
  let unfinished = 0;
  for (const { data } of validResults) {
    const hm = data.habits[0].heatmap || [];
    for (const e of hm) {
      const d = new Date(e.day + 'T00:00:00Z');
      if (d > lastDay) {
        unfinished++;
        continue;
      }
      if (!globalStart || d < globalStart) globalStart = d;
    }
  }
  if (unfinished) console.log(`Leaving out ${unfinished} entr${unfinished === 1 ? 'y' : 'ies'} after ${lastDayStr} (day not over yet in ${GROUP_TIME_ZONE})`);

  if (!globalStart || globalStart > lastDay) globalStart = startOfCurrentYearUTC();
  // Always run up to the last finished day, zero-filling days nobody logged.
  const globalEnd = lastDay < globalStart ? new Date(globalStart) : lastDay;

  const labels = [];
  const cur = new Date(globalStart);
  while (cur <= globalEnd) {
    labels.push(cur.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const users = validResults.map(u =>
    processHabit(u.username, u.displayName, u.data.habits[0], globalStart, globalEnd)
  );

  const fs = require('fs');
  fs.writeFileSync('data.json', JSON.stringify({
    updatedAt: new Date().toISOString(),
    startDate: globalStart.toISOString().slice(0, 10),
    endDate: globalEnd.toISOString().slice(0, 10),
    labels,
    goals: GOALS,
    users
  }, null, 2));
  console.log('Wrote data.json with ' + users.length + ' user(s)');
}

main();
