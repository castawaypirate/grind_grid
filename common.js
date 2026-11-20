// Shared by index.html, challenge.html, 1440-shots.html and calendar.html. Needs theme.js.
const DAY_MS = 86400000;
// v3: the end date can be 'latest'. Ranges saved under v2 had a fixed end date that stopped following new data.
const STORAGE_KEY = 'grindgrid.dateRange.v3';
// The group's time zone. Meeting times are wall-clock times there, whoever is viewing.
// fetch-data.js has the same setting for deciding when a day is over.
const GROUP_TIME_ZONE = 'Europe/Athens';
const GROUP_TIME_ZONE_LABEL = 'Athens time';
// The worker that saves notes and meetings (worker/notes-worker.js).
const API_URL = 'https://grind-grid-notes.castawayfocuspirate-a34.workers.dev';
const PASSCODE_KEY = 'grindgrid.notesPasscode';
const TOAST_MS = 5000;
const MEETINGS_LOAD_TIMEOUT_MS = 5000;
const activeCharts = [];
let DATA_START = null;
let jsonData = null;
let toastTimer = null;
let meetingsRequest = null;

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {}
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Checks the passcode with the worker and remembers it when it's right.
// Returns null on success, otherwise a message to show.
async function checkPasscode(passcode) {
  try {
    const res = await fetch(API_URL + '/verify', {
      method: 'POST',
      headers: { 'X-Notes-Passcode': passcode }
    });
    if (res.ok) {
      writeStorage(PASSCODE_KEY, passcode);
      return null;
    }
    return res.status === 401 ? 'Wrong passcode' : 'Server error';
  } catch (e) {
    return 'Connection problem';
  }
}

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, TOAST_MS);
}

function toDateStr(d) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function idxToDate(i) {
  return new Date(DATA_START.getTime() + i * DAY_MS);
}

function formatChartLabel(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function utcDate(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}

// The viewer's local date as YYYY-MM-DD.
function todayStr() {
  const now = new Date();
  return toDateStr(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

function formatDayTitle(dateStr) {
  const d = utcDate(dateStr);
  return d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) + ' ' + formatChartLabel(d);
}

// How far ahead of UTC a time zone's clocks are at a moment, in ms.
function zoneOffset(timeZone, ms) {
  const parts = {};
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  });
  for (const part of format.formatToParts(ms)) parts[part.type] = Number(part.value);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

// The moment it is HH:MM on YYYY-MM-DD in a time zone.
function zonedTime(dateStr, time, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // The second pass corrects the offset when a daylight saving change falls between the guess and the answer.
  const guess = wall - zoneOffset(timeZone, wall);
  return wall - zoneOffset(timeZone, guess);
}

// A moment's date as YYYY-MM-DD in a time zone (undefined means the viewer's).
function dateStrAt(ms, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

// Meeting times are the group's wall-clock time, so the same meeting is the same moment for every viewer.
function meetingTime(dateStr, time) {
  return zonedTime(dateStr, time, GROUP_TIME_ZONE);
}

function viewerInGroupZone(ms) {
  return zoneOffset(GROUP_TIME_ZONE, ms) === -new Date(ms).getTimezoneOffset() * 60000;
}

// "19:42 your time" (with the weekday when it falls on another day there), or '' for viewers in the group's time zone.
function meetingLocalNote(dateStr, time) {
  const at = meetingTime(dateStr, time);
  if (viewerInGroupZone(at)) return '';
  const local = new Date(at);
  const clock = local.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const day = dateStrAt(at) === dateStr ? '' : local.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ';
  return day + clock + ' your time';
}

// "20:42", or "20:42 Athens time (19:42 your time)" for viewers elsewhere.
function formatMeetingClock(dateStr, time) {
  const note = meetingLocalNote(dateStr, time);
  return note ? time + ' ' + GROUP_TIME_ZONE_LABEL + ' (' + note + ')' : time;
}

function formatMeetingWhen(dateStr, time) {
  return formatDayTitle(dateStr) + ' · ' + formatMeetingClock(dateStr, time);
}

// meetings is { 'YYYY-MM-DD': 'HH:MM' }. Returns the date of the next meeting that hasn't started, or null.
function nextMeetingIn(meetings) {
  return Object.keys(meetings).sort().find(d => meetingTime(d, meetings[d]) >= Date.now()) || null;
}

// Days are counted on the viewer's calendar, so "tomorrow" means their tomorrow.
function meetingCountdown(dateStr, time) {
  const at = meetingTime(dateStr, time);
  const days = Math.round((utcDate(dateStrAt(at)) - utcDate(todayStr())) / DAY_MS);
  if (days === 0) return 'in ' + formatDuration(Math.max(1, (at - Date.now()) / 60000));
  if (days === 1) return 'tomorrow';
  return 'in ' + days + ' days';
}

// Loads meetings once per page (the calendar and the reminder icon share it); fresh asks the server again.
// writable is false when only the static meetings.json could be read.
function fetchMeetings(fresh) {
  if (!meetingsRequest || fresh) {
    meetingsRequest = (async () => {
      try {
        const meetings = await fetchJson(API_URL + '/meetings', { signal: AbortSignal.timeout(MEETINGS_LOAD_TIMEOUT_MS) });
        return { meetings, writable: true };
      } catch (e) {
        try {
          return { meetings: await fetchJson('meetings.json'), writable: false };
        } catch (e2) {
          return { meetings: {}, writable: false };
        }
      }
    })();
  }
  return meetingsRequest;
}

function formatRangeLabel(start, end) {
  const startText = formatChartLabel(start);
  const endText = formatChartLabel(end);
  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    return startText.replace(/ \d{4}$/, '') + ' – ' + endText;
  }
  return startText + ' – ' + endText;
}

function sliceWithPadding(arr, startIdx, endIdx) {
  const out = [];
  for (let i = startIdx; i <= endIdx; i++) {
    out.push(i >= 0 && i < arr.length ? arr[i] : 0);
  }
  return out;
}

// { from, to }: from is a date; to is a date, or 'latest' to keep following new data.
function loadSavedRange() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (saved && isDate(saved.from) && (saved.to === 'latest' || isDate(saved.to))) {
      return saved;
    }
  } catch (e) {}
  return null;
}

