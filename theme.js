// Light, dark or system theme for every page. Load it in <head>, before the body, so the page never flashes the wrong theme.
const THEME_KEY = 'grindgrid.theme';
const THEME_MODES = [
  { mode: 'light', label: 'Light theme', icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>' },
  { mode: 'dark', label: 'Dark theme', icon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>' },
  { mode: 'system', label: 'Match system theme', icon: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>' }
];
const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// How long a theme change fades, and how long the switch's highlight takes to slide; theme.css uses the same .4s and .25s.
const THEME_FADE_MS = 400;
const SWITCH_SLIDE_MS = 250;
const themeListeners = [];
let themeFadeTimer = null;
let pendingThemeChange = null;
let themeTransition = null;

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
  if (root.dataset.theme === currentTheme() || reducedMotion.matches || document.visibilityState !== 'visible') {
    applyTheme();
  } else if (document.startViewTransition) {
    const transition = themeTransition = document.startViewTransition(applyTheme);
    transition.finished.finally(() => {
      if (themeTransition !== transition) return;
      themeTransition = null;
      document.dispatchEvent(new Event('themefadeend'));
    });
  } else {
    root.classList.add('theme-fading');
    applyTheme();
    clearTimeout(themeFadeTimer);
    themeFadeTimer = setTimeout(() => root.classList.remove('theme-fading'), THEME_FADE_MS);
  }
}

// The switch answers at once: its highlight slides to the new choice. The page fades after the slide, so the chart
// redraws behind the fade can't make the slide stutter. Quick repeated clicks only fade the page once, to the last choice.
function setThemeMode(mode) {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch (e) {}
  updateThemeSwitch();
  clearTimeout(pendingThemeChange);
  pendingThemeChange = setTimeout(changeTheme, reducedMotion.matches ? 0 : SWITCH_SLIDE_MS);
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

// The browser forgets the hover while the page fades, which would fold the switch shut under a still pointer.
// .open keeps it open until the pointer really moves off it, or focus leaves it. During the fade every pointer
// event lands on the page root, so the switch remembers where the pointer went and checks once the fade is over.
function keepSwitchOpen(group) {
  if (group.classList.contains('open')) return;
  group.classList.add('open');
  let lastPoint = null;
  const close = () => {
    group.classList.remove('open');
    document.removeEventListener('pointermove', onPointer);
    document.removeEventListener('pointerdown', onPointer);
    document.removeEventListener('themefadeend', onFadeEnd);
    group.removeEventListener('focusout', onFocusOut);
    settleThemeSwitch(group);
  };
  const onPointer = event => {
    lastPoint = [event.clientX, event.clientY];
    if (!themeTransition && !group.contains(event.target)) close();
  };
  const onFadeEnd = () => {
    if (!lastPoint) return;
    const r = group.getBoundingClientRect();
    const [x, y] = lastPoint;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) close();
  };
  const onFocusOut = event => {
    if (!group.contains(event.relatedTarget)) close();
  };
  document.addEventListener('pointermove', onPointer);
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('themefadeend', onFadeEnd);
  group.addEventListener('focusout', onFocusOut);
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
    button.addEventListener('click', () => {
      keepSwitchOpen(group);
      setThemeMode(mode);
    });
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
