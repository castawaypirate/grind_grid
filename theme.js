// Light, dark or system theme for every page. Load it in <head>, before the body, so the page never flashes the wrong theme.
const THEME_KEY = 'grindgrid.theme';
const THEME_MODES = [
  { mode: 'light', label: 'Light theme', icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>' },
  { mode: 'dark', label: 'Dark theme', icon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>' },
  { mode: 'system', label: 'Match system theme', icon: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>' }
];
const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// How long a theme change fades; theme.css uses the same .4s.
const THEME_FADE_MS = 400;
const themeListeners = [];
let themeFadeTimer = null;
// The running crossfade (a view transition), if any.
let themeFade = null;

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

// data-after (how many buttons sit right of the chosen one) tells theme.css where to slide the highlight.
function updateThemeSwitch() {
  const mode = themeMode();
  document.querySelectorAll('.theme-switch').forEach(group => {
    const buttons = [...group.querySelectorAll('button')];
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    const chosen = buttons.findIndex(button => button.dataset.mode === mode);
    group.dataset.after = String(buttons.length - 1 - chosen);
  });
}

function applyTheme() {
  const theme = currentTheme();
  const changed = document.documentElement.dataset.theme !== theme;
  document.documentElement.dataset.theme = theme;
  updateThemeSwitch();
  if (changed) themeListeners.forEach(fn => fn(theme));
}

// Changes the theme with a short fade instead of a jump. Where the browser has view transitions the whole page
// crossfades, charts included; elsewhere only the CSS colors fade. The switch animates on its own either way.
function changeTheme() {
  const root = document.documentElement;
  if (themeFade) {
    // Starting another fade would cut this one short with a jump; follow on from it instead.
    themeFade.finished.finally(changeTheme);
  } else if (root.dataset.theme === currentTheme() || reducedMotion.matches || document.visibilityState !== 'visible') {
    applyTheme();
  } else if (document.startViewTransition) {
    // During the fade the browser sends every pointer event to the page root, so an open switch would lose its hover
    // and fold shut under a still pointer. .open holds it until the pointer moves after the fades, when hover is real again.
    document.querySelectorAll('.theme-switch').forEach(group => {
      if (group.matches(':hover')) group.classList.add('open');
    });
    themeFade = document.startViewTransition(applyTheme);
    themeFade.finished.finally(() => {
      themeFade = null;
    });
  } else {
    root.classList.add('theme-fading');
    applyTheme();
    clearTimeout(themeFadeTimer);
    themeFadeTimer = setTimeout(() => root.classList.remove('theme-fading'), THEME_FADE_MS);
  }
}

// The switch's highlight slides to the new choice while the page fades to it.
function setThemeMode(mode) {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch (e) {}
  updateThemeSwitch();
  changeTheme();
}

document.addEventListener('pointermove', () => {
  if (!themeFade) document.querySelectorAll('.theme-switch.open').forEach(group => group.classList.remove('open'));
});

// Clicks during the fade land on the page root too; hand one that hit a switch button over to that button.
document.addEventListener('click', event => {
  if (!themeFade || event.target.closest?.('.theme-switch')) return;
  const button = [...document.querySelectorAll('.theme-switch button')].find(b => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && event.clientX >= r.left && event.clientX < r.right && event.clientY >= r.top && event.clientY < r.bottom;
  });
  if (button) button.click();
});

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

// Closed, the switch shows only the chosen theme, at its right end, so opening it never moves the icon under the pointer.
// While it's open the icons stay put and the highlight slides between them; once it has closed (the other icons
// are 0 wide by then, so nothing visibly moves) the chosen button goes back to the right end.
function settleThemeSwitch(group) {
  const chosen = group.querySelector('button[aria-pressed="true"]');
  if (!chosen || chosen === group.lastElementChild) return;
  const closed = [...group.querySelectorAll('button')].every(b => b === chosen || b.getBoundingClientRect().width === 0);
  if (!closed) return;
  group.appendChild(chosen);
  updateThemeSwitch();
}

function buildThemeSwitch() {
  const group = document.createElement('div');
  group.className = 'theme-switch';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Theme');

  const highlight = document.createElement('span');
  highlight.className = 'theme-highlight';
  highlight.setAttribute('aria-hidden', 'true');
  group.appendChild(highlight);

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

  // Settle once the closing animation ends; the other events cover closing without animation (reduced motion).
  group.addEventListener('transitionend', event => {
    if (event.propertyName === 'width') settleThemeSwitch(group);
  });
  group.addEventListener('pointerleave', () => settleThemeSwitch(group));
  group.addEventListener('focusout', () => requestAnimationFrame(() => settleThemeSwitch(group)));

  cornerTools().appendChild(group);
  updateThemeSwitch();
  settleThemeSwitch(group);
}

// The first paint takes the theme at once, so the page never flashes the wrong one.
applyTheme();
themeQuery.addEventListener('change', changeTheme);
// Another tab changed the theme.
window.addEventListener('storage', event => {
  if (event.key === THEME_KEY) changeTheme();
});
document.addEventListener('DOMContentLoaded', buildThemeSwitch);
