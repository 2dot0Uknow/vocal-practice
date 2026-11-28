// Screen switching and the browser's Back button.
//
// The home screen has no history entry of its own; every other screen is an entry
// {s: id, d: depth} with hash #id, so Back always returns to the library.

import { endSet } from '../state.js';

let screen = 'lib';

// V4: each screen's heading takes focus when the screen opens, and the tab title follows.
const HEADINGS = { lib: 'libTitle', add: 'addTitle', prac: 'pName', rep: 'repTitle' };
const APP_TITLE = 'Vocal Practice';
const SCREEN_TITLES = { lib: APP_TITLE, add: `Add exercises · ${APP_TITLE}`, rep: `Report · ${APP_TITLE}` };

/** The tab title for a screen; the practice screen is named after its exercise. */
export const pageTitle = (id, exerciseName = '') => (id == 'prac' && exerciseName ? `${exerciseName} · ${APP_TITLE}` : SCREEN_TITLES[id] || APP_TITLE);

let hooks = { stopSession() {}, stopPreview() {}, showLibrary() {}, leaveLibrary() {} };

/** main.js passes in what leaving a screen has to clean up, which keeps this module free of imports from the screens. */
export function initNavigation(callbacks) {
  hooks = { ...hooks, ...callbacks };
  addEventListener('popstate', onPopState);
  if (location.hash || history.state) history.replaceState(null, '', location.pathname + location.search);
  document.querySelectorAll('[data-go]').forEach((button) => (button.onclick = goHome));
}

/** The id of the screen being shown ('lib', 'add', 'prac' or 'rep'). */
export const currentScreen = () => screen;

function showScreen(id, title = pageTitle(id)) {
  if (screen == 'add' && id != 'add') hooks.stopPreview();
  screen = id;
  document.body.dataset.screen = id;   // F4: the practice screen hides the app header and pins its buttons
  if (id != 'lib') hooks.leaveLibrary();
  document.querySelectorAll('section').forEach((section) => section.classList.toggle('on', section.id == id));
  window.scrollTo(0, 0);
  document.title = title;
  // The heading is focused (not scrolled to): after a tap no ring shows (:focus-visible), but a screen reader starts reading there.
  document.getElementById(HEADINGS[id])?.focus({ preventScroll: true });
}

const historyDepth = () => (history.state && history.state.d) || 0;

/** Open a screen on top of the library (or in place of another non-library screen). `title` is the tab title (default: the screen's own). */
export function navTo(id, title) {
  const change = screen == 'lib' ? history.pushState : history.replaceState;
  change.call(history, { s: id, d: 1 }, '', '#' + id);
  showScreen(id, title);
}

/** Redraw the library (after a change made while it is on screen). */
export const refreshLibrary = () => hooks.showLibrary();

/** Back to the library: stops any session, clears the "practice all" queue. */
export function goHome() {
  hooks.stopSession();
  endSet();
  const depth = historyDepth();
  if (depth > 0) {
    history.go(-depth);
  } else {
    showScreen('lib');
    hooks.showLibrary();
  }
}

function onPopState() {
  const entry = history.state;
  const id = (entry && entry.s) || 'lib';
  hooks.stopSession();
  hooks.stopPreview();
  if (id == 'lib') {
    endSet();
    showScreen('lib');
    hooks.showLibrary();
  } else {
    // Forward into a screen that no longer has its state: land on the library instead.
    endSet();
    history.replaceState(null, '', location.pathname + location.search);
    showScreen('lib');
    hooks.showLibrary();
  }
}
