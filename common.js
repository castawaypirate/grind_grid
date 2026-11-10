// Shared by index.html, challenge.html, 1440-shots.html and calendar.html. Needs theme.js.
const DAY_MS = 86400000;
const STORAGE_KEY = 'grindgrid.dateRange.v2';
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

// Meeting times are the group's local wall-clock time, so they are read in the viewer's time zone.
function meetingTime(dateStr, time) {
  return new Date(dateStr + 'T' + time).getTime();
}

// meetings is { 'YYYY-MM-DD': 'HH:MM' }. Returns the date of the next meeting that hasn't started, or null.
function nextMeetingIn(meetings) {
  return Object.keys(meetings).sort().find(d => meetingTime(d, meetings[d]) >= Date.now()) || null;
}

function meetingCountdown(dateStr, time) {
  const days = Math.round((utcDate(dateStr) - utcDate(todayStr())) / DAY_MS);
  if (days === 0) return 'in ' + formatDuration(Math.max(1, (meetingTime(dateStr, time) - Date.now()) / 60000));
  if (days === 1) return 'tomorrow';
  return 'in ' + days + ' days';
}

// Loads meetings once per page (the calendar and the reminder icon share it).
// writable is false when only the static meetings.json could be read.
function fetchMeetings() {
  if (!meetingsRequest) {
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

function loadSavedRange() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved.from) && /^\d{4}-\d{2}-\d{2}$/.test(saved.to)) {
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
    endIdx = Math.min(endIdx, jsonData.labels.length - 1);
    startIdx = Math.min(startIdx, endIdx);

    fromInput.value = toDateStr(idxToDate(startIdx));
    toInput.value = toDateStr(idxToDate(endIdx));

    // Only an explicit click saves, so visitors who never choose a range keep following new data.
    if (save) saveRange(fromInput.value, toInput.value);

    draw(startIdx, endIdx);
  }

  try {
    await loadData();

    const lastIdx = jsonData.labels.length - 1;
    const firstDate = toDateStr(DATA_START);
    const lastDate = toDateStr(idxToDate(lastIdx));

    fromInput.max = lastDate;
    toInput.max = lastDate;

    const updatedEl = document.getElementById('updated');
    if (updatedEl) {
      updatedEl.textContent = 'Last updated: ' + new Date(jsonData.updatedAt).toLocaleString();
    }

    if (onData) onData(lastIdx);

    const saved = loadSavedRange();
    fromInput.value = saved ? saved.from : firstDate;
    toInput.value = saved ? saved.to : lastDate;

    applyRange({ save: false });

    document.getElementById('applyBtn').addEventListener('click', () => applyRange({ save: true }));
    document.getElementById('latestBtn').addEventListener('click', () => {
      if (!fromInput.value) fromInput.value = firstDate;
      toInput.value = lastDate;
      applyRange({ save: true });
    });
  } catch (err) {
    showError(errorEl, err);
  }
}
