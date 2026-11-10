// Month calendar: a dot for each user who logged time that day, plus the group's meetings. Needs common.js.
const USER_COLORS = ['#4d96ff', '#27ae60', '#8e44ad', '#e67e22'];
const REFRESH_MS = 60000;

let meetings = {};
let meetingsWritable = false;
let meetingSaveQueue = Promise.resolve();
let view = null;
let openDay = null;
let dayBoxEls = null;
let renderedFor = '';

function userColor(i) {
  return USER_COLORS[i % USER_COLORS.length];
}

// Hours a user logged on a day, or null when data.json doesn't cover that day.
function hoursOn(user, dateStr) {
  if (!DATA_START) return null;
  const idx = Math.round((utcDate(dateStr) - DATA_START) / DAY_MS);
  return idx >= 0 && idx < user.daily.length ? user.daily[idx] : null;
}

function meetingMoment(dateStr) {
  return meetingTime(dateStr, meetings[dateStr]);
}

function isUpcoming(dateStr) {
  return meetingMoment(dateStr) >= Date.now();
}

function nextMeetingDate() {
  return nextMeetingIn(meetings);
}

function lastMeetingTime() {
  const dates = Object.keys(meetings).sort();
  return dates.length ? meetings[dates[dates.length - 1]] : '';
}

function renderHeader() {
  const line = document.getElementById('nextLine');
  const button = document.getElementById('nextMeetingBtn');
  const next = nextMeetingDate();

  if (next) {
    const when = document.createElement('strong');
    when.textContent = formatDayTitle(next) + ' · ' + meetings[next];
    line.replaceChildren('Next meeting: ', when, ' (' + meetingCountdown(next, meetings[next]) + ')');
  } else {
    line.textContent = 'No meeting set. Click a day to add one.';
  }
  button.disabled = !next;
  button.title = next ? '' : 'No upcoming meeting';
  if (typeof updateReminder === 'function') updateReminder(meetings);
}

function renderLegend() {
  const legend = document.getElementById('legend');
  legend.replaceChildren(...jsonData.users.map((user, i) => {
    const item = document.createElement('span');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = userColor(i);
    item.append(dot, user.displayName);
    return item;
  }));
}

function buildCell(dateStr, inMonth, today, next) {
  const day = utcDate(dateStr);
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.tabIndex = 0;
  cell.setAttribute('role', 'button');
  cell.dataset.date = dateStr;
  if (!inMonth) cell.classList.add('other-month');
  if (dateStr === today) cell.classList.add('today');

  const head = document.createElement('div');
  head.className = 'cell-head';
  const num = document.createElement('span');
  num.className = 'day-num';
  num.textContent = day.getUTCDate() === 1 && !inMonth
    ? '1 ' + day.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    : day.getUTCDate();
  head.appendChild(num);
  cell.appendChild(head);

  let label = formatDayTitle(dateStr);
  const time = meetings[dateStr];
  if (time) {
    cell.classList.add(isUpcoming(dateStr) ? 'meeting-upcoming' : 'meeting-past');
    if (dateStr === next) {
      const tag = document.createElement('span');
      tag.className = 'next-tag';
      tag.textContent = 'Next';
      head.appendChild(tag);
    }
    const meeting = document.createElement('div');
    meeting.className = 'meeting-time';
    const clock = document.createElement('span');
    clock.className = 'clock';
    clock.textContent = '🕗 ';
    meeting.append(clock, time);
    cell.appendChild(meeting);
    label += ', meeting at ' + time;
  }

  if (jsonData) {
    const dots = document.createElement('div');
    dots.className = 'dots';
    const logged = [];
    jsonData.users.forEach((user, i) => {
      const hours = hoursOn(user, dateStr);
      if (!hours) return;
      const tip = user.displayName + ' — ' + formatDuration(hours * 60);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = userColor(i);
      dot.dataset.tip = tip;
      dots.appendChild(dot);
      logged.push(tip);
    });
    if (logged.length) {
      cell.appendChild(dots);
      label += ', ' + logged.join(', ');
    }
  }

  cell.setAttribute('aria-label', label);
  return cell;
}

