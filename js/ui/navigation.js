// Screen switching and the browser's Back button.
//
// The home screen has no history entry of its own; every other screen is an entry
// {s: id, d: depth} with hash #id, so Back always returns to the library.

import { state } from '../state.js';

let screen = 'lib';
let hooks = { stopSession() {}, stopPreview() {}, showLibrary() {} };

/** main.js passes in what leaving a screen has to clean up, which keeps this module free of imports from the screens. */
export function initNavigation(callbacks) {
  hooks = callbacks;
  addEventListener('popstate', onPopState);
  if (location.hash || history.state) history.replaceState(null, '', location.pathname + location.search);
  document.querySelectorAll('[data-go]').forEach((button) => (button.onclick = goHome));
}

function showScreen(id) {
  if (screen == 'add' && id != 'add') hooks.stopPreview();
  screen = id;
  document.querySelectorAll('section').forEach((section) => section.classList.toggle('on', section.id == id));
  window.scrollTo(0, 0);
}

const historyDepth = () => (history.state && history.state.d) || 0;

/** Open a screen on top of the library (or in place of another non-library screen). */
export function navTo(id) {
  const change = screen == 'lib' ? history.pushState : history.replaceState;
  change.call(history, { s: id, d: 1 }, '', '#' + id);
  showScreen(id);
}

/** Back to the library: stops any session, clears the "practice all" queue. */
export function goHome() {
  hooks.stopSession();
  state.queue = [];
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
    state.queue = [];
    showScreen('lib');
    hooks.showLibrary();
  } else {
    // Forward into a screen that no longer has its state: land on the library instead.
    state.queue = [];
    history.replaceState(null, '', location.pathname + location.search);
    showScreen('lib');
    hooks.showLibrary();
  }
}