function saveRange(from, to) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ from, to }));
  } catch (e) {}
}

function formatDuration(mins) {
  const total = Math.round(mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return m + ' min';
  if (m === 0) return h + 'h';
  return h + 'h ' + m + ' min';
}

// Reads a color token from theme.css for the current theme.
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyChartTheme() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = cssVar('--chart-text');
  Chart.defaults.borderColor = cssVar('--chart-grid');
}

function destroyCharts() {
  activeCharts.forEach(chart => chart.destroy());
  activeCharts.length = 0;
}

function renderLegend(chart, legendEl) {
  legendEl.innerHTML = '';

  chart.data.datasets.forEach((dataset, i) => {
    const item = document.createElement('label');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.style.accentColor = dataset.borderColor;

    const line = document.createElement('span');
    line.className = 'legend-line' + (dataset.borderDash ? ' dashed' : '');
    line.style.borderTopColor = dataset.borderColor;

    const text = document.createElement('span');
    text.className = 'legend-text';
    text.textContent = dataset.label;

    checkbox.addEventListener('change', () => {
      chart.setDatasetVisibility(i, checkbox.checked);
      chart.update();
      item.classList.toggle('off', !checkbox.checked);
    });

    item.append(checkbox, line, text);
    legendEl.appendChild(item);
  });
}

// Loads data.json into jsonData and DATA_START.
async function loadData() {
  const res = await fetch('data.json');
  if (!res.ok) throw new Error('Failed to load data.json');
  jsonData = await res.json();

  if (!jsonData.startDate) throw new Error('data.json is missing startDate');
  DATA_START = new Date(jsonData.startDate + 'T00:00:00Z');
}

function showError(errorEl, err) {
  const box = document.createElement('div');
  box.className = 'error';
  box.textContent = 'Error: ' + err.message;
  errorEl.replaceChildren(box);
}

// Loads data.json and wires up the date range picker.
// render(startIdx, endIdx) draws the page; onData(lastIdx) runs once after loading.
async function initRangePage({ render, errorEl, onData }) {
  const fromInput = document.getElementById('dateFrom');
  const toInput = document.getElementById('dateTo');
  let shownRange = null;

  function draw(startIdx, endIdx) {
    shownRange = [startIdx, endIdx];
    applyChartTheme();
    render(startIdx, endIdx);
  }

  // Charts take their colors when they are drawn, so draw them again in the new theme.
  // The check keeps an old cached page without theme.js working.
  if (typeof onThemeChange === 'function') {
    onThemeChange(() => {
      if (shownRange) draw(...shownRange);
    });
  }

  function applyRange({ save }) {
    const dateFrom = new Date(fromInput.value + 'T00:00:00Z');
    const dateTo = new Date(toInput.value + 'T00:00:00Z');

    if (isNaN(dateFrom) || isNaN(dateTo)) return;

    let startIdx = Math.round((dateFrom - DATA_START) / DAY_MS);
    let endIdx = Math.round((dateTo - DATA_START) / DAY_MS);

    if (startIdx > endIdx) {
      const tmp = startIdx;
      startIdx = endIdx;
      endIdx = tmp;
    }

    // Future dates still stop at the latest available data point.
    const lastIdx = jsonData.labels.length - 1;
    endIdx = Math.min(endIdx, lastIdx);
    startIdx = Math.min(startIdx, endIdx);

    fromInput.value = toDateStr(idxToDate(startIdx));
    toInput.value = toDateStr(idxToDate(endIdx));

    // Only an explicit click saves. A range that ends on the newest day is saved as 'latest',
    // so it keeps growing as new days come in instead of freezing on the day it was saved.
    if (save) saveRange(fromInput.value, endIdx === lastIdx ? 'latest' : toInput.value);

    draw(startIdx, endIdx);
  }

  try {
    await loadData();

    const lastIdx = jsonData.labels.length - 1;
    const lastDate = toDateStr(idxToDate(lastIdx));
    // By default: from the start of the newest day's year up to the newest day.
    const defaultFrom = lastDate.slice(0, 4) + '-01-01';

    fromInput.max = lastDate;
    toInput.max = lastDate;

    const updatedEl = document.getElementById('updated');
    if (updatedEl) {
      updatedEl.textContent = 'Last updated: ' + new Date(jsonData.updatedAt).toLocaleString();
    }

    if (onData) onData(lastIdx);

    const saved = loadSavedRange();
    fromInput.value = saved ? saved.from : defaultFrom;
    toInput.value = saved && saved.to !== 'latest' ? saved.to : lastDate;

    applyRange({ save: false });

    document.getElementById('applyBtn').addEventListener('click', () => applyRange({ save: true }));
    document.getElementById('latestBtn').addEventListener('click', () => {
      if (!fromInput.value) fromInput.value = defaultFrom;
      toInput.value = lastDate;
      applyRange({ save: true });
    });
  } catch (err) {
    showError(errorEl, err);
  }
}
