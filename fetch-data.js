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

function getISOWeekKey(dt) {
  const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wn = Math.ceil((((d - ys) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(wn).padStart(2, '0');
}

function processHabit(username, displayName, habit, globalStart, globalEnd) {
  const hm = habit.heatmap || [];
  const map = {};
  for (const e of hm) {
    map[e.day] = (e.value || 0) / 60;
  }

  const filled = [];
  const cur = new Date(globalStart);
  while (cur <= globalEnd) {
    const key = cur.toISOString().slice(0, 10);
    filled.push({ date: new Date(cur), hours: map[key] || 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const daily = filled.map(f => +f.hours.toFixed(2));

  const wStats = {}, mStats = {};
  for (const f of filled) {
    const wk = getISOWeekKey(f.date);
    if (!wStats[wk]) wStats[wk] = { hours: 0 };
    wStats[wk].hours += f.hours;
    const mk = f.date.getUTCFullYear() + '-' + String(f.date.getUTCMonth() + 1).padStart(2, '0');
    if (!mStats[mk]) mStats[mk] = { hours: 0 };
    mStats[mk].hours += f.hours;
  }

  const weeklyLine = filled.map(f => {
    const wk = getISOWeekKey(f.date);
    return +(wStats[wk]?.hours || 0).toFixed(2);
  });

  const monthlyLine = filled.map(f => {
    const mk = f.date.getUTCFullYear() + '-' + String(f.date.getUTCMonth() + 1).padStart(2, '0');
    return +(mStats[mk]?.hours || 0).toFixed(2);
  });

  return { username, displayName, habitTitle: habit.title.trim(), daily, weeklyLine, monthlyLine };
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

  const now = new Date();
  const todayCap = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let globalStart = null;
  let globalEnd = null;
  for (const { data } of validResults) {
    const hm = data.habits[0].heatmap || [];
    for (const e of hm) {
      const d = new Date(e.day + 'T00:00:00Z');
      if (d > todayCap) {
        console.error(`Ignoring future-dated heatmap entry ${e.day} (after today ${todayCap.toISOString().slice(0,10)})`);
        continue;
      }
      if (!globalStart || d < globalStart) globalStart = d;
      if (!globalEnd || d > globalEnd) globalEnd = d;
    }
  }

  if (!globalStart) globalStart = startOfCurrentYearUTC();
  if (!globalEnd || globalEnd < globalStart) globalEnd = new Date(globalStart);

  // If we haven't seen today's date in heatmaps, extend to today with zero-filled data
  if (globalEnd < todayCap) {
    globalEnd = todayCap;
  }

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
