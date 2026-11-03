// Day notes for the chart pages. Needs common.js.
const NOTES_API_URL = 'https://grind-grid-notes.castawayfocuspirate-a34.workers.dev';
const NOTES_ENABLED_KEY = 'grindgrid.notesEnabled';
const NOTES_PASSCODE_KEY = 'grindgrid.notesPasscode';
const NOTES_DRAFTS_KEY = 'grindgrid.noteDrafts';
const NOTE_MAX_LENGTH = 200;
const NOTE_DOT_COLOR = '#f59e0b';
const NOTES_LOAD_TIMEOUT_MS = 5000;
const NOTE_TOAST_MS = 5000;

let notes = {};
let notesWritable = false;
let openNote = null;
let noteBoxEls = null;
let noteSaveQueue = Promise.resolve();
let noteToastTimer = null;

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

function notesEnabled() {
  return readStorage(NOTES_ENABLED_KEY) !== 'false';
}

function noteFor(username, date) {
  return notes[username]?.[date] || '';
}

function setNote(username, date, text) {
  if (!notes[username]) notes[username] = {};
  if (text) notes[username][date] = text;
  else delete notes[username][date];
}

function readDrafts() {
  try {
    return JSON.parse(readStorage(NOTES_DRAFTS_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function setDraft(username, date, text) {
  const drafts = readDrafts();
  const key = username + '|' + date;
  if (text === null) delete drafts[key];
  else drafts[key] = text;
  writeStorage(NOTES_DRAFTS_KEY, JSON.stringify(drafts));
}

function refreshNoteDots() {
  activeCharts.forEach(chart => chart.update('none'));
}

async function fetchNotesJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function loadNotes() {
  let loaded = {};
  let writable = false;
  try {
    if (!NOTES_API_URL) throw new Error('Notes API not configured');
    loaded = await fetchNotesJson(NOTES_API_URL + '/notes', { signal: AbortSignal.timeout(NOTES_LOAD_TIMEOUT_MS) });
    writable = true;
  } catch (e) {
    try {
      loaded = await fetchNotesJson('notes.json');
    } catch (e2) {}
  }

  if (!notesEnabled()) return;
  notes = loaded;
  notesWritable = writable;
  refreshNoteDots();
  if (openNote) showNoteState();
}

// Spread into a chart's first dataset: days with a note get a larger amber dot.
function noteDotOptions(username, startIdx, baseRadius, baseHoverRadius, baseColor) {
  const hasNote = ctx => !!noteFor(username, toDateStr(idxToDate(startIdx + ctx.dataIndex)));
  const noteRadius = Math.max(baseRadius + 3, 5);
  return {
    pointRadius: ctx => hasNote(ctx) ? noteRadius : baseRadius,
    pointHoverRadius: ctx => hasNote(ctx) ? noteRadius + 1 : baseHoverRadius,
    pointBackgroundColor: ctx => hasNote(ctx) ? NOTE_DOT_COLOR : baseColor
  };
}

function attachNotes(chart, canvas, user, startIdx) {
  canvas.addEventListener('dblclick', event => {
    if (!notesEnabled()) return;
    const hit = chart.getElementsAtEventForMode(event, 'index', { intersect: false }, false);
    if (hit.length) openNoteBox(user, toDateStr(idxToDate(startIdx + hit[0].index)));
  });
}

function getNoteBoxEls() {
  if (noteBoxEls) return noteBoxEls;

  const box = document.createElement('div');
  box.id = 'noteBox';
  box.hidden = true;
  box.setAttribute('role', 'dialog');

  const title = document.createElement('div');
  title.className = 'note-title';

  const text = document.createElement('textarea');
  text.className = 'note-text';
  text.maxLength = NOTE_MAX_LENGTH;
  text.addEventListener('input', showNoteCounter);

  const status = document.createElement('div');
  status.className = 'note-status';

  const unlock = document.createElement('form');
  unlock.className = 'note-unlock';
  const passcode = document.createElement('input');
  passcode.type = 'password';
  passcode.placeholder = 'Passcode to edit';
  passcode.autocomplete = 'off';
  const unlockBtn = document.createElement('button');
  unlockBtn.type = 'submit';
  unlockBtn.textContent = 'OK';
  unlock.append(passcode, unlockBtn);
  unlock.addEventListener('submit', event => {
    event.preventDefault();
    verifyPasscode(passcode.value);
  });

  box.append(title, text, status, unlock);
  document.body.appendChild(box);

  noteBoxEls = { box, title, text, status, unlock, passcode };
  return noteBoxEls;
}

function canEditNotes() {
  return notesWritable && !!readStorage(NOTES_PASSCODE_KEY);
}

function showNoteCounter() {
  const { text, status } = getNoteBoxEls();
  status.textContent = text.value.length + '/' + NOTE_MAX_LENGTH;
}

function showNoteState() {
  const { text, status, unlock, passcode } = getNoteBoxEls();
  const editable = canEditNotes();
  const draft = readDrafts()[openNote.username + '|' + openNote.date];

  openNote.saved = noteFor(openNote.username, openNote.date);
  text.value = editable && draft !== undefined ? draft : openNote.saved;
  text.readOnly = !editable;
  unlock.hidden = editable || !notesWritable;
  passcode.value = '';

  if (editable) {
    showNoteCounter();
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
  } else {
    status.textContent = notesWritable ? '' : 'Read-only';
    if (notesWritable) passcode.focus();
  }
}

function openNoteBox(user, date) {
  closeNoteBox();
  const { box, title } = getNoteBoxEls();
  openNote = { username: user.username, date, saved: '' };
  title.textContent = user.displayName + ' — ' + formatChartLabel(new Date(date + 'T00:00:00Z'));
  box.hidden = false;
  showNoteState();
}

function closeNoteBox() {
  if (!openNote) return;
  const { box, text } = getNoteBoxEls();
  const { username, date, saved } = openNote;
  const editable = canEditNotes();
  const value = text.value.trim();

  openNote = null;
  box.hidden = true;

  if (!editable) return;
  if (value === saved) setDraft(username, date, null);
  else saveNote(username, date, value, saved);
}

function saveNote(username, date, text, previous) {
  setNote(username, date, text);
  refreshNoteDots();

  noteSaveQueue = noteSaveQueue.then(async () => {
    try {
      const res = await fetch(NOTES_API_URL + '/notes', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Notes-Passcode': readStorage(NOTES_PASSCODE_KEY) || '' },
        body: JSON.stringify({ username, date, text })
      });
      if (res.status === 401) {
        writeStorage(NOTES_PASSCODE_KEY, null);
        throw new Error('wrong passcode');
      }
      if (!res.ok) throw new Error('server error');
      setDraft(username, date, null);
    } catch (err) {
      setDraft(username, date, text);
      if (noteFor(username, date) === text) setNote(username, date, previous);
      refreshNoteDots();
      const reason = err.message === 'wrong passcode' ? err.message : 'connection problem';
      showNoteToast('Note not saved (' + reason + '). Your text is kept for next time.');
    }
  });
}

async function verifyPasscode(passcode) {
  const note = openNote;
  const { status } = getNoteBoxEls();
  status.textContent = 'Checking...';
  let message;
  try {
    const res = await fetch(NOTES_API_URL + '/verify', {
      method: 'POST',
      headers: { 'X-Notes-Passcode': passcode }
    });
    if (res.ok) writeStorage(NOTES_PASSCODE_KEY, passcode);
    else message = res.status === 401 ? 'Wrong passcode' : 'Server error';
  } catch (e) {
    message = 'Connection problem';
  }

  if (openNote !== note) return;
  if (message) status.textContent = message;
  else showNoteState();
}

function showNoteToast(message) {
  let toast = document.getElementById('noteToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'noteToast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(noteToastTimer);
  noteToastTimer = setTimeout(() => { toast.hidden = true; }, NOTE_TOAST_MS);
}

function initNotes() {
  const toggle = document.getElementById('notesToggle');
  toggle.checked = notesEnabled();
  toggle.addEventListener('change', () => {
    closeNoteBox();
    writeStorage(NOTES_ENABLED_KEY, String(toggle.checked));
    if (toggle.checked) {
      loadNotes();
    } else {
      notes = {};
      notesWritable = false;
      refreshNoteDots();
    }
  });

  document.addEventListener('mousedown', event => {
    if (openNote && !getNoteBoxEls().box.contains(event.target)) closeNoteBox();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeNoteBox();
  });
  window.addEventListener('pagehide', closeNoteBox);

  if (notesEnabled()) loadNotes();
}
