// V1 / V8: WCAG contrast of every text / fill pair the app uses, computed from styles.css itself.
// The colours are read from the custom properties (both halves of each light-dark()), so changing a colour in the CSS
// re-runs this check; nothing here is a copy of a colour. Normal text needs 4.5:1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGE_COLOURS } from '../js/ui/theme.js';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const HEX = '#[0-9a-fA-F]{6}';
const pairs = {};   // name -> {light, dark}
for (const [, name, light, dark] of css.matchAll(new RegExp(`--([\\w-]+):\\s*light-dark\\((${HEX}),\\s*(${HEX})\\)`, 'g'))) pairs[name] = { light, dark };
// Plain declarations (the fallbacks in the first :root block, and colours that do not change with the theme).
const plain = {};
for (const [, name, value] of css.matchAll(new RegExp(`--([\\w-]+):\\s*(${HEX});`, 'g'))) plain[name] = value;

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const channel = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => { const [r, g, b] = toRgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** color-mix(in srgb, a p%, b) */
const mix = (a, b, p) => '#' + toRgb(a).map((v, i) => Math.round(v * p + toRgb(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('');

const colour = (name, theme) => (pairs[name] ? pairs[name][theme] : plain[name]);

test('the colours are found in the CSS (both halves of each light-dark())', () => {
  for (const name of ['bg', 'ink', 'panel', 'line', 'muted', 'pri', 'pri-ink', 'on', 'on-text', 'near', 'far', 'cell-ink', 'glow']) {
    assert.ok(pairs[name], `--${name} should be a light-dark() pair`);
  }
  assert.ok(plain.sun);
});

test('V8: the plain fallback for each light-dark() colour is its light half', () => {
  for (const [name, { light }] of Object.entries(pairs)) {
    assert.equal(plain[name], light, `--${name}: fallback ${plain[name]} should equal the light value ${light}`);
  }
});

// These backgrounds are mixed in the CSS; keep the test honest about the recipe.
test('the mixed backgrounds in the CSS are the ones measured here', () => {
  assert.ok(css.includes('color-mix(in srgb,var(--pri) 7%,var(--panel))'), '.warn background changed: update the pair list below');
  assert.ok(css.includes('color-mix(in srgb,var(--sun) 10%,var(--panel))'), '.onboard background changed: update the pair list below');
});

const PAIRS = (theme) => {
  const c = (name) => colour(name, theme);
  const warn = mix(c('pri'), c('panel'), 0.07);
  const onboard = mix(c('sun'), c('panel'), 0.1);
  return [
    // [label, text, fill]
    ['note cell text on landed (green)', c('cell-ink'), c('on')],
    ['note cell text on close (gold)', c('cell-ink'), c('near')],
    ['note cell text on finding-it (lavender)', c('cell-ink'), c('far')],
    ['note cell text on a missed note', c('ink'), c('line')],
    ['primary button text on its fill', c('pri-ink'), c('pri')],
    ['body text on the page', c('ink'), c('bg')],
    ['body text on a card', c('ink'), c('panel')],
    ['muted text on the page', c('muted'), c('bg')],
    ['muted text on a card', c('muted'), c('panel')],
    ['muted text under the morning glow', c('muted'), c('glow')],
    ['muted text on a tinted (warn) card', c('muted'), warn],
    ['status words (cheer, ticks) on a card', c('on-text'), c('panel')],
    ['status words on the page', c('on-text'), c('bg')],
    ['blue text (back, numbers, links) on a card', c('pri'), c('panel')],
    ['blue text on the page', c('pri'), c('bg')],
    ['blue text under the morning glow', c('pri'), c('glow')],
    ['blue text on a tinted card', c('pri'), warn],
    ['blue text on the first-launch card', c('pri'), onboard],
    ['body text on the first-launch card', c('ink'), onboard],
    ['toast text on the toast', c('bg'), c('ink')],
  ];
};

for (const theme of ['light', 'dark']) {
  test(`V1: every text / fill pair is at least 4.5:1 (${theme})`, () => {
    for (const [label, text, fill] of PAIRS(theme)) {
      const ratio = contrast(text, fill);
      assert.ok(ratio >= 4.5, `${theme}: ${label} is ${ratio.toFixed(2)}:1 (${text} on ${fill}), needs 4.5`);
    }
  });
}

test('V1: the old white-on-status-colour pairs really were below 4.5 (so the test can fail)', () => {
  assert.ok(contrast('#ffffff', colour('on', 'light')) < 4.5);
  assert.ok(contrast('#ffffff', colour('near', 'light')) < 3);
});

test('V7: the theme-color metas match the page colour in each theme', () => {
  assert.equal(PAGE_COLOURS.light.toLowerCase(), pairs.bg.light);
  assert.equal(PAGE_COLOURS.dark.toLowerCase(), pairs.bg.dark);
  const metas = [...html.matchAll(/<meta name="theme-color" content="(#[0-9a-f]{6})" media="\(prefers-color-scheme: (light|dark)\)">/g)];
  assert.deepEqual(metas.map(([, content, scheme]) => [scheme, content]), [['light', pairs.bg.light], ['dark', pairs.bg.dark]]);
});
