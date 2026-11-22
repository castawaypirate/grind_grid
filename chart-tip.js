// The hover label for the chart pages: the day, one row per measure against its goal, and the day's note.
// Needs common.js and notes.js. Use it as a Chart.js tooltip:
//   tooltip: { mode: 'index', intersect: false, enabled: false, external: chartTipHandler(user, startIdx, rowsFor) }
// rowsFor(date, index) returns the rows for that day, each
//   { dataset, name, hours, goal, track, total, totalLabel }
// where dataset is the chart dataset the row stands for (its colour, and the row hides with it),
// hours and goal are in hours, and track turns the percentage green with a ✓ once the goal is met.
// total (hours) and totalLabel are optional: a small line under the row, e.g. "Week total 14h 33m".

// Hours as a fixed-width "3h 05m", so the numbers line up.
function formatHours(hours) {
  const total = Math.round(hours * 60);
  return Math.floor(total / 60) + 'h ' + String(total % 60).padStart(2, '0') + 'm';
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7);
}

function chartTipEl() {
  let tip = document.getElementById('chartTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'chartTip';
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);
  }
  return tip;
}

function tipEl(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function fillChartTip(tip, chart, date, rows, note) {
  const title = tipEl('div', 'tip-title');
  title.append(date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
  if (note) title.appendChild(tipEl('span', 'tip-note-dot'));

  const grid = tipEl('div', 'tip-rows');
  for (const { dataset, name, hours, goal, track, total, totalLabel } of rows) {
    if (!chart.isDatasetVisible(dataset)) continue;
    const met = track && hours >= goal;
    const pct = Math.round(hours / goal * 100) + '%' + (met ? ' ✓' : '');

    const swatch = tipEl('span', 'tip-swatch');
    swatch.style.color = chart.data.datasets[dataset].borderColor;
    grid.append(
      swatch,
      tipEl('span', 'tip-name', name),
      tipEl('span', 'tip-num', formatHours(hours)),
      tipEl('span', 'tip-num tip-goal', '/ ' + formatGoal(goal)),
      tipEl('span', 'tip-num tip-pct' + (met ? ' met' : ''), pct)
    );
    if (total !== undefined) grid.appendChild(tipEl('span', 'tip-total', totalLabel + ' ' + formatHours(total)));
  }

  const parts = [title, grid];
  if (note) parts.push(tipEl('div', 'tip-note', note));
  if (notesEnabled()) {
    const hint = canEditNotes() ? (note ? 'Double-click to edit the note' : 'Double-click to add a note')
      : (note ? 'Double-click to open the note' : '');
    parts.push(tipEl('div', 'tip-hint', hint));
  }
  tip.replaceChildren(...parts);
}

// "5h", or "2h 30m" for a goal that isn't whole hours.
function formatGoal(hours) {
  return Number.isInteger(hours) ? hours + 'h' : formatHours(hours);
}

// Chart.js calls this on every mouse move; the label is only rebuilt when the day or its note changes.
function chartTipHandler(user, startIdx, rowsFor) {
  return ({ chart, tooltip }) => {
    const tip = chartTipEl();
    if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
      tip.classList.remove('shown');
      return;
    }

    const index = tooltip.dataPoints[0].dataIndex;
    const date = idxToDate(startIdx + index);
    const note = notesEnabled() ? noteFor(user.username, toDateStr(date)) : '';
    const visible = chart.data.datasets.map((_, i) => chart.isDatasetVisible(i) ? 1 : 0).join('');
    const key = [chart.id, index, note, visible, canEditNotes(), document.documentElement.dataset.theme].join('|');
    if (tip.dataset.key !== key) {
      fillChartTip(tip, chart, date, rowsFor(date, index), note);
      tip.dataset.key = key;
    }

    // Beside the hovered day: to its right, or to its left near the right edge; always on screen.
    const rect = chart.canvas.getBoundingClientRect();
    const gap = 14;
    const margin = 8;
    const viewW = document.documentElement.clientWidth;
    const caretX = rect.left + tooltip.caretX;
    let left = caretX + gap;
    if (left + tip.offsetWidth > viewW - margin) left = caretX - gap - tip.offsetWidth;
    left = Math.max(margin, Math.min(left, viewW - margin - tip.offsetWidth));
    let top = rect.top + tooltip.caretY - tip.offsetHeight / 2;
    top = Math.max(margin, Math.min(top, window.innerHeight - margin - tip.offsetHeight));

    tip.style.left = (left + window.scrollX) + 'px';
    tip.style.top = (top + window.scrollY) + 'px';
    tip.classList.add('shown');
  };
}
