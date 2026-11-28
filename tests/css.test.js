// V6 / V8: the stylesheet and the markup keep to the spacing scale, have no inline styles, and keep their fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('V6: margins, paddings and gaps use the --s1..--s6 scale (a few fixed hairline values are allowed)', () => {
  const ALLOWED_PX = new Set([0, 2, 3, 5, 11, 20, 40, 96]);   // hairlines, the cell's 5px, the inputs' 11px, the lists' 20px indent, page bottom 40px, practice dock clearance 96px
  const offenders = [];
  css.split('\n').forEach((line, i) => {
    if (!/^\s*(margin|padding|gap)[a-z-]*\s*:/.test(line)) return;
    for (const [, sign, px] of line.matchAll(/(?<![\w.])(-?)(\d+)px/g)) {
      if (sign === '-' || ALLOWED_PX.has(+px)) continue;   // negative nudges are fixed optical corrections
      offenders.push(`line ${i + 1}: ${line.trim()}`);
    }
  });
  assert.deepEqual(offenders, []);
  for (let n = 1; n <= 6; n++) assert.match(css, new RegExp(`--s${n}:\\s*\\d+px`));
});

test('V6: no inline style attributes in index.html', () => {
  assert.ok(!/\sstyle\s*=/.test(html));
});

test('V6: no inline style attributes in generated HTML in js/', () => {
  const files = readdirSync(new URL('../js/', import.meta.url), { recursive: true })
    .filter((name) => name.endsWith('.js'))
    .map((name) => [name, readFileSync(new URL(`../js/${name}`, import.meta.url), 'utf8')]);
  const bad = files.filter(([, source]) => /style="|style='|style=\\"/.test(source)).map(([name]) => name);
  assert.deepEqual(bad, []);
});

test('V8: every light-dark() colour is declared inside one @supports guard (plain light values come first in :root)', () => {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const guard = code.indexOf('@supports (color: light-dark(');
  assert.ok(guard >= 0);
  const blockEnd = guard + code.slice(guard).indexOf('\n}\n') + 3;   // the @supports block closes at the first top-level brace
  const inside = code.slice(guard, blockEnd);
  const outside = code.slice(0, guard) + code.slice(blockEnd);
  assert.ok(inside.includes('--bg: light-dark('));
  assert.ok(!outside.includes('light-dark('), 'no light-dark() outside the @supports block');
});

test('V7: the page asks for the full screen (viewport-fit) and names its icons', () => {
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  assert.match(html, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /<link rel="icon" href="favicon-32\.png" type="image\/png" sizes="32x32">/);
  const png = readFileSync(new URL('../favicon-32.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 32);
  assert.equal(png.readUInt32BE(20), 32);
});

test('V3 / V4: the heading of each screen can take focus, the photo input is not [hidden], every control in the markup has a label', () => {
  for (const id of ['libTitle', 'addTitle', 'pName', 'repTitle']) assert.match(html, new RegExp(`id="${id}" tabindex="-1"`));
  assert.ok(!/<input[^>]*id="photo"[^>]*\shidden/.test(html));
  assert.match(html, /<input id="photo" class="visually-hidden"/);
  for (const [, id] of html.matchAll(/<(?:input|textarea|select)[^>]*\sid="([^"]+)"/g)) {
    assert.ok(new RegExp(`for="${id}"`).test(html) || new RegExp(`id="${id}"[^>]*aria-label`).test(html), `#${id} needs a label`);
  }
});
