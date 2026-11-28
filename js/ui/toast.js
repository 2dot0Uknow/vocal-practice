// A small message at the bottom of the screen, optionally with an Undo button (F6). One toast at a time.

import { $ } from './dom.js';

let timer = null;

export const TOAST_MS = 6000;

export function hideToast() {
  clearTimeout(timer);
  timer = null;
  $('toast').hidden = true;
  $('toastUndo').onclick = null;
}

/** Show `message` for `ms`. With `onUndo` an Undo button appears; tapping it runs onUndo and closes the toast. */
export function showToast(message, { onUndo = null, ms = TOAST_MS } = {}) {
  hideToast();
  $('toastMsg').textContent = message;
  $('toastUndo').hidden = !onUndo;
  if (onUndo) {
    $('toastUndo').onclick = () => {
      hideToast();
      onUndo();
    };
  }
  $('toast').hidden = false;
  timer = setTimeout(hideToast, ms);
}
