// Goals page: each user's week, month and custom goals, and how much a day they still need. Needs common.js.
// A goal is { id, kind, start, end, minutes }: reach `minutes` logged from start to end, both days included
// (goals.json, saved through the worker). Days count in the group's time zone, like data.json.
const GOALS_LOAD_TIMEOUT_MS = 5000;
const MAX_CUSTOM_GOALS = 3;
const CUSTOM_MONTHS_AHEAD = 3;
const WEEK_SUGGESTIONS = 8;
const MONTH_SUGGESTIONS = 6;
const DAY_MINUTES = 1440;
const GOAL_TOAST_MS = 4500;
// After a goal is saved, one of these for how much a day it takes (4-hour bands, up to 24h).
const GOAL_QUIPS = [
  { below: 4 * 60, quips: ['A gentle stroll. Your future self is already relaxing.', 'Easy mode. Don\'t tell the others.', 'Light work. Maybe water a plant too.'] },
  { below: 8 * 60, quips: ['A solid shift. Coffee optional, but recommended.', 'Honest work for honest hours.', 'Steady wins. The tortoise approves.'] },
  { below: 12 * 60, quips: ['Full-time grinder. Clock in, legend.', 'Your chair is going to know your name.', 'Snacks are now part of the plan.'] },
  { below: 16 * 60, quips: ['Coffee is now a food group.', 'Friends? You\'ll see them at the finish line.', 'Bold. Very bold. We like it.'] },
  { below: 20 * 60, quips: ['Sleep is more of a suggestion now.', 'Your desk lamp just filed a complaint.', 'Main character energy, side character sleep schedule.'] },
  { below: DAY_MINUTES + 1, quips: ['Study in your dreams too. Literally.', 'The sun will rise and set. You will not move.', 'Possible on paper. Paper doesn\'t need sleep.'] }
];
const REACHED_QUIPS = ['Already there. Set the bar higher? 🎉', 'Goal reached before it started. Show-off.'];
const GOAL_TABS = [
  { kind: 'week', label: 'Week' },
  { kind: 'month', label: 'Month' },
  { kind: 'custom', label: 'Custom' }
];

let goals = {};
let goalsWritable = false;
let dataEnd = null;
// The open popup: { user, tab, custom, afterUnlock } where custom is null (the list), 'new', or the id of the goal
// being edited. With afterUnlock ({ title, run }) the popup only asks for the passcode, then closes and calls run().
let goalForm = null;
let goalBoxEls = null;

// --- Dates (YYYY-MM-DD strings, which compare in date order) ---

function addDays(dateStr, days) {
  return toDateStr(new Date(utcDate(dateStr).getTime() + days * DAY_MS));
}

function daysInRange(start, end) {
  return Math.round((utcDate(end) - utcDate(start)) / DAY_MS) + 1;
}

function groupToday() {
  return dateStrAt(Date.now(), GROUP_TIME_ZONE);
}

function weekStartOf(dateStr) {
  return addDays(dateStr, -((utcDate(dateStr).getUTCDay() + 6) % 7));
}

function monthEndOf(dateStr) {
  const d = utcDate(dateStr);
  return toDateStr(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

// The same day some months later, or that month's last day when it is shorter (31 Aug + 3 months = 30 Nov).
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return toDateStr(new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))));
}

const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);

// The current week or month as a goal's start and end.
function periodOf(kind, today) {
  if (kind === 'week') {
    const start = weekStartOf(today);
    return { start, end: addDays(start, 6) };
  }
  return { start: today.slice(0, 8) + '01', end: monthEndOf(today) };
}

// --- Formatting ---

// "4h 38m", "1,240h 05m".
function formatMinutes(mins) {
  const total = Math.max(0, Math.round(mins));
  return Math.floor(total / 60).toLocaleString('en-GB') + 'h ' + String(total % 60).padStart(2, '0') + 'm';
}

// "0h", "45m", "6h 10m": a short amount for running text.
function formatShort(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (!h) return m ? m + 'm' : '0h';
  return m ? h + 'h ' + m + 'm' : h + 'h';
}

