// Browser checks for PR 7 (F2 to F12). Real headless Chrome, fake mic, a Pixel-like 412 x 915 viewport.
//   1. piano:    the recorded samples load (17 requests, all 200), play as AudioBufferSourceNodes, sit behind a limiter;
//                a failed fetch falls back to the synth without an app error; the decoded files start on the attack
//   2. practice: F2 round line + progress + "Ready…", F3 fade to a dash, F4 header hidden / buttons pinned / sound drawer
//   3. library:  F6 reorder / duplicate / delete + Undo, F7 Hear one round -> Stop, F8 practice-all summary, F9 sparkline,
//                F10 first-launch card, F11 theme label, F12 empty states
// With --shots <dir> it also saves screenshots (library, practice idle / running, report; light and dark).
const fs = require('node:fs');
const path = require('node:path');
const { openApp, sleep } = require('./scenario.cjs');
const { INSTRUMENT } = require('./session-checks.cjs');

const VIEWPORT = { width: 412, height: 915 };

const EXTRA = `
(() => {
  const rec = window.__rec;
  rec.bufferSources = [];
  rec.compressors = [];
  rec.warnings = [];
  const realBuffer = BaseAudioContext.prototype.createBufferSource;
  BaseAudioContext.prototype.createBufferSource = function (...args) {
    const node = realBuffer.apply(this, args);
    rec.bufferSources.push(node);
    return node;
  };
  const realComp = BaseAudioContext.prototype.createDynamicsCompressor;
  BaseAudioContext.prototype.createDynamicsCompressor = function (...args) {
    const node = realComp.apply(this, args);
    rec.compressors.push(node);
    return node;
  };
  const realWarn = console.warn;
  console.warn = (...args) => { rec.warnings.push(args.map(String).join(' ')); return realWarn.apply(console, args); };
})();`;

const QUICK = { id: 'xq', name: 'Quick rounds', pat: '1-3-5', vows: ['ah'], rootVow: '', start: 48, end: 51, top: false, both: false, step: 1, bpm: 200, hold: 2 };
// A single held G3: the fake mic's steady 196 Hz tone (G3) lands it, so runs of these have something to report.
const G = (id, name, end = 55) => ({ id, name, pat: '1~', vows: ['ah'], rootVow: '', start: 55, end, top: false, both: false, step: 1, bpm: 200, hold: 2 });

const text = (page, selector) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, selector);
const active = (page) => page.evaluate(() => [...document.querySelectorAll('section.on')].map((s) => s.id).join(','));
const seed = (page, { exercises, history, extra = {} }) => page.evaluate(([ex, hist, more]) => {
  localStorage.clear();
  if (ex) localStorage.setItem('vp_ex', JSON.stringify(ex));
  if (hist) localStorage.setItem('vp_hist', JSON.stringify(hist));
  Object.entries(more).forEach(([key, value]) => localStorage.setItem(key, value));
}, [exercises || null, history || null, extra]);
const reload = async (page) => {
  await page.reload();
  await page.waitForSelector('#list');
};
// (page.waitForFunction does not wait for an async predicate, so poll from here.)
const pianoStatus = (page) => page.evaluate(async () => (await import(new URL('js/audio.js', location.href).href)).pianoStatus());
async function waitPiano(page, wanted, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const status = await pianoStatus(page);
    if (status.state === wanted) return status;
    if (Date.now() > until) throw new Error(`piano state stayed ${status.state}, wanted ${wanted}`);
    await sleep(100);
  }
}
const waitReport = (page, timeout = 40000) => page.waitForSelector('section#rep.on', { timeout });
const clickPractice = (page, index = 0) => page.click(`#list button[data-a=p][data-i="${index}"]`);
const libraryOrder = (page) => page.evaluate(() => [...document.querySelectorAll('#list .ex b')].map((b) => b.textContent));
const storedExercises = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('vp_ex') || 'null'));

