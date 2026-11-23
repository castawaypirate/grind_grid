const USER_AGENT = 'GrindGrid/1.0 (github.com/castawaypirate/grind_grid)';
const SLEEP_MIN = 0;
const SLEEP_MAX = 240;
const RETRY_DELAY_MS = 30000;

function randomSleep(min, max) {
  const ms = (Math.random() * (max - min) + min) * 60000;
  console.log(`Sleeping ${(ms / 60000).toFixed(0)} min before fetch...`);
  return new Promise(r => setTimeout(r, ms));
}

// habit is the title of the habit to chart (case and spaces around it don't matter). Everyone has several habits
// and the API doesn't list them in a fixed order, so it's picked by title. If someone renames theirs, the fetch
// fails with a "Habit not found" error listing their habits, and this needs the new title.
const USERS = [
  { username: 'castawaypirate', displayName: 'CastawayPirate', habit: 'Noodling' },
  { username: 'barbalias', displayName: 'Barbalias', habit: 'USMLE STEP 1' },
  { username: 'Spl4sssh', displayName: 'Spl4sssh', habit: 'Worked on "the end of me" project' },
  { username: 'jimmy_hawkins', displayName: 'Jimmy_hawkins', habit: 'Research' }
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

const sameTitle = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Returns the user's habit (user.habit) from the API's answer.
function pickHabit({ username, habit: wanted }, body) {
  const data = body?.result?.data;
  if (!data || typeof data !== 'object') throw apiChanged(username, 'no result.data in the response');
  if (!Array.isArray(data.habits)) throw apiChanged(username, 'result.data.habits is missing or not a list');
  if (data.habits.some(h => typeof h?.title !== 'string')) throw apiChanged(username, 'a habit has no title');
  const habit = data.habits.find(h => sameTitle(h.title, wanted));
  if (!habit) {
    const titles = data.habits.map(h => JSON.stringify(h.title.trim())).join(', ') || 'none';
    throw new Error(`Habit not found for ${username}: no habit titled ${JSON.stringify(wanted)} (their habits: ${titles}). Update USERS in fetch-data.js`);
  }
  if (habit.heatmap != null && !Array.isArray(habit.heatmap)) throw apiChanged(username, 'the habit heatmap is not a list');
  for (const e of habit.heatmap || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.day)) throw apiChanged(username, `heatmap day ${JSON.stringify(e?.day)} is not YYYY-MM-DD`);
    if (e.value != null && typeof e.value !== 'number') throw apiChanged(username, `heatmap value ${JSON.stringify(e.value)} is not a number`);
  }
  return habit;
}

async function fetchUserData(user) {
  const { username } = user;
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
  return pickHabit(user, body);
}

async function fetchUserDataWithRetry(user) {
  try {
    return await fetchUserData(user);
  } catch (err) {
    console.error(`Retrying ${user.username} after error: ${err.message}`);
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    return fetchUserData(user);
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
      const habit = await fetchUserDataWithRetry(u);
      return { ...u, habit };
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
  for (const { habit } of validResults) {
    const hm = habit.heatmap || [];
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
    processHabit(u.username, u.displayName, u.habit, globalStart, globalEnd)
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