// "23 Nov", with the year when it isn't this year's.
function shortDate(dateStr) {
  const d = utcDate(dateStr);
  const sameYear = dateStr.slice(0, 4) === groupToday().slice(0, 4);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric', timeZone: 'UTC' });
}

// "16–22 Nov", "30 Nov – 6 Dec".
function shortRange(start, end) {
  if (start.slice(0, 7) === end.slice(0, 7)) return utcDate(start).getUTCDate() + '–' + shortDate(end);
  return shortDate(start) + ' – ' + shortDate(end);
}

function monthName(dateStr) {
  const sameYear = dateStr.slice(0, 4) === groupToday().slice(0, 4);
  return utcDate(dateStr).toLocaleDateString('en-GB', { month: 'long', year: sameYear ? undefined : 'numeric', timeZone: 'UTC' });
}

function isoWeekOf(dateStr) {
  const t = utcDate(dateStr);
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7);
}

// The user's first day with time logged: a custom goal counting from it (or earlier) is "all-time".
function firstLoggedDay(user) {
  const i = user.daily.findIndex(h => h > 0);
  return toDateStr(idxToDate(Math.max(0, i)));
}

// "Week 48 · 23–29 Nov", "November", "Custom · all-time → 31 Dec".
function goalName(user, goal) {
  if (goal.kind === 'week') return 'Week ' + isoWeekOf(goal.start) + ' · ' + shortRange(goal.start, goal.end);
  if (goal.kind === 'month') return monthName(goal.start);
  const from = goal.start <= firstLoggedDay(user) ? 'all-time' : shortDate(goal.start);
  return 'Custom · ' + from + ' → ' + shortDate(goal.end);
}

// --- Sums ---

function minutesOnIdx(user, idx) {
  if (idx < 0 || idx >= user.daily.length) return 0;
  return user.dailyMinutes ? user.dailyMinutes[idx] : Math.round(user.daily[idx] * 60);
}

// Minutes logged from start to end (both included); days outside data.json count as 0.
function loggedMinutes(user, start, end) {
  const from = Math.max(0, Math.round((utcDate(start) - DATA_START) / DAY_MS));
  const to = Math.min(user.daily.length - 1, Math.round((utcDate(end) - DATA_START) / DAY_MS));
  let sum = 0;
  for (let i = from; i <= to; i++) sum += minutesOnIdx(user, i);
  return sum;
}

// How a goal stands with the newest data. Logged counts up to the newest day in data.json; the days still left are
// the ones after it, so today is one of them (and so is a day the nightly fetch missed). Per day rounds up, so
// doing exactly that much always reaches the goal. was is the same figure before the newest day came in.
function goalProgress(user, goal) {
  const logged = loggedMinutes(user, goal.start, minDate(goal.end, dataEnd));
  const remaining = goal.minutes - logged;
  const firstLeft = maxDate(goal.start, addDays(dataEnd, 1));
  const daysLeft = firstLeft <= goal.end ? daysInRange(firstLeft, goal.end) : 0;
  const perDay = remaining > 0 && daysLeft ? Math.ceil(remaining / daysLeft) : 0;

  let was = null;
  let lastDayMinutes = 0;
  if (remaining > 0 && dataEnd >= goal.start && dataEnd <= goal.end) {
    lastDayMinutes = minutesOnIdx(user, Math.round((utcDate(dataEnd) - DATA_START) / DAY_MS));
    was = Math.ceil((remaining + lastDayMinutes) / daysInRange(dataEnd, goal.end));
  }
  return { logged, remaining, firstLeft, daysLeft, perDay, was, lastDayMinutes };
}

function isPast(goal) {
  return goal.end < groupToday();
}

function userGoals(user) {
  return goals[user.username] || [];
}

function currentGoal(user, kind) {
  const { start } = periodOf(kind, groupToday());
  return userGoals(user).find(g => g.kind === kind && g.start === start) || null;
}

function runningCustomGoals(user) {
  return userGoals(user).filter(g => g.kind === 'custom' && !isPast(g)).sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
}

// --- Suggestions ---

