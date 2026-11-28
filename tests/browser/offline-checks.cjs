// Browser checks for PR 9 (P1-P6): the service worker, offline use, updates, installability, export / import, failed saves.
// Everything that needs the service worker runs on a temporary copy of the site served from its own folder, so the
// server can be stopped (real offline) and the version can be bumped (a real update). The other checks block the worker.
//   node tests/browser/offline-checks.cjs [--shots dir]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openApp, sleep, CHROME_ARGS } = require('./scenario.cjs');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { serve } = require('./serve.cjs');

const REPO = path.resolve(__dirname, '../..');
const SITE_ITEMS = ['index.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'favicon.svg', 'favicon-32.png', 'icons', 'fonts', 'js', 'audio'];

/** Copy the app (not tests, tools or git) into `folder`; `version` rewrites js/version.js in the copy. */
function copySite(folder, version = null) {
  fs.mkdirSync(folder, { recursive: true });
  SITE_ITEMS.forEach((item) => fs.cpSync(path.join(REPO, item), path.join(folder, item), { recursive: true }));
  if (version) setVersion(folder, version);
}
function setVersion(folder, version) {
  fs.writeFileSync(path.join(folder, 'js/version.js'), `export const APP_VERSION = '${version}';\n`);
}

// A quick one-round exercise (about 3 s) and some history, for sessions and for export / import.
const QUICK = { id: 'xq', name: 'Quick round', pat: '1-3-5', vows: ['ah'], rootVow: '', start: 48, end: 48, top: false, both: false, step: 1, bpm: 200, hold: 2 };
const SLOW = { id: 'xs', name: 'Long one', pat: '1-2-3-4-5-4-3-2-1~', vows: ['ah'], rootVow: '', start: 48, end: 60, top: false, both: false, step: 1, bpm: 60, hold: 2 };
const HISTORY = [
  { name: 'Quick round', exId: 'xq', pct: 80, ts: 1764000000000, date: 'Nov 24' },
  { name: 'Long one', exId: 'xs', pct: 60, ts: 1763000000000, date: 'Nov 13' },
];
const seedScript = (values) => `(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); const v = ${JSON.stringify(values)}; Object.keys(v).forEach((k) => localStorage.setItem(k, JSON.stringify(v[k]))); } })();`;

const COUNT_SOURCES = `(() => { window.__sources = 0; const real = BaseAudioContext.prototype.createBufferSource; BaseAudioContext.prototype.createBufferSource = function (...a) { window.__sources++; return real.apply(this, a); }; })();`;

async function runOfflineChecks(baseUrl, { shotsDir = null } = {}) {
  const errors = [];
  const expect = (condition, message) => { if (!condition) errors.push(message); };
  const shot = async (page, name) => { if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, name + '.png') }); } };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-offline-'));
  const servers = [];
  const run = async (name, fn) => {
    try { await fn(); } catch (error) { errors.push(`${name} failed: ${error.stack || error}`); }
  };
  const readSw = (page) => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return { scope: registration?.scope, active: registration?.active?.state, controlled: !!navigator.serviceWorker.controller, caches: (await caches.keys()).sort() };
  });
  const libraryVersion = (page) => page.evaluate(() => document.getElementById('appVersion').textContent);
  const version = fs.readFileSync(path.join(REPO, 'js/version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];

  // ---- fonts, manifest as the browser sees it, no network to Google ----
  await run('fonts and manifest', async () => {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl);
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.reload();
    await page.waitForSelector('#list');
    await page.evaluate(() => document.fonts.ready);
    const faces = await page.evaluate(() => [...document.fonts].map((face) => [face.family, face.status]));
    expect(faces.length === 2 && faces.every(([, status]) => status === 'loaded'), `both self-hosted fonts load: ${JSON.stringify(faces)}`);
    expect(!requests.some((url) => /fonts\.g/.test(url)), 'no request to Google Fonts');
    expect(requests.filter((url) => /\.woff2$/.test(url)).length === 2, 'two font files fetched from this site');
    const used = await page.evaluate(() => ({ h1: getComputedStyle(document.querySelector('h1')).fontFamily, body: getComputedStyle(document.body).fontFamily, ok: document.fonts.check('800 30px Nunito') && document.fonts.check('600 16px Inter') }));
    expect(used.ok, 'Nunito 800 and Inter 600 are available');
    const link = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.href);
    expect(link === baseUrl + 'manifest.webmanifest', `manifest linked: ${link}`);
    errors.push(...pageErrors);
    await browser.close();
  });

  // ---- service worker, offline, installability (site at the server root) ----
  const rootSite = path.join(work, 'root');
  copySite(rootSite);
  const rootServer = await serve(rootSite);
  servers.push(rootServer);
  await run('service worker, offline session', async () => {
    const { browser, context, page, errors: pageErrors } = await openApp(rootServer.url, { serviceWorker: true, samples: true, steadyTone: true, initScript: seedScript({ vp_ex: [QUICK], vp_hist: HISTORY, vp_onboarded: 1 }) + COUNT_SOURCES });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });   // the first install takes control (clients.claim)
    let state = await readSw(page);
    expect(state.scope === rootServer.url, `scope is the site folder: ${state.scope}`);
    expect(state.active === 'activated', `worker activated: ${state.active}`);
    expect(JSON.stringify(state.caches) === JSON.stringify([`vocal-practice-${version}`]), `one versioned cache: ${state.caches}`);
    const cached = await page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).map((request) => new URL(request.url).pathname));
    const { PRECACHE } = await import(path.join(REPO, 'js/precache.js'));
    expect(cached.length === PRECACHE.length, `every listed file is cached: ${cached.length} of ${PRECACHE.length}`);
    expect(!cached.some((p) => p.endsWith('sw.js')), 'sw.js itself is not in the cache');

    // After a reload the page is controlled and the page itself came from the worker.
    const mainResponse = await page.reload();
    await page.waitForSelector('#list');
    expect(mainResponse.fromServiceWorker(), 'after reload the page is served by the service worker');
    expect((await readSw(page)).controlled, 'the worker controls the page after reload');
    expect((await libraryVersion(page)) === `v${version}`, `library shows the version: ${await libraryVersion(page)}`);

    // Real offline: stop the server.
    rootServer.stop();
    await sleep(300);
    const networkDown = await page.evaluate(() => fetch('not-in-the-cache.txt?' + Date.now()).then(() => false, () => true));
    expect(networkDown, 'the server is really gone (an uncached file cannot be fetched)');
    const piano = [];
    page.on('response', (response) => { if (/\/audio\/piano\//.test(response.url())) piano.push(response); });
    await page.reload();
    await page.waitForSelector('#list');
    expect((await page.evaluate(() => document.querySelector('#list .ex b')?.textContent)) === 'Quick round', 'offline: the app opens with the library');
    await shot(page, 'offline-library');
    await page.click('#list button[data-a=p][data-i="0"]');
    await page.click('#goBtn');
    await page.waitForSelector('section#rep.on', { timeout: 30000 });
    const reportTitle = await page.evaluate(() => document.getElementById('repTitle').textContent);
    expect(/Quick round/.test(reportTitle) && !/Stopped/.test(reportTitle), `offline: a full session reaches the report: ${reportTitle}`);
    await sleep(200);
    const sources = await page.evaluate(() => window.__sources);
    expect(piano.length === 17 && piano.every((response) => response.ok() && response.fromServiceWorker()), `offline: all 17 piano samples came from the worker (${piano.length})`);
    expect(sources > 5, `offline: the piano played from samples (${sources} buffer sources)`);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vp_hist')).length);
    expect(saved === HISTORY.length + 1, `offline: the run was saved (${saved} entries)`);
    errors.push(...pageErrors.filter((message) => !/net::ERR_(CONNECTION_REFUSED|FAILED)/.test(message)));
    await browser.close();
  });
  rootServer.stop();

  // ---- installability, and the manifest resolved under /vocal-practice/ like GitHub Pages ----
  const underSite = path.join(work, 'under', 'vocal-practice');
  copySite(underSite);
  const underServer = await serve(path.join(work, 'under'));
  servers.push(underServer);
  const rootServer2 = await serve(rootSite);
  servers.push(rootServer2);
  for (const [label, url, expectedPath] of [['localhost root', rootServer2.url, '/'], ['under /vocal-practice/', underServer.url + 'vocal-practice/', '/vocal-practice/']]) {
    await run(`installability (${label})`, async () => {
      // A persistent profile: Chrome reports "in-incognito" (not installable) for the throwaway contexts the other checks use.
      const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work, 'profile-')), { executablePath: '/usr/bin/google-chrome', args: CHROME_ARGS, viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('console', (message) => message.type() === 'error' && pageErrors.push(`console.error: ${message.text()}`));
      page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => navigator.serviceWorker.ready);
      const cdp = await context.newCDPSession(page);
      const manifest = await cdp.send('Page.getAppManifest');
      expect(!(manifest.errors || []).length, `${label}: manifest has no errors: ${JSON.stringify(manifest.errors)}`);
      const parsed = JSON.parse(manifest.data);
      expect(parsed.start_url === './' && parsed.scope === './', `${label}: relative start_url and scope in the file`);
      const resolvedStart = new URL(parsed.start_url, manifest.url).pathname;
      const resolvedScope = new URL(parsed.scope, manifest.url).pathname;
      expect(resolvedStart === expectedPath && resolvedScope === expectedPath, `${label}: start_url ${resolvedStart} and scope ${resolvedScope} resolve to ${expectedPath}`);
      const swScope = new URL((await readSw(page)).scope).pathname;
      expect(swScope === expectedPath, `${label}: service worker scope ${swScope}`);
      for (const icon of parsed.icons) {
        const status = await page.evaluate((src) => fetch(src).then((response) => response.status), new URL(icon.src, manifest.url).href);
        expect(status === 200, `${label}: ${icon.src} loads`);
      }
      await sleep(500);
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      expect(installabilityErrors.length === 0, `${label}: installable, errors: ${JSON.stringify(installabilityErrors)}`);
      errors.push(...pageErrors);
      await context.close();
    });
  }

  // ---- ?nosw=1 ----
  await run('nosw', async () => {
    const { browser, page, errors: pageErrors } = await openApp(rootServer2.url + '?nosw=1', { serviceWorker: true });
    await sleep(500);
    const count = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    expect(count === 0, `?nosw=1 registers nothing (${count})`);
    errors.push(...pageErrors);
    await browser.close();
  });

  // ---- updates: bump the version in a copy, toast, tap, new version; deferred during a session ----
  for (const duringSession of [false, true]) {
    await run(`update toast (${duringSession ? 'during a session' : 'idle'})`, async () => {
      const site = path.join(work, duringSession ? 'upd-session' : 'upd-idle');
      copySite(site, '2026.01.01');
      const server = await serve(site);
      servers.push(server);
      const { browser, page, errors: pageErrors } = await openApp(server.url, { serviceWorker: true, steadyTone: true, initScript: seedScript({ vp_ex: [duringSession ? SLOW : QUICK], vp_onboarded: 1 }) });
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page.evaluate(() => { window.__marker = 'same page'; });
      expect((await libraryVersion(page)) === 'v2026.01.01', 'starts on the old version');
      expect(await page.evaluate(() => document.getElementById('updateToast').hidden), 'no toast on a fresh install');
      if (duringSession) {
        await page.click('#list button[data-a=p][data-i="0"]');
        await page.click('#goBtn');
        await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
      }
      setVersion(site, '2026.01.02');
      await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
      await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting, null, { timeout: 15000 });
      const toastHidden = () => page.evaluate(() => document.getElementById('updateToast').hidden);
      if (duringSession) {
        await sleep(2300);
        expect(await toastHidden(), 'the toast waits while a session is running');
        expect(await page.evaluate(() => window.__marker === 'same page'), 'the page was not reloaded during the session');
        await page.click('#goBtn');   // Stop: ends the session
        await page.waitForFunction(() => document.querySelector('section#rep.on') || document.querySelector('section#prac.on'));
        if (await page.evaluate(() => document.querySelector('section#prac.on'))) await page.click('#backBtn');   // under one round: back to the library
        else await page.click('section#rep [data-go=lib]');
        await page.waitForFunction(() => !document.getElementById('updateToast').hidden, null, { timeout: 8000 });
      } else {
        await page.waitForFunction(() => !document.getElementById('updateToast').hidden, null, { timeout: 8000 });
        // The new version is waiting, not running: the page still says the old one.
        expect((await libraryVersion(page)) === 'v2026.01.01', 'the old version keeps running until the tap');
        expect(await page.evaluate(() => window.__marker === 'same page'), 'no automatic reload');
      }
      expect((await page.evaluate(() => document.getElementById('updateBtn').textContent)) === 'Update ready, tap to reload', 'toast wording');
      if (!duringSession) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await shot(page, 'update-toast');
      }
      await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }), page.click('#updateBtn')]);
      await page.waitForSelector('#list');
      expect((await libraryVersion(page)) === 'v2026.01.02', `after the tap the new version shows: ${await libraryVersion(page)}`);
      const state = await readSw(page);
      expect(JSON.stringify(state.caches) === JSON.stringify(['vocal-practice-2026.01.02']), `the old cache is deleted: ${state.caches}`);
      expect(state.controlled, 'the new worker controls the page');
      expect(await page.evaluate(() => document.getElementById('updateToast').hidden), 'toast gone after updating');
      errors.push(...pageErrors);
      await browser.close();
      server.stop();
    });
  }

  // ---- export / import (no worker needed) ----
  await run('export and import', async () => {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { initScript: seedScript({ vp_ex: [QUICK, SLOW], vp_hist: HISTORY, vp_def: { start: 45, end: 52 }, vp_lat: 0.2, vp_vlag: 0.17, vp_theme: 'dark', vp_onboarded: 1 }) });
    const local = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, JSON.parse(localStorage.getItem(key))])));
    const original = await local();
    // Data section and version at the bottom of the library
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shot(page, 'library-bottom');
    expect((await page.evaluate(() => document.getElementById('dataTitle').textContent)) === 'Your data', 'Your data section is there');
    // Export
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    const file = path.join(work, download.suggestedFilename());
    await download.saveAs(file);
    expect(/^vocal-practice-backup-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), `file name: ${download.suggestedFilename()}`);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(backup.app === 'vocal-practice' && backup.schema === 2 && !Number.isNaN(Date.parse(backup.exportedAt)), 'backup header');
    expect(JSON.stringify(Object.keys(backup.data).sort()) === JSON.stringify(['vp_def', 'vp_ex', 'vp_hist', 'vp_lat', 'vp_onboarded', 'vp_theme', 'vp_vlag']), `backup keys: ${Object.keys(backup.data)}`);
    const { vp_schema, ...originalData } = original;
    expect(JSON.stringify(backup.data) === JSON.stringify(Object.fromEntries(Object.entries(originalData).sort())) || JSON.stringify(Object.entries(backup.data).sort()) === JSON.stringify(Object.entries(originalData).sort()), 'backup data equals what is saved');
    expect(/Saved a backup with 2 exercises, 2 sessions/.test(await page.evaluate(() => document.getElementById('dataMsg').textContent)), 'export message');

    // Replace: change things, then import the file with Replace.
    await page.evaluate(() => { localStorage.setItem('vp_ex', JSON.stringify([{ id: 'other', name: 'Other', pat: '1-2-3', vows: ['ah'], start: 48, end: 50 }])); localStorage.setItem('vp_hist', '[]'); localStorage.setItem('vp_theme', '"light"'); });
    await page.reload();
    await page.waitForSelector('#list');
    await page.setInputFiles('#importFile', file);
    await page.waitForSelector('#importCard:not([hidden])');
    const summary = await page.evaluate(() => document.getElementById('importSummary').textContent);
    expect(/2 exercises, 2 sessions/.test(summary), `summary: ${summary}`);
    await shot(page, 'import-choice');
    await page.click('#replaceBtn');
    const afterReplace = await local();
    expect(JSON.stringify(afterReplace.vp_ex) === JSON.stringify(original.vp_ex) && JSON.stringify(afterReplace.vp_hist) === JSON.stringify(original.vp_hist), 'Replace restores exercises and history');
    expect(afterReplace.vp_theme === 'dark' && afterReplace.vp_lat === 0.2 && afterReplace.vp_vlag === 0.17, 'Replace restores settings');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'), 'Replace applies the restored theme');
    expect(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#list .ex b')].map((n) => n.textContent))) === JSON.stringify(['Quick round', 'Long one']), 'library shows the restored exercises');
    expect(/Done\. You now have 2 exercises, 2 sessions/.test(await page.evaluate(() => document.getElementById('dataMsg').textContent)), 'done message');
    expect(await page.evaluate(() => document.getElementById('importCard').hidden), 'import card closes');

    // Merge: the phone has its own extra exercise and run; the backup adds what is missing.
    const extraRun = { name: 'Other', exId: 'other', pct: 90, ts: 1765000000000, date: 'Dec 6' };
    await page.evaluate((entry) => {
      localStorage.setItem('vp_ex', JSON.stringify([{ id: 'other', name: 'Other', pat: '1-2-3', vows: ['ah'], start: 48, end: 50 }, { id: 'xq', name: 'Renamed on this phone', pat: '1-3-5', vows: ['ah'], start: 48, end: 48 }]));
      localStorage.setItem('vp_hist', JSON.stringify([entry, { name: 'Quick round', exId: 'xq', pct: 80, ts: 1764000000000, date: 'Nov 24' }]));
      localStorage.setItem('vp_theme', '"light"');
    }, extraRun);
    await page.reload();
    await page.waitForSelector('#list');
    await page.setInputFiles('#importFile', file);
    await page.waitForSelector('#importCard:not([hidden])');
    await page.click('#mergeBtn');
    const afterMerge = await local();
    expect(JSON.stringify(afterMerge.vp_ex.map((e) => [e.id, e.name])) === JSON.stringify([['other', 'Other'], ['xq', 'Renamed on this phone'], ['xs', 'Long one']]), `Merge keeps existing, adds new: ${JSON.stringify(afterMerge.vp_ex.map((e) => [e.id, e.name]))}`);
    expect(JSON.stringify(afterMerge.vp_hist.map((e) => e.ts)) === JSON.stringify([1765000000000, 1764000000000, 1763000000000]), `Merge unions history, newest first: ${JSON.stringify(afterMerge.vp_hist.map((e) => e.ts))}`);
    expect(afterMerge.vp_theme === 'light', 'Merge leaves settings alone');

    // Invalid files: friendly message, nothing changed
    const before = JSON.stringify(await local());
    const bad = [['wrong-app.json', JSON.stringify({ app: 'other', schema: 2, data: {} }), /doesn't look like a Vocal Practice backup/], ['newer.json', JSON.stringify({ app: 'vocal-practice', schema: 99, data: {} }), /newer version/], ['broken.json', '{"app": "vocal-prac', /doesn't look like a Vocal Practice backup/], ['damaged.json', JSON.stringify({ app: 'vocal-practice', schema: 2, data: { vp_ex: 'nope' } }), /damaged/]];
    for (const [name, content, pattern] of bad) {
      const badFile = path.join(work, name);
      fs.writeFileSync(badFile, content);
      await page.setInputFiles('#importFile', badFile);
      await page.waitForFunction(() => !document.getElementById('dataMsg').hidden && !/Done/.test(document.getElementById('dataMsg').textContent));
      const message = await page.evaluate(() => document.getElementById('dataMsg').textContent);
      expect(pattern.test(message), `${name}: ${message}`);
      expect(await page.evaluate(() => document.getElementById('importCard').hidden), `${name}: no choice card`);
      if (name === 'wrong-app.json') await shot(page, 'import-error');
    }
    expect(JSON.stringify(await local()) === before, 'invalid files change nothing');
    errors.push(...pageErrors);
    await browser.close();
  });

  // ---- P6: failed saves tell the person once ----
  await run('failed saves', async () => {
    const failing = `(() => { window.__failWrites = false; const real = Storage.prototype.setItem; Storage.prototype.setItem = function (...a) { if (window.__failWrites) throw new DOMException('full', 'QuotaExceededError'); return real.apply(this, a); }; })();`;
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { initScript: failing });
    const toast = () => page.evaluate(() => ({ hidden: document.getElementById('toast').hidden, text: document.getElementById('toastMsg').textContent }));
    expect((await toast()).hidden, 'no toast before anything fails');
    await page.evaluate(() => { window.__failWrites = true; });
    await page.click('#themeBtn');   // writes vp_theme
    const first = await toast();
    expect(!first.hidden && first.text === "I couldn't save that. Your phone's storage might be full. Try exporting a backup.", `first failure shows the message: ${JSON.stringify(first)}`);
    await shot(page, 'save-failed-toast');
    await page.evaluate(() => { document.getElementById('toast').hidden = true; });
    await page.click('#themeBtn');
    await page.click('#themeBtn');
    expect((await toast()).hidden, 'later failures stay quiet');
    // An import that cannot be saved says so and changes nothing
    const file = path.join(work, 'small.json');
    fs.writeFileSync(file, JSON.stringify({ app: 'vocal-practice', schema: 2, data: { vp_ex: [QUICK] } }));
    await page.setInputFiles('#importFile', file);
    await page.waitForSelector('#importCard:not([hidden])');
    await page.click('#replaceBtn');
    expect(/couldn't save the backup/.test(await page.evaluate(() => document.getElementById('dataMsg').textContent)), 'a failed import says so');
    errors.push(...pageErrors);
    await browser.close();
  });

  servers.forEach((server) => server.stop());
  fs.rmSync(work, { recursive: true, force: true });
  return { errors };
}

module.exports = { runOfflineChecks };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const shotsIndex = args.indexOf('--shots');
    const shotsDir = shotsIndex >= 0 ? args[shotsIndex + 1] : null;
    const server = await serve(REPO);
    const { errors } = await runOfflineChecks(server.url, { shotsDir });
    server.stop();
    console.log(JSON.stringify({ errors }, null, 2));
    process.exit(errors.length ? 1 : 0);
  })();
}
