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

const GOALS = { daily: 5, weekly: 35, monthly: 150 };

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

async function fetchUserData(username) {
  const url = 'https://www.lifeofdiscipline.com/api/trpc/profile.getProfilePageForUsername?input='
    + encodeURIComponent(JSON.stringify({ username }));
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${username}`);
  const data = (await res.json()).result.data;
  if (!data.habits?.length) throw new Error(`No habits for ${username}`);
  return data;
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
    map[e.day] = (e.value || 0) / 60;
  }

  // The pages work out the weekly and monthly running totals from daily (index.html).
  const daily = [];
  const cur = new Date(globalStart);
  while (cur <= globalEnd) {
    daily.push(+(map[cur.toISOString().slice(0, 10)] || 0).toFixed(2));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return { username, displayName, habitTitle: habit.title.trim(), daily };
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
