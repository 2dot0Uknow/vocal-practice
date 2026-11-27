// Browser checks for session start / stop (PR 2: B1-B4, B10, B11). Real headless Chrome with a fake mic.
// The page is instrumented before it loads so the checks can see what the audio layer was asked to do:
//   window.__rec.ctxs     every AudioContext created
//   window.__rec.osc      how many oscillators were created (piano notes are six oscillators each)
//   window.__rec.streams  every microphone stream handed out
//   window.__rec.gum      {mode: 'ok' | 'reject', name, delay}: how getUserMedia should behave
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openApp, sleep } = require('./scenario.cjs');

const INSTRUMENT = `
(() => {
  const rec = window.__rec = { ctxs: [], osc: 0, streams: [], wakeLocks: 0, gum: { mode: 'ok', name: '', delay: 0 } };
  const RealContext = window.AudioContext;
  window.AudioContext = function (...args) {
    const context = new RealContext(...args);
    rec.ctxs.push(context);
    return context;
  };
  window.AudioContext.prototype = RealContext.prototype;
  const realOsc = BaseAudioContext.prototype.createOscillator;
  BaseAudioContext.prototype.createOscillator = function (...args) {
    rec.osc++;
    return realOsc.apply(this, args);
  };
  const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (rec.gum.delay) await new Promise((resolve) => setTimeout(resolve, rec.gum.delay));
    if (rec.gum.mode === 'reject') throw new DOMException('test', rec.gum.name);
    const stream = await realGum(constraints);
    rec.streams.push(stream);
    return stream;
  };
  if (navigator.wakeLock) {
    const realRequest = navigator.wakeLock.request.bind(navigator.wakeLock);
    navigator.wakeLock.request = (...args) => { rec.wakeLocks++; return realRequest(...args); };
  }
})();`;

// Three quick rounds (C3, C#3, D3) of 1-3-5 at 200 bpm: one round is about 2.5 s of song time after a 0.6 s lead-in.
const QUICK = { id: 'xq', name: 'Quick rounds', pat: '1-3-5', vows: ['ah'], rootVow: '', start: 48, end: 50, top: false, both: false, step: 1, bpm: 200, hold: 2 };
const HISTORY = [{ name: 'Quick rounds', pct: 70, ts: Date.now() - 86400000, date: 'Nov 26' }];