// Past weeks or months before the current one, most recent first, with the best one marked.
function periodSuggestions(user, kind) {
  const today = groupToday();
  const count = kind === 'week' ? WEEK_SUGGESTIONS : MONTH_SUGGESTIONS;
  const firstData = toDateStr(DATA_START);
  const list = [];
  let { start } = periodOf(kind, today);
  for (let n = 0; n < count; n++) {
    start = kind === 'week' ? addDays(start, -7) : addMonths(start, -1);
    const end = kind === 'week' ? addDays(start, 6) : monthEndOf(start);
    if (end < firstData) break;
    const minutes = loggedMinutes(user, start, end);
    if (!minutes) continue;
    const label = kind === 'week' ? shortRange(start, end) : monthName(start);
    list.push({ label, minutes, fills: 'total' });
  }
  const best = Math.max(0, ...list.map(s => s.minutes));
  list.forEach(s => { s.best = list.length > 1 && s.minutes === best; });
  return list;
}

// For a custom goal: the hours of the same number of days just before the days left.
function customSuggestion(user, deadline) {
  const firstLeft = addDays(dataEnd, 1);
  if (!deadline || deadline < firstLeft) return [];
  const days = daysInRange(firstLeft, deadline);
  const start = addDays(dataEnd, -(days - 1));
  const minutes = loggedMinutes(user, start, dataEnd);
  if (!minutes) return [];
  return [{ label: 'Previous ' + days + ' day' + (days === 1 ? '' : 's') + ' (' + shortRange(start, dataEnd) + ')', minutes, fills: 'plus' }];
}

// --- Loading and saving ---

async function loadGoals() {
  try {
    goals = await fetchJson(API_URL + '/goals', { signal: AbortSignal.timeout(GOALS_LOAD_TIMEOUT_MS) });
    goalsWritable = true;
  } catch (e) {
    try {
      goals = await fetchJson('goals.json');
    } catch (e2) {
      goals = {};
    }
    goalsWritable = false;
  }
}

function canEditGoals() {
  return goalsWritable && !!readStorage(PASSCODE_KEY);
}

// Sends one change; returns null when saved, otherwise a message to show.
async function sendGoalChange(username, change) {
  try {
    const res = await fetch(API_URL + '/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Notes-Passcode': readStorage(PASSCODE_KEY) || '' },
      body: JSON.stringify({ username, ...change })
    });
    if (res.status === 401) {
      writeStorage(PASSCODE_KEY, null);
      return 'Wrong passcode';
    }
    if (res.status === 429) return TOO_MANY_TRIES;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return body.error || 'Server error';
    if (body.goals.length) goals[username] = body.goals;
    else delete goals[username];
    return null;
  } catch (e) {
    return 'Connection problem';
  }
}

// --- Cards ---

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function progressBar(fraction, reached) {
  const bar = el('div', 'goal-bar' + (reached ? ' reached' : ''));
  const fill = el('span');
  fill.style.width = Math.min(100, Math.max(0, fraction * 100)) + '%';
  bar.appendChild(fill);
  return bar;
}

// One running goal: name, logged / goal, a bar, and what a day it still needs.
function goalRow(user, goal) {
  const p = goalProgress(user, goal);
  const reached = p.remaining <= 0;
  const row = el('button', 'goal-row');
  row.type = 'button';

  const line = el('div', 'goal-line');
  line.append(
    el('span', 'goal-name', goalName(user, goal)),
    el('span', 'goal-nums', formatMinutes(p.logged) + ' / ' + formatMinutes(goal.minutes) + ' · ' + Math.floor(p.logged / goal.minutes * 100) + '%')
  );

  const need = el('div', 'goal-need');
  if (reached) {
    need.classList.add('reached');
    need.textContent = 'Goal reached 🎉' + (p.remaining < 0 ? ' +' + formatMinutes(-p.remaining) + ' over' : '');
  } else if (p.perDay > DAY_MINUTES) {
    need.classList.add('out-of-reach');
    need.textContent = 'Out of reach: it would take ' + formatMinutes(p.perDay) + ' a day for ' + p.daysLeft + ' day' + (p.daysLeft === 1 ? '' : 's');
  } else {
    need.append('Need ', el('strong', '', formatMinutes(p.perDay) + '/day'), ' for ' + p.daysLeft + ' day' + (p.daysLeft === 1 ? '' : 's'));
    // How the newest day moved it: up after a short day, down after a long one.
    if (p.was !== null && p.was !== p.perDay) {
      const up = p.perDay > p.was;
      const day = utcDate(dataEnd).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) + ' ' + shortDate(dataEnd);
      need.appendChild(el('span', 'goal-was ' + (up ? 'up' : 'down'),
        ' · ' + (up ? 'up' : 'down') + ' from ' + formatMinutes(p.was) + ' (' + formatShort(p.lastDayMinutes) + ' logged on ' + day + ')'));
    }
  }

  row.append(line, progressBar(p.logged / goal.minutes, reached), need);
  row.setAttribute('aria-label', goalName(user, goal) + ': ' + line.lastChild.textContent + '. ' + need.textContent + '. Edit');
  row.disabled = !goalsWritable;
  row.addEventListener('click', () => openGoalBox(user, goal.kind, goal.kind === 'custom' ? goal.id : null));
  return row;
}

