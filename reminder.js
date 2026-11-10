// Calendar icon in the top-right corner of every page; hovering shows the next meeting. Needs common.js and theme.js.
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
  if (!reminderEls || !reminderMeetings) return;
  const { link, label, when, countdown } = reminderEls;
  const next = nextMeetingIn(reminderMeetings);

  link.classList.toggle('has-meeting', !!next);
  link.href = next ? 'calendar.html#next' : 'calendar.html';
  if (next) {
    const time = reminderMeetings[next];
    label.textContent = 'Next meeting';
    when.textContent = formatDayTitle(next) + ' · ' + time;
    countdown.textContent = meetingCountdown(next, time);
    link.setAttribute('aria-label', 'Next meeting: ' + formatDayTitle(next) + ' at ' + time + ', ' + countdown.textContent);
  } else {
    label.textContent = 'No meeting set';
    when.textContent = '';
    countdown.textContent = 'Click to open the calendar';
    link.setAttribute('aria-label', 'No meeting set. Open the calendar');
  }
}

function buildReminder() {
  const link = document.createElement('a');
  link.className = 'meeting-reminder';
  link.href = 'calendar.html';
  link.setAttribute('aria-label', 'Meetings');
  link.innerHTML = REMINDER_ICON;

  const tip = document.createElement('span');
  tip.className = 'reminder-tip';
  tip.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'reminder-label';
  const when = document.createElement('span');
  when.className = 'reminder-when';
  const countdown = document.createElement('span');
  countdown.className = 'reminder-countdown';
  tip.append(label, when, countdown);
  link.appendChild(tip);

  cornerTools().prepend(link);
  reminderEls = { link, label, when, countdown };
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
