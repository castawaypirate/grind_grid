// Light, dark or system theme for every page. Load it in <head>, before the body, so the page never flashes the wrong theme.
const THEME_KEY = 'grindgrid.theme';
const THEME_MODES = [
  { mode: 'light', label: 'Light theme', icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>' },
  { mode: 'dark', label: 'Dark theme', icon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>' },
  { mode: 'system', label: 'Match system theme', icon: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>' }
];
const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const themeListeners = [];

function themeMode() {
  let mode = null;
  try {
    mode = localStorage.getItem(THEME_KEY);
  } catch (e) {}
  return THEME_MODES.some(m => m.mode === mode) ? mode : 'system';
}

// The theme actually shown: 'light' or 'dark'.
function currentTheme() {
  const mode = themeMode();
  if (mode !== 'system') return mode;
  return themeQuery.matches ? 'dark' : 'light';
}

function onThemeChange(fn) {
  themeListeners.push(fn);
}

function updateThemeSwitch() {
  const mode = themeMode();
  document.querySelectorAll('.theme-switch button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
}

function applyTheme() {
  const theme = currentTheme();
  const changed = document.documentElement.dataset.theme !== theme;
  document.documentElement.dataset.theme = theme;
  updateThemeSwitch();
  if (changed) themeListeners.forEach(fn => fn(theme));
}

function setThemeMode(mode) {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch (e) {}
  applyTheme();
}

// The bar across the top of every page: the meeting reminder (left) and the theme switch (right).
function cornerTools() {
  let corner = document.querySelector('.corner-tools');
  if (!corner) {
    corner = document.createElement('div');
    corner.className = 'corner-tools';
    document.body.prepend(corner);
  }
  return corner;
}

function buildThemeSwitch() {
  const group = document.createElement('div');
  group.className = 'theme-switch';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Theme');

  for (const { mode, label, icon } of THEME_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.mode = mode;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icon + '</svg>';
    button.addEventListener('click', () => setThemeMode(mode));
    group.appendChild(button);
  }

  cornerTools().appendChild(group);
  updateThemeSwitch();
}

applyTheme();
themeQuery.addEventListener('change', applyTheme);
// Another tab changed the theme.
window.addEventListener('storage', event => {
  if (event.key === THEME_KEY) applyTheme();
});
document.addEventListener('DOMContentLoaded', buildThemeSwitch);