function emptyRow(user, kind) {
  const row = el('button', 'goal-row empty', kind === 'week' ? 'No week goal' : 'No month goal');
  row.type = 'button';
  row.disabled = !goalsWritable;
  row.addEventListener('click', () => openGoalBox(user, kind, null));
  return row;
}

// A finished goal: its final total, ✓ or ✗ and by how much, and a Delete button.
function pastRow(user, goal) {
  const logged = loggedMinutes(user, goal.start, goal.end);
  const met = logged >= goal.minutes;
  const item = el('li', 'past-goal');
  const text = el('span', 'past-text');
  text.append(
    el('span', 'goal-name', goalName(user, goal)),
    ' ' + formatMinutes(logged) + ' / ' + formatMinutes(goal.minutes) + ' ',
    el('span', met ? 'met' : 'missed', (met ? '✓ +' : '✗ −') + formatMinutes(Math.abs(logged - goal.minutes)))
  );
  const del = el('button', 'btn btn-danger btn-small', 'Delete');
  del.type = 'button';
  del.hidden = !goalsWritable;
  del.addEventListener('click', () => deletePastGoal(user, goal, del));
  item.append(text, del);
  return item;
}

async function deletePastGoal(user, goal, button) {
  // Ask for the passcode, then carry on with this delete rather than show the goal form.
  if (!canEditGoals()) {
    openGoalBox(user, goal.kind, null, {
      title: 'Delete "' + goalName(user, goal) + '"',
      run: () => deletePastGoal(user, goal, button)
    });
    return;
  }
  if (!confirm('Delete "' + goalName(user, goal) + '"? This can\'t be undone.')) return;
  button.disabled = true;
  const message = await sendGoalChange(user.username, { action: 'delete', id: goal.id });
  if (message) {
    button.disabled = false;
    showToast('Goal not deleted (' + message.toLowerCase() + ').');
  }
  renderGoals();
}

function goalCard(user) {
  const card = el('section', 'goal-card');
  const head = el('div', 'goal-card-head');
  const who = el('div');
  who.append(el('div', 'goal-user', user.displayName), el('div', 'goal-habit', user.habitTitle));
  const setBtn = el('button', 'btn btn-primary', 'Set goal');
  setBtn.type = 'button';
  setBtn.disabled = !goalsWritable;
  setBtn.title = goalsWritable ? '' : 'Read-only right now (can’t reach the server)';
  setBtn.addEventListener('click', () => openGoalBox(user, 'week', null));
  head.append(who, setBtn);
  card.appendChild(head);

  for (const kind of ['week', 'month']) {
    const goal = currentGoal(user, kind);
    card.appendChild(goal ? goalRow(user, goal) : emptyRow(user, kind));
  }
  for (const goal of runningCustomGoals(user)) card.appendChild(goalRow(user, goal));

  const past = userGoals(user).filter(isPast).sort((a, b) => (a.end > b.end ? -1 : a.end < b.end ? 1 : 0));
  if (past.length) {
    const details = el('details', 'past-goals');
    details.dataset.user = user.username;
    details.open = openPastLists.has(user.username);
    details.addEventListener('toggle', () => {
      if (details.open) openPastLists.add(user.username);
      else openPastLists.delete(user.username);
    });
    const list = el('ul');
    list.append(...past.map(g => pastRow(user, g)));
    details.append(el('summary', '', 'Past goals (' + past.length + ')'), list);
    card.appendChild(details);
  }
  return card;
}