function renderCalendar() {
  const first = new Date(Date.UTC(view.year, view.month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;
  const start = first.getTime() - offset * DAY_MS;
  const today = todayStr();
  const next = nextMeetingDate();

  document.getElementById('monthTitle').textContent =
    first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const cells = [];
  for (let i = 0; i < cellCount; i++) {
    const day = new Date(start + i * DAY_MS);
    cells.push(buildCell(toDateStr(day), day.getUTCMonth() === view.month, today, next));
  }
  hideDotTip();
  document.getElementById('grid').replaceChildren(...cells);
  renderedFor = today + '|' + next;
}

function renderAll() {
  renderHeader();
  renderCalendar();
}

function showMonth(dateStr) {
  const d = utcDate(dateStr);
  view = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  renderCalendar();
}

function moveMonth(step) {
  const d = new Date(Date.UTC(view.year, view.month + step, 1));
  view = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  renderCalendar();
}

// --- Dot tooltip ---

function getDotTip() {
  let tip = document.getElementById('dotTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'dotTip';
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

function showDotTip(dot) {
  const tip = getDotTip();
  tip.textContent = dot.dataset.tip;
  tip.hidden = false;
  const rect = dot.getBoundingClientRect();
  const width = tip.offsetWidth;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  tip.style.left = left + 'px';
  tip.style.top = Math.max(8, rect.top - tip.offsetHeight - 6) + 'px';
}

function hideDotTip() {
  const tip = document.getElementById('dotTip');
  if (tip) tip.hidden = true;
}

// --- Day popup ---

function getDayBoxEls() {
  if (dayBoxEls) return dayBoxEls;

  const box = document.createElement('div');
  box.id = 'dayBox';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-labelledby', 'dayTitle');

  const head = document.createElement('div');
  head.className = 'day-box-head';
  const title = document.createElement('div');
  title.className = 'day-title';
  title.id = 'dayTitle';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'day-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', closeDayBox);
  head.append(title, close);

  const hoursLabel = document.createElement('div');
  hoursLabel.className = 'section-label';
  hoursLabel.textContent = 'Logged';
  const hours = document.createElement('ul');
  hours.className = 'day-hours';
  const noData = document.createElement('div');
  noData.className = 'day-empty';
  noData.textContent = 'No study data for this day.';

  const meetingLabel = document.createElement('div');
  meetingLabel.className = 'section-label';
  meetingLabel.textContent = 'Meeting';
  const meetingView = document.createElement('div');
  meetingView.className = 'meeting-view';

  const form = document.createElement('form');
  form.className = 'meeting-form';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.required = true;
  dateInput.setAttribute('aria-label', 'Meeting day');
  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.required = true;
  timeInput.setAttribute('aria-label', 'Meeting time');
  const buttons = document.createElement('div');
  buttons.className = 'form-buttons';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', deleteOpenMeeting);
  buttons.append(saveBtn, deleteBtn);
  form.append(dateInput, timeInput, buttons);
  form.addEventListener('submit', submitMeeting);

  const unlock = document.createElement('form');
  unlock.className = 'meeting-unlock';
  const passcode = document.createElement('input');
  passcode.type = 'password';
  passcode.placeholder = 'Passcode to edit';
  passcode.autocomplete = 'off';
  const unlockBtn = document.createElement('button');
  unlockBtn.type = 'submit';
  unlockBtn.className = 'btn btn-primary';
  unlockBtn.textContent = 'OK';
  unlock.append(passcode, unlockBtn);
  unlock.addEventListener('submit', event => {
    event.preventDefault();
    unlockMeetings(passcode.value);
  });

  const status = document.createElement('div');
  status.className = 'day-status';
  status.setAttribute('aria-live', 'polite');

  box.append(head, hoursLabel, hours, noData, meetingLabel, meetingView, form, unlock, status);
  document.body.appendChild(box);

  dayBoxEls = { box, title, close, hours, noData, meetingView, form, dateInput, timeInput, saveBtn, deleteBtn, unlock, passcode, status };
  return dayBoxEls;
}

function canEditMeetings() {
  return meetingsWritable && !!readStorage(PASSCODE_KEY);
}

function showDayHours() {
  const { hours, noData } = getDayBoxEls();
  const rows = [];
  if (jsonData) {
    jsonData.users.forEach((user, i) => {
      const h = hoursOn(user, openDay);
      if (h === null) return;
      const row = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = userColor(i);
      const value = document.createElement('span');
      value.className = 'hours' + (h ? '' : ' none');
      value.textContent = h ? formatDuration(h * 60) : '—';
      row.append(dot, user.displayName, value);
      rows.push(row);
    });
  }
  hours.replaceChildren(...rows);
  hours.hidden = !rows.length;
  noData.hidden = !!rows.length;
}

function showDayState() {
  const { title, close, meetingView, form, dateInput, timeInput, saveBtn, deleteBtn, unlock, passcode, status } = getDayBoxEls();
  const time = meetings[openDay] || '';
  const editable = canEditMeetings();

  title.textContent = formatDayTitle(openDay);
  showDayHours();

  meetingView.hidden = editable;
  meetingView.textContent = time ? '🕗 ' + time + (isUpcoming(openDay) ? '' : ' (past)') : 'No meeting';

  form.hidden = !editable;
  dateInput.value = openDay;
  timeInput.value = time || lastMeetingTime();
  saveBtn.textContent = time ? 'Save' : 'Add meeting';
  deleteBtn.hidden = !time;

  unlock.hidden = editable || !meetingsWritable;
  passcode.value = '';
  status.textContent = meetingsWritable ? '' : 'Read-only right now (can’t reach the server)';

  if (editable) timeInput.focus();
  else if (meetingsWritable) passcode.focus();
  else close.focus();
}

function openDayBox(dateStr) {
  hideDotTip();
  openDay = dateStr;
  getDayBoxEls().box.hidden = false;
  showDayState();
}

function closeDayBox() {
  if (!openDay) return;
  const date = openDay;
  openDay = null;
  getDayBoxEls().box.hidden = true;
  const cell = document.querySelector('.cell[data-date="' + date + '"]');
  if (cell && document.activeElement === document.body) cell.focus();
}

async function unlockMeetings(passcode) {
  const day = openDay;
  const { status } = getDayBoxEls();
  status.textContent = 'Checking...';
  const message = await checkPasscode(passcode);

  if (openDay !== day) return;
  if (message) status.textContent = message;
  else showDayState();
}

function submitMeeting(event) {
  event.preventDefault();
  const { dateInput, timeInput, status } = getDayBoxEls();
  const from = openDay;
  const date = dateInput.value;
  const time = timeInput.value;

  if (date !== from && meetings[date]) {
    status.textContent = 'There is already a meeting on ' + formatDayTitle(date);
    return;
  }

  const change = { date, time };
  if (date !== from && meetings[from]) change.from = from;
  closeDayBox();
  saveMeeting(change);
  showMonth(date);
}

function deleteOpenMeeting() {
  const date = openDay;
  closeDayBox();
  saveMeeting({ date, time: '' });
}

function setMeeting(dateStr, time) {
  if (time) meetings[dateStr] = time;
  else delete meetings[dateStr];
}

// Shows the change at once, and undoes it if the server doesn't take it.
function saveMeeting(change) {
  const days = change.from ? [change.date, change.from] : [change.date];
  const before = days.map(d => meetings[d] || '');
  if (change.from) setMeeting(change.from, '');
  setMeeting(change.date, change.time);
  const after = days.map(d => meetings[d] || '');
  renderAll();

  meetingSaveQueue = meetingSaveQueue.then(async () => {
    try {
      const res = await fetch(API_URL + '/meetings', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Notes-Passcode': readStorage(PASSCODE_KEY) || '' },
        body: JSON.stringify(change)
      });
      if (res.status === 401) {
        writeStorage(PASSCODE_KEY, null);
        throw new Error('wrong passcode');
      }
      if (!res.ok) throw new Error('server error');
    } catch (err) {
      // Only undo if nobody changed these days again in the meantime.
      if (days.every((d, i) => (meetings[d] || '') === after[i])) {
        days.forEach((d, i) => setMeeting(d, before[i]));
      }
      renderAll();
      if (openDay) showDayState();
      const reason = err.message === 'wrong passcode' ? err.message : 'connection problem';
      showToast('Meeting not saved (' + reason + ').');
    }
  });
}

async function loadMeetings() {
  const result = await fetchMeetings();
  meetings = { ...result.meetings };
  meetingsWritable = result.writable;
}

function openNextMeeting() {
  const next = nextMeetingDate();
  if (!next) return;
  showMonth(next);
  openDayBox(next);
}

// The reminder icon links to calendar.html#next.
function openLinkedMeeting() {
  if (location.hash !== '#next') return;
  history.replaceState(null, '', location.pathname + location.search);
  openNextMeeting();
}

// Keeps "in 2h 10 min", today's highlight and the next meeting current while the page stays open.
function refresh() {
  renderHeader();
  if (todayStr() + '|' + nextMeetingDate() !== renderedFor) renderCalendar();
}

function initCalendar() {
  const now = new Date();
  view = { year: now.getFullYear(), month: now.getMonth() };

  document.getElementById('prevMonth').addEventListener('click', () => moveMonth(-1));
  document.getElementById('nextMonth').addEventListener('click', () => moveMonth(1));
  document.getElementById('todayBtn').addEventListener('click', () => showMonth(todayStr()));
  document.getElementById('nextMeetingBtn').addEventListener('click', openNextMeeting);
  window.addEventListener('hashchange', openLinkedMeeting);

  const grid = document.getElementById('grid');
  grid.addEventListener('click', event => {
    const cell = event.target.closest('.cell');
    if (cell) openDayBox(cell.dataset.date);
  });
  grid.addEventListener('keydown', event => {
    const cell = event.target.closest('.cell');
    if (cell && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openDayBox(cell.dataset.date);
    }
  });
  grid.addEventListener('mouseover', event => {
    if (event.target.classList.contains('dot')) showDotTip(event.target);
  });
  grid.addEventListener('mouseout', event => {
    if (event.target.classList.contains('dot')) hideDotTip();
  });

  document.addEventListener('mousedown', event => {
    if (openDay && !getDayBoxEls().box.contains(event.target)) closeDayBox();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDayBox();
  });
  window.addEventListener('scroll', hideDotTip, { passive: true });

  renderCalendar();
}

document.addEventListener('DOMContentLoaded', async () => {
  initCalendar();

  const [dataResult] = await Promise.allSettled([loadData(), loadMeetings()]);
  if (dataResult.status === 'fulfilled') {
    renderLegend();
    document.getElementById('updated').textContent = 'Last updated: ' + new Date(jsonData.updatedAt).toLocaleString();
  } else {
    jsonData = null;
    DATA_START = null;
    showError(document.getElementById('dataError'), dataResult.reason);
  }

  renderAll();
  if (openDay) showDayState();
  openLinkedMeeting();
  setInterval(refresh, REFRESH_MS);
});
