// Calendar icon in the top-left corner of every page; clicking it shows the next meeting. Needs common.js and theme.js.
const REMINDER_REFRESH_MS = 60000;
const REMINDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';

let reminderEls = null;
let reminderMeetings = null;

// The calendar page calls this whenever its meetings change.
function updateReminder(meetings) {
  reminderMeetings = meetings;
  renderReminder();
}

function renderReminder() {
  if (!reminderEls) return;
  const { button, label, when, countdown, link } = reminderEls;
  if (!reminderMeetings) {
    label.textContent = 'Meetings';
    countdown.textContent = 'Loading…';
    return;
  }

  const next = nextMeetingIn(reminderMeetings);
  button.classList.toggle('has-meeting', !!next);
  link.href = next ? 'calendar.html#next' : 'calendar.html';
  if (next) {
    const time = reminderMeetings[next];
    label.textContent = 'Next meeting';
    when.textContent = formatDayTitle(next) + ' · ' + time;
    countdown.textContent = meetingCountdown(next, time);
    button.setAttribute('aria-label', 'Next meeting: ' + formatDayTitle(next) + ' at ' + time + ', ' + countdown.textContent);
  } else {
    label.textContent = 'No meeting set';
    when.textContent = '';
    countdown.textContent = 'Add one on the calendar';
    button.setAttribute('aria-label', 'Next meeting: none set');
  }
}

function setReminderOpen(open) {
  const { box, button } = reminderEls;
  box.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
}

function buildReminder() {
  const box = document.createElement('div');
  box.className = 'meeting-reminder';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reminder-btn';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'reminderTip');
  button.setAttribute('aria-label', 'Next meeting');
  button.innerHTML = REMINDER_ICON;
  button.addEventListener('click', () => setReminderOpen(!box.classList.contains('open')));

  const tip = document.createElement('div');
  tip.className = 'reminder-tip';
  tip.id = 'reminderTip';
  const label = document.createElement('span');
  label.className = 'reminder-label';
  const when = document.createElement('span');
  when.className = 'reminder-when';
  const countdown = document.createElement('span');
  countdown.className = 'reminder-countdown';
  const link = document.createElement('a');
  link.className = 'reminder-link';
  link.textContent = 'Open calendar →';
  link.href = 'calendar.html';
  tip.append(label, when, countdown);
  // The calendar page already shows the meeting.
  if (typeof openNextMeeting !== 'function') tip.appendChild(link);

  box.append(button, tip);
  cornerTools().appendChild(box);
  reminderEls = { box, button, label, when, countdown, link };

  document.addEventListener('mousedown', event => {
    if (!box.contains(event.target)) setReminderOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && box.classList.contains('open')) {
      setReminderOpen(false);
      button.focus();
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof cornerTools !== 'function') return;
  buildReminder();
  renderReminder();
  setInterval(renderReminder, REMINDER_REFRESH_MS);

  const { meetings } = await fetchMeetings();
  // The calendar page may already have sent fresher meetings.
  if (!reminderMeetings) updateReminder(meetings);
});