// Which users' past goal lists are open, so a redraw keeps them open.
const openPastLists = new Set();

function renderGoals() {
  if (!jsonData) return;
  document.getElementById('readOnly').hidden = goalsWritable;
  document.getElementById('goals').replaceChildren(...jsonData.users.map(goalCard));
}

// --- Popup ---

function numberInput(label, max) {
  const input = el('input');
  input.type = 'number';
  input.min = '0';
  if (max) input.max = String(max);
  input.step = '1';
  input.inputMode = 'numeric';
  input.setAttribute('aria-label', label);
  return input;
}

// Hours and minutes boxes side by side; value() reads them as minutes, set() fills them.
function durationInput(name) {
  const wrap = el('span', 'duration');
  const h = numberInput(name + ' hours');
  const m = numberInput(name + ' minutes', 59);
  wrap.append(h, el('span', 'unit', 'h'), m, el('span', 'unit', 'm'));
  return {
    wrap, h, m,
    empty: () => h.value === '' && m.value === '',
    clear: () => { h.value = ''; m.value = ''; },
    value: () => Math.max(0, parseInt(h.value, 10) || 0) * 60 + Math.min(59, Math.max(0, parseInt(m.value, 10) || 0)),
    set: mins => {
      const total = Math.max(0, Math.round(mins));
      h.value = String(Math.floor(total / 60));
      m.value = String(total % 60).padStart(2, '0');
    }
  };
}

function getGoalBoxEls() {
  if (goalBoxEls) return goalBoxEls;

  const box = el('div');
  box.id = 'goalBox';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-labelledby', 'goalTitle');

  const head = el('div', 'box-head');
  const title = el('div', 'box-title');
  title.id = 'goalTitle';
  const close = el('button', 'box-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closeGoalBox);
  head.append(title, close);

  const tabs = el('div', 'goal-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = GOAL_TABS.map(({ kind, label }) => {
    const tab = el('button', 'goal-tab', label);
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.dataset.kind = kind;
    tab.addEventListener('click', () => {
      goalForm.tab = kind;
      goalForm.custom = null;
      showGoalForm();
    });
    tabs.appendChild(tab);
    return tab;
  });

  const body = el('div', 'goal-body');

  const unlock = el('form', 'goal-unlock');
  const passcode = el('input');
  passcode.type = 'password';
  passcode.placeholder = 'Passcode to edit';
  passcode.autocomplete = 'off';
  const unlockBtn = el('button', 'btn btn-primary', 'OK');
  unlockBtn.type = 'submit';
  unlock.append(passcode, unlockBtn);
  unlock.addEventListener('submit', async event => {
    event.preventDefault();
    status.textContent = 'Checking...';
    const form = goalForm;
    const message = await checkPasscode(passcode.value);
    if (goalForm !== form) return;
    if (message) {
      status.textContent = message;
    } else if (form.afterUnlock) {
      closeGoalBox();
      form.afterUnlock.run();
    } else {
      showGoalForm();
    }
  });

  const status = el('div', 'goal-status');
  status.setAttribute('aria-live', 'polite');

  box.append(head, tabs, body, unlock, status);
  document.body.appendChild(box);
  goalBoxEls = { box, title, close, tabs, tabButtons, body, unlock, passcode, status };
  return goalBoxEls;
}

function openGoalBox(user, tab, custom, afterUnlock = null) {
  if (!goalsWritable) return;
  goalForm = { user, tab, custom, afterUnlock };
  getGoalBoxEls().box.hidden = false;
  showGoalForm();
}

function closeGoalBox() {
  if (!goalForm) return;
  goalForm = null;
  getGoalBoxEls().box.hidden = true;
}

