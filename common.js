// Shared by index.html, challenge.html and 1440-shots.html.
const DAY_MS = 86400000;
const STORAGE_KEY = 'grindgrid.dateRange.v2';
const activeCharts = [];
let DATA_START = null;
let jsonData = null;

function toDateStr(d) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function idxToDate(i) {
  return new Date(DATA_START.getTime() + i * DAY_MS);
}

function formatChartLabel(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
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

// Loads data.json and wires up the date range picker.
// render(startIdx, endIdx) draws the page; onData(lastIdx) runs once after loading.
async function initRangePage({ render, errorEl, onData }) {
  const fromInput = document.getElementById('dateFrom');
  const toInput = document.getElementById('dateTo');

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

    render(startIdx, endIdx);
  }

  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error('Failed to load data.json');
    jsonData = await res.json();

    if (!jsonData.startDate) throw new Error('data.json is missing startDate');
    DATA_START = new Date(jsonData.startDate + 'T00:00:00Z');

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
    const box = document.createElement('div');
    box.className = 'error';
    box.textContent = 'Error: ' + err.message;
    errorEl.replaceChildren(box);
  }
}
