// A scripted tour of the whole app in headless Chrome. Used by check-app.cjs and compare-old-new.cjs.
// Everything it observes is returned as plain data so two builds can be compared.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CHROME_ARGS = [
  '--use-fake-ui-for-media-stream',      // auto-accept the microphone prompt
  '--use-fake-device-for-media-stream',  // a fake mic that plays a beeping tone
  '--autoplay-policy=no-user-gesture-required',
  '--no-sandbox',
];

const SCREENS = ['lib', 'add', 'prac', 'rep'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Open the app in a fresh browser context and collect every console / page error. */
/**
 * A steady one-second tone (196 Hz, G3, a whole number of cycles so it loops without a click) for the fake microphone.
 * Chrome's default fake mic only beeps for ~60 ms every half second, which at ~50 analyses per second gives a note
 * 3 frames or fewer (B12): whether a note counts as heard then depends on luck. A steady tone does not.
 * Written to the temp folder with ffmpeg on first use.
 */
function steadyToneFile() {
  const file = path.join(os.tmpdir(), 'vp-steady-196hz.wav');
  if (!fs.existsSync(file)) {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=196:duration=1:sample_rate=16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', file]);
  }
  return file;
}

async function openApp(baseUrl, { colorScheme = 'light', initScript = null, steadyTone = false, samples = false, viewport = null, reducedMotion = 'reduce' } = {}) {
  const args = steadyTone ? [...CHROME_ARGS, `--use-file-for-fake-audio-capture=${steadyToneFile()}`] : CHROME_ARGS;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args });
  const context = await browser.newContext({
    viewport: viewport || { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme,
    permissions: ['microphone'],
    reducedMotion,
  });
  const errors = [];
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  // No network in CI-like environments: answer the Google Fonts request with an empty stylesheet so it is not an "error".
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  // F5: the recorded piano is off by default in these checks, so the older checks keep seeing the synthesised piano's
  // oscillators (what they count). Pass {samples: true} to let the samples load. The aborted fetches are expected, not errors.
  if (!samples) {
    await page.route(/\/audio\/piano\//, (route) => route.abort());
  }
  page.on('console', (message) => {
    // Chrome itself logs "Failed to load resource" for every aborted sample fetch; that line is the browser's, not the app's.
    if (message.type() === 'error' && !(!samples && /Failed to load resource: net::ERR_FAILED/.test(message.text()))) errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => !/\/audio\/piano\//.test(request.url()) && errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
  });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('#list');
  return { browser, page, errors };
}

const activeScreen = (page) => page.evaluate(() => [...document.querySelectorAll('section.on')].map((s) => s.id).join(','));
const text = (page, selector) => page.evaluate((sel) => document.querySelector(sel)?.innerText ?? null, selector);
const storage = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));

/** Exercise ids are random; replace them by their position so two runs can be compared. */
function normaliseStorage(raw) {
  const copy = { ...raw };
  if (copy.vp_ex) {
    const list = JSON.parse(copy.vp_ex);
    copy.vp_ex = JSON.stringify(list.map(({ id, ...rest }) => rest));
  }
  return copy;
}

/**
 * Walk through the app. `shots` (optional) is a function (name, page) => Promise for screenshots.
 * Returns {errors, observations}.
 */