function showGoalForm() {
  const { title, tabs, tabButtons, body, unlock, passcode, status } = getGoalBoxEls();
  const { user, tab, custom, afterUnlock } = goalForm;
  title.textContent = afterUnlock ? afterUnlock.title : 'Set a goal for ' + user.displayName;
  tabs.hidden = !!afterUnlock;
  tabButtons.forEach(t => t.setAttribute('aria-selected', String(t.dataset.kind === tab)));
  status.textContent = '';

  const editable = canEditGoals();
  unlock.hidden = editable;
  body.hidden = !editable;
  if (!editable) {
    passcode.value = '';
    passcode.focus();
    return;
  }
  if (tab === 'custom' && custom === null) body.replaceChildren(...customList(user));
  else body.replaceChildren(...goalEditor(user, tab, custom));
}

// The Custom tab's first view: the running custom goals, and a button for a new one (up to 3).
function customList(user) {
  const running = runningCustomGoals(user);
  const parts = [];
  if (running.length) {
    const list = el('ul', 'custom-list');
    for (const goal of running) {
      const item = el('li');
      const edit = el('button', 'btn btn-secondary btn-small', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', () => {
        goalForm.custom = goal.id;
        showGoalForm();
      });
      const del = el('button', 'btn btn-danger btn-small', 'Delete');
      del.type = 'button';
      del.addEventListener('click', () => deleteGoal(goal));
      item.append(el('span', 'custom-name', goalName(user, goal) + ' · ' + formatMinutes(goal.minutes)), edit, del);
      list.appendChild(item);
    }
    parts.push(list);
  } else {
    parts.push(el('div', 'goal-empty', 'No custom goals yet.'));
  }
  const add = el('button', 'btn btn-primary', '+ New custom goal');
  add.type = 'button';
  add.disabled = running.length >= MAX_CUSTOM_GOALS;
  add.addEventListener('click', () => {
    goalForm.custom = 'new';
    showGoalForm();
  });
  parts.push(add);
  if (add.disabled) parts.push(el('div', 'goal-hint', 'You have ' + MAX_CUSTOM_GOALS + ' custom goals running, the most at once.'));
  return parts;
}

function labelled(text, control) {
  const row = el('div', 'goal-field');
  row.append(el('span', 'field-label', text), control);
  return row;
}

function dateInput(label, min, max) {
  const input = el('input');
  input.type = 'date';
  input.required = true;
  if (min) input.min = min;
  if (max) input.max = max;
  input.setAttribute('aria-label', label);
  return input;
}