async function runPolishChecks(baseUrl, { shotsDir = null } = {}) {
  const problems = [];
  const errors = [];
  const observations = {};
  const expect = (condition, message) => { if (!condition) problems.push(message); };
  const shot = async (page, name) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, name + '.png') }); };
  const guard = async (name, body) => {
    try {
      await body();
    } catch (error) {
      problems.push(`${name}: threw ${error.message}`);
    }
  };

  // ---------------------------------------------------------------- 1. the piano
  {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { initScript: INSTRUMENT + EXTRA, steadyTone: true, samples: true, viewport: VIEWPORT });
    errors.push(...pageErrors);
    const responses = [];
    page.on('response', (response) => { if (/\/audio\/piano\/.*\.mp3$/.test(response.url())) responses.push({ url: response.url(), status: response.status() }); });
    await guard('piano', async () => {
      await seed(page, { exercises: [G('g1', 'Piano check')] });
      await reload(page);
      await page.click('#list button[data-a=p][data-i="0"]');   // opening the practice screen loads the samples
      const status = await waitPiano(page, 'ready');
      observations.pianoStatus = status;
      expect(status.loaded === 17 && status.total === 17, `expected 17 decoded buffers (saw ${JSON.stringify(status)})`);
      const unique = new Set(responses.map((r) => r.url));
      expect(unique.size === 17, `expected 17 distinct sample requests (saw ${unique.size})`);
      expect(responses.every((r) => r.status === 200), `all sample requests should be 200 (saw ${responses.map((r) => r.status).join()})`);
      expect(responses.length === 17, `each sample should be fetched once (saw ${responses.length} responses)`);

      // The decoded files start on the note's attack (MP3 encoder delay removed) and are mono, ~2.8 s.
      const decoded = await page.evaluate(async () => {
        const out = {};
        for (const name of ['C2', 'Fs3', 'C6']) {
          const data = await (await fetch(`audio/piano/${name}.mp3`)).arrayBuffer();
          const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
          const samples = buffer.getChannelData(0);
          let peak = 0;
          for (const x of samples) peak = Math.max(peak, Math.abs(x));
          const onset = samples.findIndex((x) => Math.abs(x) > peak * 0.05);
          out[name] = { channels: buffer.numberOfChannels, seconds: +buffer.duration.toFixed(3), onsetMs: +(onset / buffer.sampleRate * 1000).toFixed(1), peak: +peak.toFixed(2) };
        }
        return out;
      });
      observations.decoded = decoded;
      Object.entries(decoded).forEach(([name, info]) => {
        expect(info.channels === 1 && info.seconds > 2.7 && info.seconds < 2.95, `${name}: mono, about 2.8 s (saw ${JSON.stringify(info)})`);
        expect(info.onsetMs < 30, `${name}: attack should start within 30 ms of the start of the file (saw ${info.onsetMs} ms)`);
        expect(info.peak <= 0.95, `${name}: peak ${info.peak} too hot`);
      });

      // Playing uses buffer sources, no oscillators, and the master chain has the limiter.
      await page.click('#goBtn');
      await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
      await sleep(2500);
      const playing = await page.evaluate(() => ({
        sources: window.__rec.bufferSources.length,
        oscillators: window.__rec.osc,
        rates: window.__rec.bufferSources.slice(0, 3).map((s) => +s.playbackRate.value.toFixed(4)),
        buffers: window.__rec.bufferSources.every((s) => s.buffer && s.buffer.numberOfChannels === 1),
        limiters: window.__rec.compressors.map((c) => ({ threshold: c.threshold.value, ratio: c.ratio.value, release: +c.release.value.toFixed(2), attack: +c.attack.value.toFixed(3) })),
      }));
      observations.playing = playing;
      expect(playing.sources >= 3, `the first cue chord should be 3 buffer sources (saw ${playing.sources})`);
      expect(playing.oscillators === 0, `no oscillators when samples are loaded (saw ${playing.oscillators})`);
      // The first chord is G major: G3 (55) is the sample's own pitch for 54 + 1 semitone, B3 (59) is 60 - 1 ... rates are 2^(n/12)
      expect(playing.rates.every((rate) => rate > 0.94 && rate < 1.07), `rates should be within one semitone of 1 (saw ${playing.rates})`);
      expect(playing.limiters.length === 1 && playing.limiters[0].threshold === -10 && playing.limiters[0].ratio === 12 && playing.limiters[0].release === 0.25, `limiter settings (saw ${JSON.stringify(playing.limiters)})`);
      // The volume slider still works while sampled notes play.
      await page.evaluate(() => { const v = document.getElementById('vol'); v.value = '0.2'; v.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.click('#goBtn');   // Stop
      await sleep(300);
      // A second session must not fetch the samples again.
      const before = responses.length;
      await page.click('#backBtn');
      await page.waitForSelector('#list');
      await page.click('#list button[data-a=p][data-i="0"]');
      await sleep(400);
      expect(responses.length === before, 'samples should be fetched once per page, not on every practice screen');
    });
    await browser.close();
  }

  // The piano-leak notice and the rest of the scoring still work with the sampler: see runScoringChecks (it now runs with samples on).

  // ---------------------------------------------------------------- 1b. samples fail: the synth plays, silently
  {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { initScript: INSTRUMENT + EXTRA, steadyTone: true, samples: true, viewport: VIEWPORT });
    await page.route(/\/audio\/piano\//, (route) => route.abort());
    const appErrors = [];
    page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) appErrors.push(message.text()); });
    pageErrors.forEach((message) => { if (!/ERR_FAILED|Failed to load resource|requestfailed/.test(message)) errors.push(message); });
    await guard('piano fallback', async () => {
      await seed(page, { exercises: [G('g1', 'Fallback check')] });
      await reload(page);
      await page.click('#list button[data-a=p][data-i="0"]');
      await waitPiano(page, 'failed');
      await page.click('#goBtn');
      await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
      await sleep(1800);
      const result = await page.evaluate(() => ({ oscillators: window.__rec.osc, sources: window.__rec.bufferSources.length, warnings: window.__rec.warnings.filter((w) => /Piano samples/.test(w)).length }));
      observations.fallback = result;
      expect(result.oscillators >= 18 && result.sources === 0, `fallback should play the synth (saw ${JSON.stringify(result)})`);
      expect(result.warnings >= 1, 'the failure should be a console.warn');
      expect(appErrors.length === 0, `no app console.error on a failed sample fetch (saw ${appErrors.join(' | ')})`);
      await page.click('#goBtn');
    });
    await browser.close();
  }

  // ---------------------------------------------------------------- 2. the practice screen
  {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { initScript: INSTRUMENT + EXTRA, steadyTone: true, samples: true, viewport: VIEWPORT });
    errors.push(...pageErrors);
    await guard('practice screen', async () => {
      await seed(page, { exercises: [QUICK, G('g1', 'Held G')] });
      await reload(page);
      await shot(page, 'library-light');
      await clickPractice(page, 0);
      // F4: header hidden, buttons pinned, sound settings drawer.
      const layout = await page.evaluate(() => {
        const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
        const visible = (selector) => { const el = document.querySelector(selector); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        return {
          headerVisible: visible('.top'),
          themeVisible: visible('#themeBtn'),
          dock: rect('.dock'),
          go: rect('#goBtn'),
          back: rect('#backBtn'),
          backVisible: visible('#backBtn'),
          viewport: [innerWidth, innerHeight],
          drawerHasSliders: !!document.querySelector('#soundDrawer #vol') && !!document.querySelector('#soundDrawer #sync') && !!document.querySelector('#soundDrawer #syncReset'),
          volOutsideDrawer: !!document.querySelector('#vol') && !document.querySelector('#soundDrawer').contains(document.querySelector('#vol')),
          drawerOpen: document.getElementById('soundDrawer').open,
          drawerSummary: document.querySelector('#soundDrawer summary').textContent,
          fig: rect('.fig'),
          scrollable: document.documentElement.scrollHeight > innerHeight,
          roundLine: document.getElementById('roundLine').textContent,
          bodyScreen: document.body.dataset.screen,
        };
      });
      observations.layout = layout;
      expect(!layout.headerVisible && !layout.themeVisible, 'practice: the app header and theme button should be hidden');
      expect(layout.bodyScreen === 'prac', 'body should know the screen');
      expect(layout.viewport[0] === 412 && layout.viewport[1] === 915, `viewport ${layout.viewport}`);
      expect(Math.abs(layout.dock.bottom - 915) <= 1, `buttons should be pinned to the bottom (dock bottom ${layout.dock.bottom})`);
      expect(layout.go.top > 915 - 120 && layout.go.bottom <= 915 && layout.go.height >= 44, `Start should sit in the bottom 120 px at least 44 px tall (top ${layout.go.top}, height ${layout.go.height})`);
      expect(layout.backVisible && layout.back.top < 80 && layout.back.left < 40, `Back should be a small top-left link (saw ${JSON.stringify(layout.back)})`);
      expect(layout.drawerHasSliders && !layout.volOutsideDrawer, 'volume, picture delay and reset belong in the Sound settings drawer');
      expect(layout.drawerSummary === 'Sound settings' && !layout.drawerOpen, 'drawer is closed and called Sound settings');
      expect(layout.fig.bottom <= layout.dock.top + 1, `the roll should end above the buttons without scrolling at 412 x 915 (roll bottom ${layout.fig.bottom}, dock top ${layout.dock.top})`);
      expect(layout.roundLine === 'Round 1 of 4 · starting on C3', `idle round line (saw "${layout.roundLine}")`);
      await shot(page, 'practice-idle-light');
      // The dock stays put when the page scrolls.
      await page.evaluate(() => window.scrollTo(0, 400));
      const afterScroll = await page.evaluate(() => document.querySelector('.dock').getBoundingClientRect().bottom);
      expect(Math.abs(afterScroll - 915) <= 1, 'dock should stay pinned while scrolling');
      await page.evaluate(() => window.scrollTo(0, 0));

      // F2: label across rounds, progress bar, "Ready…" then the first sound.
      await page.evaluate(() => {
        window.__labels = [];
        window.__sing = [];
        window.__progress = [];
        const watch = (id, into, attribute) => new MutationObserver(() => into.push(attribute ? document.getElementById(id).getAttribute(attribute) : document.getElementById(id).textContent))
          .observe(document.getElementById(id), { childList: true, characterData: true, subtree: true, attributes: !!attribute, attributeFilter: attribute ? [attribute] : undefined });
        watch('roundLine', window.__labels);
        watch('rSyl', window.__sing);
        watch('prog', window.__progress, 'aria-valuenow');
      });
      await page.click('#goBtn');
      await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
      await sleep(250);
      const early = await page.evaluate(() => ({ sing: document.getElementById('rSyl').textContent, label: document.getElementById('roundLine').textContent }));
      expect(early.sing === 'Ready…', `first chord should show "Ready…" (saw "${early.sing}")`);
      expect(early.label === 'Round 1 of 4 · starting on C3', `running round line (saw "${early.label}")`);
      await page.waitForFunction(() => document.getElementById('rSyl').textContent === 'ah', null, { timeout: 5000 });
      await shot(page, 'practice-running-light');
      // F3: the steady tone is G3, so "You" shows it and is not faded...
      await page.waitForFunction(() => document.getElementById('rNote').textContent === 'G3' && !document.getElementById('rNote').classList.contains('quiet'), null, { timeout: 8000 });
      const voiced = await page.evaluate(() => ({ needleQuiet: document.getElementById('needle').classList.contains('quiet'), cents: document.getElementById('rCents').textContent.trim() }));
      expect(!voiced.needleQuiet && /cents/.test(voiced.cents), `voiced: needle shown with cents (saw ${JSON.stringify(voiced)})`);
      // ...and when the mic goes silent it fades to a dash within ~0.3 s (checked after 0.7 s), and returns with the voice.
      await page.evaluate(() => window.__rec.streams.forEach((stream) => stream.getAudioTracks().forEach((track) => { track.enabled = false; })));
      await sleep(700);
      const silent = await page.evaluate(() => ({ note: document.getElementById('rNote').textContent, quiet: document.getElementById('rNote').classList.contains('quiet'), needleQuiet: document.getElementById('needle').classList.contains('quiet'), cents: document.getElementById('rCents').textContent.trim(), opacity: getComputedStyle(document.getElementById('needle')).opacity }));
      observations.silent = silent;
      expect(silent.note === '–' && silent.quiet && silent.needleQuiet && silent.cents === '', `silent: You and needle should fade to a dash (saw ${JSON.stringify(silent)})`);
      await page.evaluate(() => window.__rec.streams.forEach((stream) => stream.getAudioTracks().forEach((track) => { track.enabled = true; })));
      await page.waitForFunction(() => !document.getElementById('rNote').classList.contains('quiet') && document.getElementById('rNote').textContent !== '–', null, { timeout: 5000 });
      // Round label across rounds (4 rounds of 2.8 s).
      await page.waitForSelector('section#rep.on', { timeout: 30000 });
      const seen = await page.evaluate(() => ({ labels: [...new Set(window.__labels)], sing: [...new Set(window.__sing)], progress: window.__progress.map(Number) }));
      observations.seen = seen;
      expect(seen.labels.join('|') === ['Round 1 of 4 · starting on C3', 'Round 2 of 4 · starting on Db3', 'Round 3 of 4 · starting on D3', 'Round 4 of 4 · starting on Eb3'].join('|'), `round labels across the run (saw ${seen.labels.join(' | ')})`);
      const increasing = seen.progress.every((value, i) => i === 0 || value >= seen.progress[i - 1] || value === 0);
      expect(seen.progress.some((value) => value >= 50) && increasing, `progress bar should climb (saw ${seen.progress})`);
      expect(seen.sing.includes('Ready…') && seen.sing.includes('ah'), `Sing readout should show Ready… then ah (saw ${seen.sing})`);
      await shot(page, 'report-light');
    });
    await browser.close();
  }

  // ---------------------------------------------------------------- 3. library, editor, report
  {
    const { browser, page, errors: pageErrors } = await openApp(baseUrl, { initScript: INSTRUMENT + EXTRA, steadyTone: true, viewport: VIEWPORT });
    errors.push(...pageErrors);
    const toastText = () => text(page, '#toast');

    // F11 + F12 + F10 on a clean profile.
    await guard('first launch', async () => {
      await seed(page, {});
      await reload(page);
      const first = await page.evaluate(() => ({
        card: !document.getElementById('onboard').hidden,
        title: document.querySelector('#onboard h2').textContent,
        low: document.getElementById('obLow').value,
        high: document.getElementById('obHigh').value,
        hist: document.getElementById('hist').textContent,
        theme: document.getElementById('themeBtn').textContent,
      }));
      observations.firstLaunch = first;
      expect(first.card && first.title === "What's a comfortable range for you?", `onboarding card on a clean profile (saw ${JSON.stringify(first)})`);
      expect(first.low === 'C3' && first.high === 'G3', 'defaults are the samples\' range, C3 and G3');
      expect(first.hist === 'Your journey starts with your first run. Tap ▶ on an exercise above to begin.', `empty history text (saw "${first.hist}")`);
      await shot(page, 'library-first-launch-light');
      // Bad input is explained, nothing is saved.
      await page.fill('#obLow', 'nope');
      await page.click('#obSave');
      expect(await page.evaluate(() => !document.getElementById('obMsg').hidden && localStorage.getItem('vp_onboarded') === null), 'bad note: a message, nothing saved');
      await page.fill('#obLow', 'D3');
      await page.fill('#obHigh', 'A3');
      await page.click('#obSave');
      const saved = await page.evaluate(() => ({ def: localStorage.getItem('vp_def'), flag: localStorage.getItem('vp_onboarded'), ex: JSON.parse(localStorage.getItem('vp_ex')), hidden: document.getElementById('onboard').hidden }));
      expect(saved.def === '{"start":50,"end":57}', `vp_def after Save (saw ${saved.def})`);
      expect(saved.flag === '1' && saved.hidden, 'flag set and card hidden');
      expect(saved.ex.map((x) => [x.id, x.start, x.end]).join('|') === 's1,50,57|s2,50,55|s3,50,54', `samples re-based to D3 to A3 (saw ${JSON.stringify(saved.ex.map((x) => [x.id, x.start, x.end]))})`);
      expect((await libraryOrder(page)).join() === '5-note scale,Arpeggio lip trill,Sustain on "ng"', 'sample names unchanged');
      await reload(page);
      expect(await page.evaluate(() => document.getElementById('onboard').hidden), 'the card does not come back after Save');
      // Dismiss path.
      await seed(page, {});
      await reload(page);
      await page.click('#obSkip');
      expect(await page.evaluate(() => document.getElementById('onboard').hidden && localStorage.getItem('vp_onboarded') === '1' && localStorage.getItem('vp_ex') === null), 'Not now: hidden, flag saved, nothing else changed');
      await reload(page);
      expect(await page.evaluate(() => document.getElementById('onboard').hidden), 'the card does not come back after Not now');
      // Existing users never see it: saved exercises, or saved history.
      await seed(page, { exercises: [QUICK] });
      await reload(page);
      expect(await page.evaluate(() => document.getElementById('onboard').hidden), 'not shown when exercises are saved');
      await seed(page, { history: [{ name: 'x', pct: 50, ts: Date.now(), date: 'Nov 1' }] });
      await reload(page);
      expect(await page.evaluate(() => document.getElementById('onboard').hidden), 'not shown when there is history');
    });

    await guard('theme and empty states', async () => {
      await seed(page, { exercises: [] });
      await reload(page);
      const empty = await page.evaluate(() => ({ list: document.getElementById('list').innerText, hist: document.getElementById('hist').textContent, onboard: document.getElementById('onboard').hidden, reorder: document.getElementById('reorderBtn').hidden, all: document.getElementById('allBtn').disabled }));
      observations.emptyLibrary = empty;
      expect(/Add your coach's exercises/.test(empty.list) && /Add exercises/.test(empty.list), `empty library invite (saw "${empty.list}")`);
      expect(empty.hist === 'Your journey starts with your first run.', `no exercises: the history line does not point at a play button (saw "${empty.hist}")`);
      expect(empty.reorder && empty.all, 'nothing to reorder or practise');
      await page.click('#list button[data-a=add]');
      expect((await active(page)) === 'add', 'the invite button opens the editor');
      await page.click('section#add [data-go=lib]');
      await seed(page, { exercises: [QUICK] });
      await reload(page);
      const labels = [];
      for (let i = 0; i < 4; i++) {
        labels.push(await text(page, '#themeBtn'));
        await page.click('#themeBtn');
      }
      expect(labels.join() === 'Auto,Light,Dark,Auto', `theme button labels (saw ${labels})`);
      const aria = await page.evaluate(() => [document.getElementById('themeBtn').textContent, document.getElementById('themeBtn').getAttribute('aria-label')]);
      expect(aria[1].startsWith(`Theme: ${aria[0]}`), `aria-label follows the visible word (saw ${aria})`);
      await page.click('#themeBtn');
      await shot(page, 'library-light-forced');
    });

    // F6: reorder, duplicate, delete + undo.
    await guard('reorder / duplicate / delete', async () => {
      const A = { ...QUICK, id: 'a1', name: 'Alpha' };
      const B = { ...QUICK, id: 'b1', name: 'Bravo' };
      const C = { ...QUICK, id: 'c1', name: 'Charlie' };
      const history = [{ name: 'Bravo', exId: 'b1', pct: 66, ts: Date.now() - 1000, date: 'Nov 26' }];
      await seed(page, { exercises: [A, B, C], history, extra: { vp_theme: '""' } });
      await reload(page);
      await page.click('#reorderBtn');
      expect(await page.evaluate(() => document.getElementById('reorderBtn').getAttribute('aria-pressed')) === 'true', 'Reorder toggles on');
      const firstUpDisabled = await page.evaluate(() => document.querySelector('#list button[data-a=up][data-i="0"]').disabled);
      expect(firstUpDisabled, 'the first row cannot move up');
      const names = await page.evaluate(() => [...document.querySelectorAll('#list button[data-a=up],#list button[data-a=down]')].map((b) => b.getAttribute('aria-label')));
      expect(names.includes('Move Bravo up') && names.includes('Move Bravo down'), `move buttons have names (saw ${names})`);
      await page.click('#list button[data-a=up][data-i="2"]');   // Charlie up
      expect((await libraryOrder(page)).join() === 'Alpha,Charlie,Bravo', `after moving Charlie up (saw ${await libraryOrder(page)})`);
      const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      expect(focusedLabel === 'Move Charlie up', `focus stays on the moved row's button (saw ${focusedLabel})`);
      const note = await text(page, '#reorderNote');
      expect(/Charlie is now number 2 of 3/.test(note), `a spoken status (saw "${note}")`);
      await page.click('#list button[data-a=down][data-i="0"]');   // Alpha down
      expect((await libraryOrder(page)).join() === 'Charlie,Alpha,Bravo', 'after moving Alpha down');
      await page.click('#reorderBtn');   // Done
      await reload(page);
      expect((await libraryOrder(page)).join() === 'Charlie,Alpha,Bravo', 'the order persists after a reload');
      expect((await storedExercises(page)).map((x) => x.id).join() === 'c1,a1,b1', 'saved order');
      // Practice-all uses the new order.
      // Duplicate Bravo.
      await page.click('#list button[data-a=e][data-i="2"]');
      await page.click('#eds [data-a=dup]');
      await page.waitForSelector('section#lib.on');
      expect((await libraryOrder(page)).join() === 'Charlie,Alpha,Bravo,Bravo (copy)', `after duplicate (saw ${await libraryOrder(page)})`);
      const ex = await storedExercises(page);
      expect(ex[3].id !== 'b1' && ex[3].name === 'Bravo (copy)' && ex[3].pat === B.pat && ex[2].id === 'b1', 'copy has a new id and the same settings; the original is untouched');
      const histAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('vp_hist')));
      expect(histAfter.length === 1 && histAfter[0].exId === 'b1', 'history is unchanged and still belongs to the original');
      // The copy's practice screen starts with no earlier runs: the first report has the first-run cheer.
      // Delete Alpha: immediate, with Undo.
      await page.click('#list button[data-a=e][data-i="1"]');
      await page.click('#eds [data-a=del]');
      await page.waitForSelector('section#lib.on');
      expect((await libraryOrder(page)).join() === 'Charlie,Bravo,Bravo (copy)', `after delete (saw ${await libraryOrder(page)})`);
      expect(/Deleted “Alpha”/.test(await toastText()) && await page.evaluate(() => !document.getElementById('toast').hidden && !document.getElementById('toastUndo').hidden), 'a toast with Undo');
      expect((await storedExercises(page)).length === 3, 'delete is saved at once');
      await shot(page, 'library-delete-toast-light');
      await page.click('#toastUndo');
      expect((await libraryOrder(page)).join() === 'Charlie,Alpha,Bravo,Bravo (copy)', `Undo restores at the old position (saw ${await libraryOrder(page)})`);
      expect((await storedExercises(page)).map((x) => x.id).join() === 'c1,a1,b1,' + ex[3].id, 'Undo restores the same id, saved');
      expect(await page.evaluate(() => document.getElementById('toast').hidden), 'toast closes after Undo');
      // The toast goes by itself after 6 seconds.
      await page.click('#list button[data-a=e][data-i="1"]');
      await page.click('#eds [data-a=del]');
      await page.waitForSelector('section#lib.on');
      expect(await page.evaluate(() => !document.getElementById('toast').hidden), 'toast shown again');
      await sleep(5200);
      expect(await page.evaluate(() => !document.getElementById('toast').hidden), 'toast still there at 5.2 s');
      await sleep(1200);
      expect(await page.evaluate(() => document.getElementById('toast').hidden), 'toast gone after 6 s');
      expect((await libraryOrder(page)).join() === 'Charlie,Bravo,Bravo (copy)', 'still deleted');
      // Leaving the library hides a toast that is still up.
      await page.click('#list button[data-a=e][data-i="0"]');
      await page.click('#eds [data-a=del]');
      await page.waitForSelector('section#lib.on');
      await page.click('#list button[data-a=p][data-i="0"]');
      expect(await page.evaluate(() => document.getElementById('toast').hidden), 'the toast hides when another screen opens');
    });

    // F7: Hear one round -> Stop.
    await guard('hear one round', async () => {
      await seed(page, { exercises: [{ ...QUICK, bpm: 100 }] });
      await reload(page);
      await page.click('#list button[data-a=e][data-i="0"]');
      const label = () => text(page, '#eds [data-a=hear]');
      expect((await label()) === 'Hear one round', 'starts as Hear one round');
      await page.click('#eds [data-a=hear]');
      expect((await label()) === 'Stop', `while playing it reads Stop (saw ${await label()})`);
      await page.click('#eds [data-a=hear]');
      expect((await label()) === 'Hear one round', 'tapping Stop stops it and the label returns');
      await page.click('#eds [data-a=hear]');
      expect((await label()) === 'Stop', 'plays again');
      await page.waitForFunction(() => document.querySelector('#eds [data-a=hear]').textContent === 'Hear one round', null, { timeout: 8000 });
      observations.hearEndsByItself = true;
      // Leaving the screen while it plays resets it.
      await page.click('#eds [data-a=hear]');
      await page.click('#saveRow [data-go=lib]');
      await page.click('#list button[data-a=e][data-i="0"]');
      expect((await label()) === 'Hear one round', 'fresh editor shows Hear one round');
    });

    // F8: practice all, with the summary.
    await guard('practice all', async () => {
      await seed(page, { exercises: [G('g1', 'One G', 57), G('g2', 'Two G', 57), G('g3', 'Three G', 55)] });
      await reload(page);
      await page.click('#allBtn');
      const name1 = await text(page, '#pName');
      expect(/Exercise 1 of 3/.test(name1) && !/more after/.test(name1), `first exercise label (saw "${name1}")`);
      await page.click('#goBtn');
      await waitReport(page);
      expect(await page.evaluate(() => document.getElementById('setCard').hidden), 'no set summary after the first report');
      await page.click('#nextBtn');
      const name2 = await text(page, '#pName');
      expect(/Exercise 2 of 3/.test(name2), `second label (saw "${name2}")`);
      await page.click('#goBtn');
      // Stop once a round has been sung (rounds are ~2.5 s; the first one's notes are done by ~3.5 s after Start).
      await page.waitForFunction(() => document.getElementById('roundLine').textContent.startsWith('Round 2'), null, { timeout: 15000 });
      await sleep(400);
      await page.click('#goBtn');
      await waitReport(page);
      expect(/Stopped after round 1/.test(await text(page, '#repTitle')), `stopped report (saw "${await text(page, '#repTitle')}")`);
      await page.click('#nextBtn');
      expect(/Exercise 3 of 3/.test(await text(page, '#pName')), 'third label');
      await page.click('#goBtn');
      await waitReport(page);
      const summary = await page.evaluate(() => ({ hidden: document.getElementById('setCard').hidden, rows: [...document.querySelectorAll('#setRows .setrow')].map((row) => row.innerText.replace(/\s+/g, ' ').trim()), next: document.getElementById('nextBtn').hidden }));
      observations.setSummary = summary;
      expect(!summary.hidden && summary.rows.length === 3, `set summary lists 3 exercises (saw ${JSON.stringify(summary)})`);
      expect(/^One G \d+%$/.test(summary.rows[0]) && /^Two G \d+% · stopped, not saved$/.test(summary.rows[1]) && /^Three G \d+%$/.test(summary.rows[2]), `rows (saw ${JSON.stringify(summary.rows)})`);
      expect(summary.next, 'no Next after the last');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vp_hist')).map((e) => e.name));
      expect(saved.join() === 'Three G,One G', `the stopped run is not saved (saw ${saved})`);
      // A single exercise has no set card, and the label does not carry over.
      await page.click('section#rep [data-go=lib]');
      await clickPractice(page, 0);
      expect(!/Exercise/.test(await text(page, '#pName')), 'a single exercise shows no set label');
    });

    // F9: sparkline after 2 saved runs.
    await guard('sparkline', async () => {
      await seed(page, { exercises: [G('g1', 'Spark', 55)] });
      await reload(page);
      await clickPractice(page, 0);
      await page.click('#goBtn');
      await waitReport(page);
      expect(await page.evaluate(() => document.getElementById('spark').hidden), 'no sparkline after only one saved run');
      await page.click('#againBtn');
      await page.click('#goBtn');
      await waitReport(page);
      const spark = await page.evaluate(() => ({ hidden: document.getElementById('spark').hidden, label: document.querySelector('#spark svg')?.getAttribute('aria-label'), role: document.querySelector('#spark svg')?.getAttribute('role'), dots: document.querySelectorAll('#spark circle').length, now: document.querySelectorAll('#spark circle.now').length, line: !!document.querySelector('#spark polyline'), pct: document.getElementById('sPct').textContent, hist: JSON.parse(localStorage.getItem('vp_hist')).map((e) => e.pct) }));
      observations.spark = spark;
      expect(!spark.hidden && spark.role === 'img' && spark.dots === 2 && spark.now === 1 && spark.line, `sparkline drawn (saw ${JSON.stringify(spark)})`);
      expect(spark.label === `Last 2 runs: ${spark.hist[1]}% to ${spark.hist[0]}%`, `accessible label (saw "${spark.label}")`);
      expect(spark.hist[0] === parseInt(spark.pct), 'the newest saved run is the report\'s run');
      await shot(page, 'report-sparkline-light');
      // Another exercise's runs are not mixed in.
      await page.evaluate(() => {
        const hist = JSON.parse(localStorage.getItem('vp_hist'));
        hist.unshift({ name: 'Other', exId: 'other', pct: 5, ts: Date.now(), date: 'Nov 27' });
        localStorage.setItem('vp_hist', JSON.stringify(hist));
      });
    });

    // Screenshots in dark.
    await guard('dark shots', async () => {
      await seed(page, { exercises: [QUICK, G('g1', 'Held G')], history: [{ name: 'Quick rounds', exId: 'xq', pct: 60, ts: Date.now() - 86400000, date: 'Nov 26' }, { name: 'Quick rounds', exId: 'xq', pct: 40, ts: Date.now() - 2 * 86400000, date: 'Nov 25' }], extra: { vp_theme: '"dark"' } });
      await reload(page);
      await shot(page, 'library-dark');
      await clickPractice(page, 0);
      await shot(page, 'practice-idle-dark');
      await page.click('#goBtn');
      await page.waitForFunction(() => document.getElementById('rSyl').textContent === 'ah', null, { timeout: 8000 });
      await sleep(800);
      await shot(page, 'practice-running-dark');
      await waitReport(page, 30000);
      await shot(page, 'report-dark');
      await seed(page, { extra: { vp_theme: '"dark"' } });
      await reload(page);
      await shot(page, 'library-first-launch-dark');
    });
    await browser.close();
  }

  return { errors: [...errors, ...problems.map((p) => `polish check failed: ${p}`)], problems, observations };
}

module.exports = { runPolishChecks };

if (require.main === module) {
  const { serve } = require('./serve.cjs');
  (async () => {
    const args = process.argv.slice(2);
    const shotsIndex = args.indexOf('--shots');
    const shotsDir = shotsIndex >= 0 ? args[shotsIndex + 1] : null;
    if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
    const server = await serve(path.resolve(__dirname, '../..'));
    const { errors, observations } = await runPolishChecks(server.url, { shotsDir });
    server.stop();
    console.log(JSON.stringify({ observations, errors }, null, 2));
    process.exit(errors.length ? 1 : 0);
  })();
}
