// P2: the service worker's file list matches the files on disk, the version is one string used everywhere,
// and the worker's own logic (install, activate, fetch, update) behaves, run here against stand-ins for the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { PRECACHE } from '../js/precache.js';
import { APP_VERSION } from '../js/version.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const filesIn = (folder, test) => readdirSync(new URL(folder, root), { recursive: true }).map((name) => `${folder}${name}`.replaceAll('\\', '/')).filter(test);

test('P2: PRECACHE lists exactly the app files on disk (a file added later cannot be forgotten)', () => {
  const onDisk = [
    'index.html', 'styles.css', 'manifest.webmanifest', 'favicon.svg', 'favicon-32.png',
    ...filesIn('js/', (name) => name.endsWith('.js')),
    ...filesIn('audio/piano/', (name) => name.endsWith('.mp3')),
    ...filesIn('icons/', (name) => name.endsWith('.png')),
    ...filesIn('fonts/', (name) => name.endsWith('.woff2')),
  ];
  assert.deepEqual([...PRECACHE].sort(), onDisk.sort());
  assert.equal(new Set(PRECACHE).size, PRECACHE.length, 'no duplicates');
  PRECACHE.forEach((path) => assert.ok(existsSync(new URL(path, root)), `${path} exists`));
  assert.ok(!PRECACHE.includes('sw.js'), 'the browser keeps sw.js itself up to date');
});

test('P2: everything the page, the manifest and the stylesheet load is in the list', () => {
  const html = read('index.html');
  const wanted = [
    ...[...html.matchAll(/(?:href|src)="([^":#]+)"/g)].map((match) => match[1]),
    ...JSON.parse(read('manifest.webmanifest')).icons.map((icon) => icon.src),
    ...[...read('styles.css').matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]),
  ];
  assert.ok(wanted.includes('js/main.js') && wanted.includes('styles.css'));
  wanted.forEach((path) => assert.ok(PRECACHE.includes(path), `${path} is precached`));
});

test('P2: every module the app imports is in the list (static imports followed from js/main.js)', () => {
  const seen = new Set();
  const visit = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const [, spec] of read(path).matchAll(/from '(\.[^']+)'/g)) visit(new URL(spec, new URL(path, 'http://x/')).pathname.slice(1));
  };
  visit('js/main.js');
  visit('js/precache.js');
  [...seen].forEach((path) => assert.ok(PRECACHE.includes(path), `${path} is precached`));
});

test('version: one constant, in a date style, used by the worker and shown by the library', () => {
  assert.match(APP_VERSION, /^\d{4}\.\d{2}\.\d{2}[a-z]?$/);
  assert.match(read('sw.js'), /import \{ APP_VERSION \} from '\.\/js\/version\.js'/);
  assert.match(read('sw.js'), /CACHE_PREFIX \+ APP_VERSION/);
  assert.match(read('js/ui/library.js'), /APP_VERSION/);
  assert.ok(!/\d{4}\.\d{2}\.\d{2}/.test(read('sw.js')), 'no second copy of the version in sw.js');
  assert.match(read('README.md'), /js\/version\.js/);
});

// ---- the worker itself, against stand-ins ----

function fakeCaches(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, files]) => [name, new Map(Object.entries(files))]));
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const files = stores.get(name);
    return {
      addAll: async (requests) => requests.forEach((request) => files.set(request.url, `body of ${request.url}`)),
      match: async (request, options = {}) => {
        const wanted = typeof request === 'string' ? request : request.url;
        const strip = (address) => (options.ignoreSearch ? address.split('?')[0] : address);
        for (const [address, body] of files) if (strip(address) === strip(wanted)) return body;
        return undefined;
      },
    };
  };
  return { stores, open, keys: async () => [...stores.keys()], delete: async (name) => stores.delete(name) };
}

async function loadWorker(caches) {
  const listeners = {};
  const calls = { claimed: 0, skipped: 0, fetched: [] };
  globalThis.self = {
    registration: { scope: 'https://example.com/vocal-practice/' },
    location: { origin: 'https://example.com' },
    addEventListener: (type, handler) => (listeners[type] = handler),
    clients: { claim: async () => calls.claimed++ },
    skipWaiting: () => calls.skipped++,
  };
  globalThis.caches = caches;
  globalThis.fetch = async (request) => {
    calls.fetched.push(request.url);
    return `network ${request.url}`;
  };
  await import(`../sw.js?${Math.random()}`);
  const wait = async (handler, event) => {
    let pending;
    handler({ ...event, waitUntil: (promise) => (pending = promise) });
    await pending;
  };
  const fetchEvent = async (request) => {
    let answer;
    listeners.fetch({ request, respondWith: (promise) => (answer = promise) });
    return answer === undefined ? 'not handled (network)' : answer;
  };
  return { listeners, calls, wait, fetchEvent };
}
const cacheName = `vocal-practice-${APP_VERSION}`;

test('P2 worker: install stores every file of the list under the versioned cache name, bypassing the HTTP cache', async () => {
  const caches = fakeCaches({ [cacheName]: { stale: 'half-done earlier attempt' } });
  const worker = await loadWorker(caches);
  const requests = [];
  const original = caches.open;
  caches.open = async (name) => {
    const cache = await original(name);
    return { ...cache, addAll: async (list) => { requests.push(...list); return cache.addAll(list); } };
  };
  await worker.wait(worker.listeners.install, {});
  assert.deepEqual(requests.map((request) => request.url), PRECACHE.map((path) => `https://example.com/vocal-practice/${path}`));
  assert.ok(requests.every((request) => request.cache === 'reload'));
  assert.equal(caches.stores.get(cacheName).size, PRECACHE.length, 'the stale leftover is gone');
  assert.equal(worker.calls.skipped, 0, 'install never skips waiting by itself');
});

test('P2 worker: activate deletes older versions\' caches (and only this app\'s), then takes control', async () => {
  const caches = fakeCaches({ 'vocal-practice-2020.01.01': {}, [cacheName]: {}, 'someone-elses-cache': {} });
  const worker = await loadWorker(caches);
  await worker.wait(worker.listeners.activate, {});
  assert.deepEqual([...caches.stores.keys()].sort(), [cacheName, 'someone-elses-cache'].sort());
  assert.equal(worker.calls.claimed, 1);
});

test('P2 worker: SKIP_WAITING is the only thing that makes it take over', async () => {
  const worker = await loadWorker(fakeCaches());
  worker.listeners.message({ data: { type: 'hello' } });
  assert.equal(worker.calls.skipped, 0);
  worker.listeners.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(worker.calls.skipped, 1);
});

test('P2 worker: app files come from the cache, the page opens from the stored index, everything else goes to the network', async () => {
  const base = 'https://example.com/vocal-practice/';
  const worker = await loadWorker(fakeCaches({ [cacheName]: { [`${base}index.html`]: 'stored page', [`${base}styles.css`]: 'stored css' } }));
  const get = (address, mode = 'cors') => worker.fetchEvent({ method: 'GET', url: address, mode });
  assert.equal(await get(`${base}styles.css`), 'stored css');
  assert.equal(await get(`${base}styles.css?v=2`), 'stored css', 'a query string does not matter');
  assert.equal(await get(`${base}?debug=1`, 'navigate'), 'stored page');
  assert.equal(await get(base, 'navigate'), 'stored page');
  assert.equal(await get(`${base}not-precached.json`), `network ${base}not-precached.json`);
  assert.equal(await get('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'), 'not handled (network)');
  assert.equal(await worker.fetchEvent({ method: 'POST', url: `${base}styles.css`, mode: 'cors' }), 'not handled (network)');
});