// The form for one goal: what's logged so far, the linked "+ more" and Total boxes, suggestions, and the live
// result. Typing in either box fills the other; the one typed in last stays put when the dates change.
function goalEditor(user, kind, customId) {
  const today = groupToday();
  const existing = kind === 'custom' ? userGoals(user).find(g => g.id === customId) || null : currentGoal(user, kind);
  const state = kind === 'custom'
    ? { start: existing ? existing.start : firstLoggedDay(user), end: existing ? existing.end : addDays(today, 6) }
    : periodOf(kind, today);
  let anchor = existing ? 'total' : kind === 'custom' ? 'plus' : 'total';

  const parts = [];
  let startInput = null;
  let endInput = null;
  if (kind === 'custom') {
    startInput = dateInput('Counting from', toDateStr(DATA_START), today);
    startInput.value = state.start;
    const fromStart = el('button', 'btn btn-secondary btn-small', 'From the beginning');
    fromStart.type = 'button';
    fromStart.addEventListener('click', () => { startInput.value = firstLoggedDay(user); update(); });
    const fromToday = el('button', 'btn btn-secondary btn-small', 'From today');
    fromToday.type = 'button';
    fromToday.addEventListener('click', () => { startInput.value = today; update(); });
    const startRow = el('span', 'date-row');
    startRow.append(startInput, fromStart, fromToday);
    parts.push(labelled('Counting from', startRow));
    startInput.addEventListener('input', update);
  } else {
    parts.push(el('div', 'goal-period', kind === 'week'
      ? 'Week ' + isoWeekOf(state.start) + ' · ' + shortRange(state.start, state.end)
      : monthName(state.start) + ' · ' + shortRange(state.start, state.end)));
  }

  if (kind === 'custom') {
    endInput = dateInput('Deadline', today, addMonths(today, CUSTOM_MONTHS_AHEAD));
    endInput.value = state.end;
    endInput.addEventListener('input', update);
    parts.push(labelled('Deadline', endInput));
  }

  // One line that reads as the sum: 72h 33m logged so far + [ ]h [ ]m = [ ]h [ ]m total.
  const loggedEl = el('strong', 'goal-logged');
  const plus = durationInput('More');
  const total = durationInput('Total');
  const sum = el('div', 'goal-sum');
  const logged = el('span', 'sum-part');
  logged.append(loggedEl, el('span', 'sum-caption', 'logged so far'));
  const totalPart = el('span', 'sum-part');
  totalPart.append(total.wrap, el('span', 'sum-caption', 'total'));
  sum.append(logged, el('span', 'op', '+'), plus.wrap, el('span', 'op', '='), totalPart);
  parts.push(sum);
  for (const input of [plus.h, plus.m]) input.addEventListener('input', () => { anchor = 'plus'; update(); });
  for (const input of [total.h, total.m]) input.addEventListener('input', () => { anchor = 'total'; update(); });

  const chips = el('div', 'goal-chips');
  parts.push(chips);
  const result = el('div', 'goal-result');
  parts.push(result);

  const buttons = el('div', 'form-buttons');
  const save = el('button', 'btn btn-primary', existing ? 'Save' : 'Save goal');
  save.type = 'button';
  save.addEventListener('click', () => saveGoal(user, kind, existing, { ...current(), minutes: total.value() }));
  buttons.appendChild(save);
  if (existing) {
    const del = el('button', 'btn btn-danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => deleteGoal(existing));
    buttons.appendChild(del);
  }
  const cancel = el('button', 'btn btn-secondary', kind === 'custom' ? 'Back' : 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => {
    if (kind === 'custom') {
      goalForm.custom = null;
      showGoalForm();
    } else {
      closeGoalBox();
    }
  });
  buttons.appendChild(cancel);
  parts.push(buttons);

  // The goal as it stands in the form.
  function current() {
    const start = startInput ? startInput.value : state.start;
    const end = endInput ? endInput.value : state.end;
    return { kind, start, end };
  }

  function update() {
    const { start, end } = current();
    const datesOk = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= today && end >= today
      && (kind !== 'custom' || end <= addMonths(today, CUSTOM_MONTHS_AHEAD));
    const logged = datesOk ? loggedMinutes(user, start, minDate(end, dataEnd)) : 0;
    loggedEl.textContent = datesOk ? formatMinutes(logged) : '—';

    // Below what's logged already, "+ more" shows 0 and the result says it's reached.
    if (anchor === 'plus') {
      if (plus.empty()) total.clear();
      else total.set(logged + plus.value());
    } else if (total.empty()) {
      plus.clear();
    } else {
      plus.set(total.value() - logged);
    }

    const suggestions = kind === 'custom' ? customSuggestion(user, datesOk ? end : null) : periodSuggestions(user, kind);
    chips.replaceChildren(...suggestions.map(s => {
      const chip = el('button', 'chip' + (s.best ? ' best' : ''));
      chip.type = 'button';
      chip.textContent = s.label + ' · ' + formatMinutes(s.minutes) + (s.best ? ' ⭐' : '');
      const passed = s.fills === 'total' && s.minutes <= logged;
      if (passed) {
        chip.classList.add('passed');
        chip.appendChild(el('span', 'chip-note', ' (already passed)'));
      }
      chip.addEventListener('click', () => {
        if (s.fills === 'plus') {
          anchor = 'plus';
          plus.set(s.minutes);
        } else {
          anchor = 'total';
          total.set(s.minutes);
        }
        update();
      });
      return chip;
    }));

    const goal = { start, end, minutes: total.empty() ? 0 : total.value() };
    result.classList.remove('invalid');
    if (!datesOk) {
      result.textContent = kind === 'custom' ? 'Pick a start by today and a deadline from today to ' + shortDate(addMonths(today, CUSTOM_MONTHS_AHEAD)) + '.' : '';
      result.classList.add('invalid');
      save.disabled = true;
      return;
    }
    save.disabled = goal.minutes < 1;
    if (goal.minutes < 1) {
      result.textContent = '→ Type the hours you want';
      return;
    }
    const p = goalProgress(user, goal);
    if (p.perDay > DAY_MINUTES) {
      result.textContent = 'That would take ' + formatMinutes(p.perDay) + ' a day, more than a day has. Lower the total'
        + (kind === 'custom' ? ' or move the deadline.' : '.');
      result.classList.add('invalid');
      save.disabled = true;
      return;
    }
    result.textContent = p.remaining <= 0
      ? '→ Already reached'
      : '→ ' + formatMinutes(p.remaining) + ' more · ' + formatMinutes(p.perDay) + ' a day for ' + p.daysLeft + ' day' + (p.daysLeft === 1 ? '' : 's')
        + ' (' + (p.daysLeft === 1 ? shortDate(p.firstLeft) : shortRange(p.firstLeft, end)) + ')';
  }

  if (existing) total.set(existing.minutes);
  update();
  requestAnimationFrame(() => (anchor === 'plus' ? plus.h : total.h).focus());
  return parts;
}

async function saveGoal(user, kind, existing, form) {
  const { status } = getGoalBoxEls();
  const goal = { kind, start: form.start, end: form.end, minutes: form.minutes };
  if (kind === 'custom' && existing) goal.id = existing.id;

  status.textContent = 'Saving…';
  const open = goalForm;
  const message = await sendGoalChange(user.username, { action: 'set', goal });
  renderGoals();
  if (goalForm !== open) return;
  if (message) {
    status.textContent = message;
    if (message === 'Wrong passcode') showGoalForm();
    return;
  }
  showGoalQuip(goalProgress(user, goal));
  if (kind === 'custom') {
    goalForm.custom = null;
    showGoalForm();
  } else {
    closeGoalBox();
  }
}

const pick = list => list[Math.floor(Math.random() * list.length)];

// A short message for the goal just saved, by how much a day it takes. It fades out by itself; a click closes it.
function showGoalQuip(progress) {
  const text = progress.remaining <= 0
    ? pick(REACHED_QUIPS)
    : pick(GOAL_QUIPS.find(band => progress.perDay < band.below).quips);
  let toast = document.getElementById('goalToast');
  if (!toast) {
    toast = el('div');
    toast.id = 'goalToast';
    toast.setAttribute('role', 'status');
    toast.addEventListener('click', () => toast.classList.remove('shown'));
    document.body.appendChild(toast);
  }
  toast.replaceChildren(
    el('span', 'toast-pace', progress.remaining <= 0 ? 'Goal saved' : 'Goal saved · ' + formatMinutes(progress.perDay) + '/day'),
    el('span', 'toast-text', text)
  );
  // Restart the fade-in when one is already showing.
  toast.classList.remove('shown');
  void toast.offsetWidth;
  toast.classList.add('shown');
  clearTimeout(showGoalQuip.timer);
  showGoalQuip.timer = setTimeout(() => toast.classList.remove('shown'), GOAL_TOAST_MS);
}

async function deleteGoal(goal) {
  const { user } = goalForm;
  if (!confirm('Delete "' + goalName(user, goal) + '"? This can\'t be undone.')) return;
  const { status } = getGoalBoxEls();
  status.textContent = 'Deleting…';
  const open = goalForm;
  const message = await sendGoalChange(user.username, { action: 'delete', id: goal.id });
  renderGoals();
  if (goalForm !== open) return;
  if (message) {
    status.textContent = message;
    if (message === 'Wrong passcode') showGoalForm();
    return;
  }
  if (goal.kind === 'custom') {
    goalForm.custom = null;
    showGoalForm();
  } else {
    closeGoalBox();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.addEventListener('mousedown', event => {
    if (goalForm && !getGoalBoxEls().box.contains(event.target)) closeGoalBox();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeGoalBox();
  });

  const [dataResult] = await Promise.allSettled([loadData(), loadGoals()]);
  if (dataResult.status !== 'fulfilled') {
    showError(document.getElementById('goals'), dataResult.reason);
    return;
  }
  dataEnd = toDateStr(idxToDate(jsonData.labels.length - 1));
  document.getElementById('updated').textContent = 'Last updated: ' + new Date(jsonData.updatedAt).toLocaleString()
    + ' · hours counted up to ' + formatDayTitle(dataEnd);
  renderGoals();
});