async function runSessionChecks(baseUrl) {
  const { browser, page, errors } = await openApp(baseUrl, { initScript: INSTRUMENT });
  const problems = [];
  const expect = (condition, message) => { if (!condition) problems.push(message); };
  const active = () => page.evaluate(() => [...document.querySelectorAll('section.on')].map((s) => s.id).join(','));
  const rec = (fn) => page.evaluate(fn);
  const allClosed = () => page.evaluate(() => window.__rec.ctxs.every((c) => c.state === 'closed'));
  const tracksEnded = () => page.evaluate(() => window.__rec.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')));
  const hist = () => page.evaluate(() => localStorage.getItem('vp_hist'));
  const setVisibility = (state) => page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  const gum = (settings) => page.evaluate((s) => Object.assign(window.__rec.gum, s), settings);
  const fresh = async () => {
    await page.evaluate(([exercise, history]) => {
      localStorage.setItem('vp_ex', JSON.stringify([exercise]));
      localStorage.setItem('vp_hist', JSON.stringify(history));
      localStorage.removeItem('vp_lat');
    }, [QUICK, HISTORY]);
    await page.reload();
    await page.waitForSelector('#list');
    await page.click('#list button[data-a=p][data-i="0"]');
    expect((await active()) === 'prac', 'practice screen did not open');
  };
  const goLabel = () => page.evaluate(() => document.getElementById('goBtn').textContent);
  const check = async (name, body) => {
    try {
      await fresh();
      await body();
    } catch (error) {
      problems.push(`${name}: threw ${error.message}`);
    }
  };
  const { buildSession, normEx } = await import(pathToFileURL(path.resolve(__dirname, '../../js/exercise.js')).href);
  const pianoNotes = buildSession(normEx(QUICK), 0).plays.reduce((sum, play) => sum + play.m.length, 0);

  // B1: two quick taps on Start make exactly one session.
  await check('double tap', async () => {
    await page.evaluate(() => { const b = document.getElementById('goBtn'); b.click(); b.click(); });
    await sleep(600);
    expect((await rec(() => window.__rec.ctxs.length)) === 1, 'double tap: more than one AudioContext');
    expect((await rec(() => window.__rec.streams.length)) === 1, 'double tap: more than one microphone request');
    expect((await rec(() => window.__rec.osc)) === pianoNotes * 6, `double tap: expected ${pianoNotes * 6} oscillators, saw ${await rec(() => window.__rec.osc)}`);
    expect((await goLabel()) === 'Stop', 'double tap: button should read Stop');
    await page.click('#backBtn');
  });

  // B1: Start, then Back while the permission prompt is still open.
  await check('start then Back', async () => {
    await gum({ delay: 600 });
    await page.click('#goBtn');
    expect(await page.evaluate(() => document.getElementById('goBtn').disabled), 'start then Back: Start should be disabled while starting');
    await page.click('#backBtn');
    expect((await active()) === 'lib', 'start then Back: should be on the library');
    await sleep(1200);
    expect((await active()) === 'lib', 'start then Back: screen changed after the mic answered');
    expect(await allClosed(), 'start then Back: an audio context is still open');
    expect(await tracksEnded(), 'start then Back: the microphone was left on');
    expect((await rec(() => window.__rec.osc)) === 0, 'start then Back: piano notes were scheduled');
    // Opening the exercise again gives a normal idle practice screen that can start.
    await gum({ delay: 0 });
    await page.click('#list button[data-a=p][data-i="0"]');
    expect((await goLabel()) === 'Start', 'start then Back: Start button not reset');
  });

  // B1: browser Back while running stops everything, with no report.
  await check('Back while running', async () => {
    await page.click('#goBtn');
    await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
    await sleep(500);
    await page.goBack();
    await sleep(300);
    expect((await active()) === 'lib', 'Back while running: should be on the library');
    expect(await allClosed(), 'Back while running: an audio context is still open');
    expect(await tracksEnded(), 'Back while running: microphone left on');
  });

  // B2: Stop before one full round: back to idle, no report.
  await check('stop before a round', async () => {
    const before = await hist();
    await page.click('#goBtn');
    await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
    await sleep(1200);
    await page.click('#goBtn');
    expect((await active()) === 'prac', 'stop before a round: should stay on the practice screen');
    expect((await goLabel()) === 'Start', 'stop before a round: button should read Start');
    expect((await hist()) === before, 'stop before a round: history changed');
    expect(await allClosed(), 'stop before a round: audio left open');
  });

  // B2: Stop after more than one round: a "Stopped after round N" report, nothing saved.
  await check('stop after a round', async () => {
    const before = await hist();
    await page.click('#goBtn');
    await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
    await sleep(4000);
    await page.click('#goBtn');
    expect((await active()) === 'rep', 'stop after a round: report not shown');
    const title = await page.evaluate(() => document.getElementById('repTitle').textContent);
    expect(/^Quick rounds · Stopped after round 1$/.test(title), `stop after a round: title was "${title}"`);
    const cheer = await page.evaluate(() => document.getElementById('cheer').textContent);
    expect(cheer === 'Partial run. Not saved to your journey.', `stop after a round: cheer was "${cheer}"`);
    const cells = await page.evaluate(() => document.querySelectorAll('#notesOut .cell').length);
    expect(cells >= 3 && cells < 9, `stop after a round: expected only finished notes, saw ${cells} cells`);
    expect((await hist()) === before, 'stop after a round: history was changed');
    expect(await page.evaluate(() => localStorage.getItem('vp_vlag') !== null), 'stop after a round: voice lag not saved');
    expect(await allClosed(), 'stop after a round: audio left open');
    // Go again still works.
    await page.click('#againBtn');
    expect((await active()) === 'prac', 'Go again: should open practice');
    expect((await goLabel()) === 'Start', 'Go again: button should read Start');
    await page.click('#goBtn');
    await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
    await page.click('#goBtn');
  });

  // B3: the page being hidden mid-run ends the session through the same path.
  await check('hidden after a round', async () => {
    const before = await hist();
    await page.click('#goBtn');
    await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
    await sleep(4000);
    await setVisibility('hidden');
    await sleep(200);
    expect((await active()) === 'rep', 'hidden after a round: report not shown');
    const title = await page.evaluate(() => document.getElementById('repTitle').textContent);
    expect(/Stopped after round 1$/.test(title), `hidden after a round: title was "${title}"`);
    expect((await hist()) === before, 'hidden after a round: history was changed');
    expect(await allClosed(), 'hidden after a round: audio left open');
    await setVisibility('visible');
    await sleep(300);
    expect((await active()) === 'rep', 'hidden after a round: coming back changed the screen');
    expect((await page.evaluate(() => document.getElementById('repTitle').textContent)) === title, 'hidden after a round: report changed on return');
  });

  await check('hidden before a round', async () => {
    await page.click('#goBtn');
    await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
    await sleep(800);
    await setVisibility('hidden');
    await sleep(200);
    await setVisibility('visible');
    expect((await active()) === 'prac', 'hidden before a round: should be on practice, no report');
    expect((await goLabel()) === 'Start', 'hidden before a round: button should read Start');
    expect(await allClosed(), 'hidden before a round: audio left open');
  });

  await check('hidden while starting', async () => {
    await gum({ delay: 600 });
    await page.click('#goBtn');
    await setVisibility('hidden');
    await sleep(1000);
    await setVisibility('visible');
    expect((await active()) === 'prac', 'hidden while starting: should stay on practice');
    expect((await goLabel()) === 'Start', 'hidden while starting: button should read Start');
    expect(await allClosed(), 'hidden while starting: audio left open');
    expect(await tracksEnded(), 'hidden while starting: microphone left on');
    expect((await rec(() => window.__rec.osc)) === 0, 'hidden while starting: piano notes scheduled');
  });

  // B4: the wake lock is requested for a run (when this Chrome supports it); never an error.
  await check('wake lock', async () => {
    await page.click('#goBtn');
    await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
    const supported = await page.evaluate(() => 'wakeLock' in navigator);
    if (supported) expect((await rec(() => window.__rec.wakeLocks)) >= 1, 'wake lock: never requested');
    await page.click('#goBtn');
  });

  // B10: mic failures show a card above Start, with wording for each cause.
  const micCase = async (label, setup, pattern) => check(label, async () => {
    await setup();
    await page.click('#goBtn');
    await page.waitForSelector('#micCard:not([hidden])', { timeout: 3000 });
    const message = await page.evaluate(() => document.getElementById('micCardMsg').textContent);
    expect(pattern.test(message), `${label}: message was "${message}"`);
    expect(await page.evaluate(() => !!(document.getElementById('micCard').compareDocumentPosition(document.getElementById('goBtn')) & Node.DOCUMENT_POSITION_FOLLOWING)), `${label}: card is not above the Start button`);
    expect(await page.evaluate(() => /Try again/.test(document.getElementById('micRetry').textContent)), `${label}: no Try again button`);
    expect((await goLabel()) === 'Start' && !(await page.evaluate(() => document.getElementById('goBtn').disabled)), `${label}: Start should be usable again`);
    expect(await allClosed(), `${label}: the AudioContext was left open`);
    expect((await active()) === 'prac', `${label}: left the practice screen`);
    return message;
  });
  await micCase('mic denied', () => gum({ mode: 'reject', name: 'NotAllowedError' }), /Microphone access is off for this site\. Tap the lock icon/);
  await micCase('mic security error', () => gum({ mode: 'reject', name: 'SecurityError' }), /lock icon/);
  await micCase('no mic', () => gum({ mode: 'reject', name: 'NotFoundError' }), /couldn't find a microphone/);
  await micCase('overconstrained', () => gum({ mode: 'reject', name: 'OverconstrainedError' }), /couldn't find a microphone/);
  await micCase('other mic error', () => gum({ mode: 'reject', name: 'NotReadableError' }), /couldn't start the microphone/);
  await micCase('no mediaDevices', () => page.evaluate(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })), /https:\/\//);

  // B10: Try again works once the mic is allowed, and the card goes away; leaving the screen hides it too.
  await check('try again', async () => {
    await gum({ mode: 'reject', name: 'NotAllowedError' });
    await page.click('#goBtn');
    await page.waitForSelector('#micCard:not([hidden])');
    await gum({ mode: 'ok' });
    await page.click('#micRetry');
    await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
    expect(await page.evaluate(() => document.getElementById('micCard').hidden), 'try again: card should hide once a session starts');
    await page.click('#goBtn');
    await page.click('#backBtn');
  });
  await check('card hidden on leaving', async () => {
    await gum({ mode: 'reject', name: 'NotAllowedError' });
    await page.click('#goBtn');
    await page.waitForSelector('#micCard:not([hidden])');
    await page.click('#backBtn');
    expect(await page.evaluate(() => document.getElementById('micCard').hidden), 'card hidden on leaving: still visible after Back');
  });

  // B11: "Reset to automatic" clears the saved picture delay.
  await check('reset picture delay', async () => {
    await page.click('#prac summary');
    await page.evaluate(() => {
      const slider = document.getElementById('sync');
      slider.value = '230';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect((await page.evaluate(() => localStorage.getItem('vp_lat'))) === '0.23', 'reset: slider did not save vp_lat');
    expect((await page.evaluate(() => document.getElementById('syncV').textContent)) === '230 ms', 'reset: label should show 230 ms');
    await page.click('#syncReset');
    expect((await page.evaluate(() => localStorage.getItem('vp_lat'))) === null, 'reset: vp_lat not cleared');
    expect((await page.evaluate(() => document.getElementById('syncV').textContent)) === 'auto', 'reset: label should read auto');
    // The next Start estimates it again, and does not save the estimate.
    await page.click('#goBtn');
    await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
    expect((await page.evaluate(() => /\d+ ms/.test(document.getElementById('syncV').textContent))), 'reset: Start should estimate the delay');
    expect((await page.evaluate(() => localStorage.getItem('vp_lat'))) === null, 'reset: the estimate should not be saved');
    await page.click('#goBtn');
  });

  await browser.close();
  return { errors: [...errors, ...problems.map((p) => `session check failed: ${p}`)], problems };
}

module.exports = { runSessionChecks };

if (require.main === module) {
  const { serve } = require('./serve.cjs');
  (async () => {
    const server = await serve(path.resolve(__dirname, '../..'));
    const { errors } = await runSessionChecks(server.url);
    server.stop();
    console.log(JSON.stringify({ errors }, null, 2));
    process.exit(errors.length ? 1 : 0);
  })();
}
