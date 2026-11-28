// P1 / P3: the web app manifest, its icons, the self-hosted fonts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { PAGE_COLOURS } from '../js/ui/theme.js';

const url = (path) => new URL(`../${path}`, import.meta.url);
const manifest = JSON.parse(readFileSync(url('manifest.webmanifest'), 'utf8'));
const html = readFileSync(url('index.html'), 'utf8');
const css = readFileSync(url('styles.css'), 'utf8');

/** Width and height from a PNG's header (the IHDR chunk starts at byte 16). */
function pngSize(path) {
  const bytes = readFileSync(url(path));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('P1: the manifest has the fields Chrome needs to offer installing', () => {
  assert.equal(manifest.name, 'Vocal Practice');
  assert.equal(manifest.short_name, 'Vocal');
  assert.ok(manifest.description.length > 10);
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.short_name.length <= 12, 'short enough to sit under a home-screen icon');
});

test('P1: start_url and scope are relative, so the app works under /vocal-practice/ and on localhost alike', () => {
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  // The browser resolves them against the manifest's own address, which sits next to index.html:
  for (const base of ['https://2dot0uknow.github.io/vocal-practice/manifest.webmanifest', 'http://localhost:8000/manifest.webmanifest']) {
    assert.equal(new URL(manifest.start_url, base).href, new URL('./', base).href);
    assert.equal(new URL(manifest.scope, base).href, new URL('./', base).href);
  }
  assert.equal(new URL(manifest.start_url, 'https://2dot0uknow.github.io/vocal-practice/manifest.webmanifest').pathname, '/vocal-practice/');
});

test('P1: colours match the light page colour (and the light theme-color meta)', () => {
  assert.equal(manifest.background_color.toLowerCase(), PAGE_COLOURS.light);
  assert.equal(manifest.theme_color.toLowerCase(), PAGE_COLOURS.light);
  assert.match(css, new RegExp(`--bg:\\s*${PAGE_COLOURS.light}`));
});

test('P1: icons exist and are really the size they claim; there is a 192, a 512 and a maskable 512', () => {
  assert.ok(manifest.icons.length >= 3);
  for (const icon of manifest.icons) {
    assert.ok(existsSync(url(icon.src)), `${icon.src} exists`);
    assert.equal(icon.type, 'image/png');
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(icon.src), { width, height }, `${icon.src} is ${icon.sizes}`);
  }
  const has = (size, purpose) => manifest.icons.some((icon) => icon.sizes === size && icon.purpose === purpose);
  assert.ok(has('192x192', 'any'));
  assert.ok(has('512x512', 'any'));
  assert.ok(has('512x512', 'maskable'));
});

test('P1: the page links the manifest, with a relative path', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
});

test('P3: the fonts are served from this site: files exist, @font-face points at them, no Google Fonts', () => {
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html + css));
  const sources = [...css.matchAll(/src:\s*url\("([^"]+)"\)\s*format\("woff2"\)/g)].map((match) => match[1]);
  assert.deepEqual(sources.sort(), ['fonts/inter.woff2', 'fonts/nunito.woff2']);
  let total = 0;
  for (const source of sources) {
    assert.ok(existsSync(url(source)), `${source} exists`);
    assert.equal(readFileSync(url(source)).subarray(0, 4).toString('latin1'), 'wOF2', `${source} is WOFF2`);
    total += statSync(url(source)).size;
  }
  assert.ok(total < 250 * 1024, `fonts total ${total} bytes, under 250 KB`);
  assert.match(css, /font-family: Nunito;[\s\S]*?font-weight: 700 800;[\s\S]*?font-display: swap/);
  assert.match(css, /font-family: Inter;[\s\S]*?font-weight: 400 600;[\s\S]*?font-display: swap/);
});

test('P3: the fonts come with their licences', () => {
  for (const name of ['Inter', 'Nunito']) {
    const licence = readFileSync(url(`fonts/OFL-${name}.txt`), 'utf8');
    assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/i);
    assert.match(readFileSync(url('README.md'), 'utf8'), new RegExp(`fonts/OFL-${name}\\.txt`));
  }
});

test('P4: Tesseract is pinned to an exact version and loaded with crossorigin', () => {
  const photo = readFileSync(url('js/ui/photo.js'), 'utf8');
  assert.match(photo, /cdn\.jsdelivr\.net\/npm\/tesseract\.js@\d+\.\d+\.\d+\/dist\/tesseract\.min\.js/);
  assert.match(photo, /script\.crossOrigin = 'anonymous'/);
});
