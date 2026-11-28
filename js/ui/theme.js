// Theme button: auto (match phone) / light / dark. The choice is saved in vp_theme.

import { $ } from './dom.js';
import { store, KEYS } from '../store.js';

// The button shows the current choice (F11); Auto means the phone decides.
const THEMES = [['', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
// V7: the browser's address-bar colour. index.html has one <meta name="theme-color"> per scheme; a theme chosen with the button
// sets both to that theme's page colour, and Auto puts the originals back (tests/contrast.test.js checks these match styles.css).
export const PAGE_COLOURS = { light: '#fdfbf7', dark: '#0f1828' };

let theme = '';
let onChange = () => {};

/** Point the theme-color metas at the chosen theme ('' = each follows the phone's scheme again). */
export function setThemeColour(choice) {
  document.querySelectorAll('meta[name=theme-color]').forEach((meta) => {
    const scheme = /dark/.test(meta.media) ? 'dark' : 'light';
    meta.setAttribute('content', PAGE_COLOURS[choice || scheme]);
  });
}

function applyTheme() {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
  const label = THEMES.find((entry) => entry[0] == theme)[1];
  $('themeBtn').textContent = label;
  setThemeColour(theme);
  $('themeBtn').setAttribute('aria-label', `Theme: ${label}${theme ? '' : ' (matches your phone)'}. Tap to change`);
}

/** After a backup is restored (P5): read the saved theme again and show it. */
export function reloadTheme() {
  theme = store.get(KEYS.theme, '');
  applyTheme();
  onChange();
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