async function runScenario(baseUrl, { shots } = {}) {
  const { browser, page, errors } = await openApp(baseUrl);
  const obs = { screens: {} };
  const visited = new Set();
  const visit = async (expected) => {
    const active = await activeScreen(page);
    if (active !== expected) errors.push(`expected screen ${expected}, found ${active}`);
    visited.add(active);
  };
  const shot = async (name) => { if (shots) await shots(name, page); };

  try {
    // 1. Library, first launch (sample exercises, empty history).
    await visit('lib');
    obs.libraryFirst = { list: await text(page, '#list'), journey: await text(page, '#journey'), hist: await text(page, '#hist') };
    await shot('lib-light');

    // 2. Theme button: auto -> light -> dark -> auto.
    obs.theme = [];
    for (let i = 0; i < 3; i++) {
      await page.click('#themeBtn');
      obs.theme.push(await page.evaluate(() => ({
        attr: document.documentElement.getAttribute('data-theme'),
        label: document.getElementById('themeBtn').getAttribute('aria-label'),
        saved: localStorage.getItem('vp_theme'),
      })));
      if (i === 1) await shot('lib-dark');
    }

    // 3. Add: type the textarea's own placeholder lines, Convert all, Save.
    await page.click('#newBtn');
    await visit('add');
    const placeholderLines = await page.evaluate(() => document.getElementById('notes').placeholder.split('\n').slice(1));
    obs.placeholderLines = placeholderLines;
    await page.fill('#notes', placeholderLines.join('\n'));
    await page.click('#parseBtn');
    obs.converted = await page.evaluate(() => [...document.querySelectorAll('#eds .ed')].map((card) => ({
      title: card.querySelector('h3').textContent,
      summary: card.querySelector('.sum').textContent,
      fields: Object.fromEntries([...card.querySelectorAll('[data-k]')].map((f) => [f.dataset.k, f.type === 'checkbox' ? f.checked : f.value])),
    })));
    obs.convertedHtml = await page.evaluate(() => document.getElementById('eds').innerHTML.replace(/\s+/g, ' '));
    obs.saveLabel = await text(page, '#saveBtn');
    await sleep(900); // let the smooth scroll to the cards settle
    await shot('add-converted-light');
    // A short extra exercise (fast tempo) so a full session finishes within a few seconds.
    await page.click('#eds .ed [data-a=del]'); // remove card 1 to exercise the Remove button
    obs.afterRemoveCount = await page.evaluate(() => document.querySelectorAll('#eds .ed').length);
    await page.fill('#notes', '1-3-5 on ah, C3 to C3, 200 bpm\n1-3-5 with lip trill, C3 to C3, 200 bpm');
    await page.click('#parseBtn');
    for (const [index, name] of ['Quick check', 'Quick trill'].entries()) {
      await page.fill(`#eds .ed:nth-child(${index + 1}) [data-k=name]`, name);
      await page.fill(`#eds .ed:nth-child(${index + 1}) [data-k=bpm]`, '200');
      await page.dispatchEvent(`#eds .ed:nth-child(${index + 1}) [data-k=bpm]`, 'change');
    }
    obs.quickSummaries = await page.evaluate(() => [...document.querySelectorAll('#eds .ed .sum')].map((n) => n.textContent));
    // "Hear one round" (piano preview) must not throw.
    await page.click('#eds .ed [data-a=hear]');
    await sleep(300);
    await page.click('#eds .ed [data-a=hear]');
    await page.click('#saveBtn');
    await visit('lib');
    obs.librarySaved = { list: await text(page, '#list'), journey: await text(page, '#journey') };
    obs.storageAfterSave = normaliseStorage(await storage(page));

    // 4. Browser Back from the Add screen returns to the library.
    await page.click('#newBtn');
    await visit('add');
    await page.goBack();
    await sleep(100);
    await visit('lib');

    // 5. Practice: open the quick exercise, Start, let it run, Stop.
    const quickIndex = await page.evaluate(() => [...document.querySelectorAll('#list .ex b')].findIndex((b) => b.textContent === 'Quick check'));
    obs.quickIndex = quickIndex;
    await page.click(`#list button[data-a=p][data-i="${quickIndex}"]`);
    await visit('prac');
    obs.practice = { name: await text(page, '#pName'), info: await text(page, '#pInfo'), syl: await text(page, '#rSyl'), go: await text(page, '#goBtn') };
    await shot('prac-idle-light');
    // Same screen in the dark theme (two taps: auto -> light -> dark), then back to auto.
    // (F4: the practice screen has no theme button, so press it by script.)
    const pressTheme = () => page.evaluate(() => document.getElementById('themeBtn').click());
    await pressTheme();
    await pressTheme();
    await shot('prac-idle-dark');
    await pressTheme();
    await page.evaluate(() => {
      const slider = document.getElementById('sync');
      slider.value = '230';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const volume = document.getElementById('vol');
      volume.value = '0.4';
      volume.dispatchEvent(new Event('input', { bubbles: true }));
    });
    obs.pictureDelayLabel = await page.evaluate(() => document.getElementById('syncV').textContent); // inside a closed <details>, so innerText would be empty
    obs.savedPictureDelay = await page.evaluate(() => localStorage.getItem('vp_lat'));
    await page.click('#goBtn');
    await sleep(2500);
    obs.practiceRunning = { go: await text(page, '#goBtn'), target: await text(page, '#rTarget') };
    await page.click('#goBtn'); // Stop
    obs.practiceStopped = { go: await text(page, '#goBtn') };
    await page.click('#backBtn');
    await visit('lib');

    // 6. Run whole sessions to the end and land on the report (one plain sound, one lip trill).
    obs.reports = {};
    for (const name of ['Quick check', 'Quick trill']) {
      const index = await page.evaluate((n) => [...document.querySelectorAll('#list .ex b')].findIndex((b) => b.textContent === n), name);
      await page.click(`#list button[data-a=p][data-i="${index}"]`);
      await visit('prac');
      await page.click('#goBtn');
      await page.waitForSelector('section#rep.on', { timeout: 20000 });
      await visit('rep');
      obs.reports[name] = {
        title: await text(page, '#repTitle'),
        statNames: await page.evaluate(() => [...document.querySelectorAll('#stats .stat > span:first-child')].map((s) => s.textContent)),
        hasNotes: await page.evaluate(() => document.querySelectorAll('#notesOut .cell').length > 0),
        trillNoteHidden: await page.evaluate(() => document.getElementById('trNote').hidden),
        againLabel: await text(page, '#againBtn'),
      };
      if (name === 'Quick check') await shot('rep-light');
      await page.click('section#rep [data-go=lib]'); // "Done"
      await visit('lib');
    }
    obs.storageAfterRun = normaliseStorage(await storage(page));
    // "Go again" returns to practice, Back returns to the library.
    await page.click(`#list button[data-a=p][data-i="${quickIndex}"]`);
    await page.click('#goBtn');
    await page.waitForSelector('section#rep.on', { timeout: 20000 });
    await page.click('#againBtn');
    await visit('prac');
    await page.click('#backBtn');
    await visit('lib');

    // 8. Edit a saved exercise and save the change.
    await page.click('#list button[data-a=e][data-i="0"]');
    await visit('add');
    obs.editHtml = await page.evaluate(() => document.getElementById('eds').innerHTML.replace(/\s+/g, ' '));
    await page.fill('#eds .ed [data-k=name]', 'Renamed scale');
    await page.fill('#eds .ed [data-k=bpm]', '100');
    await page.dispatchEvent('#eds .ed [data-k=bpm]', 'change');
    obs.editSummary = await page.evaluate(() => document.querySelector('#eds .ed .sum').textContent);
    obs.editSaveLabel = await text(page, '#saveBtn');
    await page.click('#saveBtn');
    await visit('lib');
    obs.libraryAfterEdit = await text(page, '#list');
    // Invalid input: Save does nothing today (stays on the screen).
    await page.click('#list button[data-a=e][data-i="0"]');
    await page.fill('#eds .ed [data-k=pat]', 'nonsense');
    await page.dispatchEvent('#eds .ed [data-k=pat]', 'change');
    obs.invalidSummary = await page.evaluate(() => document.querySelector('#eds .ed .sum').textContent);
    await page.click('#saveBtn');
    await visit('add');
    // Delete needs a second tap; do it on the renamed exercise.
    await page.fill('#eds .ed [data-k=pat]', '1-2-3');
    await page.dispatchEvent('#eds .ed [data-k=pat]', 'change');
    // F6: Delete is immediate now (with an Undo toast), no second tap.
    await page.click('#eds .ed [data-a=del]');
    await visit('lib');
    obs.deleteToast = await text(page, '#toast');
    obs.libraryAfterDelete = await text(page, '#list');
    // Remove the remaining sample exercises so "Practice all" only has the two quick ones.
    for (;;) {
      const sampleIndex = await page.evaluate(() => [...document.querySelectorAll('#list .ex b')].findIndex((b) => !b.textContent.startsWith('Quick')));
      if (sampleIndex < 0) break;
      await page.click(`#list button[data-a=e][data-i="${sampleIndex}"]`);
      await page.click('#eds .ed [data-a=del]');
      await visit('lib');
    }
    obs.libraryOnlyQuick = await text(page, '#list');

    // 9. Practice all in order: queue label, finish the first, "Next:" button, second one, then the end.
    await page.click('#allBtn');
    await visit('prac');
    obs.practiceAll = await text(page, '#pName');
    await page.click('#goBtn');
    await page.waitForSelector('section#rep.on', { timeout: 20000 });
    obs.nextButton = { hidden: await page.evaluate(() => document.getElementById('nextBtn').hidden), label: await text(page, '#nextBtn') };
    await page.click('#nextBtn');
    await visit('prac');
    obs.practiceNext = await text(page, '#pName');
    await page.click('#goBtn');
    await page.waitForSelector('section#rep.on', { timeout: 20000 });
    obs.lastReportNextHidden = await page.evaluate(() => document.getElementById('nextBtn').hidden);
    await page.click('section#rep [data-go=lib]');
    await visit('lib');

    obs.storageEnd = normaliseStorage(await storage(page));
    obs.visitedScreens = [...visited].sort();
    for (const screen of SCREENS) if (!visited.has(screen)) errors.push(`never visited screen ${screen}`);
  } catch (error) {
    errors.push(`scenario failed: ${error.stack || error}`);
  } finally {
    await browser.close();
  }
  return { errors, observations: obs };
}

module.exports = { runScenario, openApp,  normaliseStorage, CHROME_ARGS, sleep, steadyToneFile };
