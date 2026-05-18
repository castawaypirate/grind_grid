const USERS = [
  { username: 'castawaypirate', displayName: 'CastawayPirate' },
  { username: 'barbalias', displayName: 'Barbalias' }
];

const GOALS = { daily: 5, weekly: 35, monthly: 150 };

async function fetchUserData(username) {
  const url = 'https://www.lifeofdiscipline.com/api/trpc/profile.getProfilePageForUsername?input='
    + encodeURIComponent(JSON.stringify({ username }));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${username}`);
  return (await res.json()).result.data;
}

function getISOWeekKey(dt) {
  const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wn = Math.ceil((((d - ys) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(wn).padStart(2, '0');
}

function processHabit(username, displayName, habit) {
  const hm = habit.heatmap || [];
  const map = {};
  let minD = null, maxD = null;
  for (const e of hm) {
    const h = (e.value || 0) / 60;
    map[e.day] = h;
    const d = new Date(e.day + 'T00:00:00');
    if (!minD || d < minD) minD = d;
    if (!maxD || d > maxD) maxD = d;
  }
  if (!minD) return null;

  const filled = [];
  const cur = new Date(minD);
  while (cur <= maxD) {
    const key = cur.toISOString().slice(0, 10);
    filled.push({ date: new Date(cur), hours: map[key] || 0 });
    cur.setDate(cur.getDate() + 1);
  }

  const labels = filled.map(f =>
    f.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  );
  const daily = filled.map(f => +f.hours.toFixed(2));

  const wStats = {}, mStats = {};
  for (const f of filled) {
    const wk = getISOWeekKey(f.date);
    if (!wStats[wk]) wStats[wk] = { hours: 0 };
    wStats[wk].hours += f.hours;
    const mk = f.date.getFullYear() + '-' + String(f.date.getMonth() + 1).padStart(2, '0');
    if (!mStats[mk]) mStats[mk] = { hours: 0 };
    mStats[mk].hours += f.hours;
  }

  const wkSort = Object.keys(wStats).sort();
  const wkVals = wkSort.map(k => +wStats[k].hours.toFixed(2));
  const wMap = {};
  wkSort.forEach((k, i) => wMap[k] = wkVals[i]);

  const mkSort = Object.keys(mStats).sort();
  const mVals = mkSort.map(k => +mStats[k].hours.toFixed(2));
  const mMap = {};
  mkSort.forEach((k, i) => mMap[k] = mVals[i]);

  const weeklyLine = filled.map(f => wMap[getISOWeekKey(f.date)] || 0);
  const monthlyLine = filled.map(f => {
    const mk = f.date.getFullYear() + '-' + String(f.date.getMonth() + 1).padStart(2, '0');
    return mMap[mk] || 0;
  });

  return { username, displayName, habitTitle: habit.title.trim(), labels, daily, weeklyLine, monthlyLine };
}

async function main() {
  const results = await Promise.all(USERS.map(async u => {
    try {
      const data = await fetchUserData(u.username);
      return processHabit(u.username, u.displayName, data.habits[0]);
    } catch (err) {
      console.error('Failed to fetch ' + u.username + ': ' + err.message);
      return null;
    }
  }));

  const users = results.filter(Boolean);
  if (users.length === 0) {
    console.error('No data fetched for any user');
    process.exit(1);
  }

  const fs = require('fs');
  fs.writeFileSync('data.json', JSON.stringify({ updatedAt: new Date().toISOString(), goals: GOALS, users }, null, 2));
  console.log('Wrote data.json with ' + users.length + ' user(s)');
}

main();
