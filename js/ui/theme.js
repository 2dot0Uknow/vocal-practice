// Theme button: auto (match phone) / light / dark. The choice is saved in vp_theme.

import { $ } from './dom.js';
import { store, KEYS } from '../store.js';

// The button shows the current choice (F11); Auto means the phone decides.
const THEMES = [['', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
let theme = '';
let onChange = () => {};

function applyTheme() {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
  const label = THEMES.find((entry) => entry[0] == theme)[1];
  $('themeBtn').textContent = label;
  $('themeBtn').setAttribute('aria-label', `Theme: ${label}${theme ? '' : ' (matches your phone)'}. Tap to change`);
}

/** `changed` runs after the theme is switched by the button (the pitch roll re-reads its colours). */
export function initTheme(changed) {
  onChange = changed;
  theme = store.get(KEYS.theme, '');
  $('themeBtn').onclick = () => {
    theme = THEMES[(THEMES.findIndex((entry) => entry[0] == theme) + 1) % 3][0];
    store.set(KEYS.theme, theme);
    applyTheme();
    onChange();
  };
  applyTheme();
}
