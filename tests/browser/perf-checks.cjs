// Browser performance check for long exercises (PR 5: B12). Takes about two minutes: it really plays a 24-round
// arpeggio (1-3-5-8-5-3-1~ at 200 bpm, C3 up to B4) to its end with a steady fake microphone tone.
//   node tests/browser/perf-checks.cjs
// Measures: oscillators created in total vs alive at once (they are counted from start() to their "ended" event),
// how many pitch analyses ran per second, long main-thread tasks (the report being worked out), and how long after
// the last round the report opened.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openApp, sleep } = require('./scenario.cjs');
const { INSTRUMENT } = require('./session-checks.cjs');

const EXTRA = `
(() => {
  const rec = window.__rec;
  rec.alive = 0;
  rec.maxAlive = 0;
  rec.firstStart = null;
  const realStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when, ...rest) {
    if (rec.firstStart == null) rec.firstStart = when;
    rec.alive++;
    rec.maxAlive = Math.max(rec.maxAlive, rec.alive);
    this.addEventListener('ended', () => { rec.alive--; });
    return realStart.call(this, when, ...rest);
  };
  rec.analyses = 0;
  const realCapture = AnalyserNode.prototype.getFloatTimeDomainData;
  AnalyserNode.prototype.getFloatTimeDomainData = function (...args) { rec.analyses++; return realCapture.apply(this, args); };
  rec.frames = 0;
  const realRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => realRaf((t) => { rec.frames++; fn(t); });
  rec.longTasks = [];
  new PerformanceObserver((list) => list.getEntries().forEach((e) => rec.longTasks.push({ start: e.startTime, duration: e.duration }))).observe({ entryTypes: ['longtask'] });
  rec.tCross = null;
  rec.tReport = null;
  rec.endAudio = Infinity;
  setInterval(() => {
    const c = rec.ctxs[rec.ctxs.length - 1];
    if (rec.tCross == null && c && c.currentTime >= rec.endAudio) rec.tCross = performance.now();
  }, 4);
  addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => {
      if (document.getElementById('rep').classList.contains('on') && rec.tReport == null) rec.tReport = performance.now();
    }).observe(document.getElementById('rep'), { attributes: true });
  });
})();`;

const ARPEGGIO = { id: 'xa', name: '24-round arpeggio', pat: '1-3-5-8-5-3-1~', vows: ['ah'], rootVow: '', start: 48, end: 71, top: false, both: false, step: 1, bpm: 200, hold: 2 };

async function runPerfChecks(baseUrl) {
  const { browser, page, errors } = await openApp(baseUrl, { initScript: INSTRUMENT + EXTRA, steadyTone: true });
  const problems = [];
  const expect = (condition, message) => { if (!condition) problems.push(message); };
  const { buildSession, normEx } = await import(pathToFileURL(path.resolve(__dirname, '../../js/exercise.js')).href);
  const reference = buildSession(normEx(ARPEGGIO), 0);
  const numbers = {};
  await page.evaluate((ex) => { localStorage.setItem('vp_ex', JSON.stringify([ex])); localStorage.removeItem('vp_hist'); }, ARPEGGIO);
  await page.reload();
  await page.waitForSelector('#list');
  await page.click('#list button[data-a=p][data-i="0"]');
  await page.click('#goBtn');
  await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
  await sleep(1500);
  // Everything is laid out from the first chord's time; the run is over END_PAD after the last round.
  await page.evaluate((length) => { window.__rec.endAudio = window.__rec.firstStart + length; }, reference.end);
  numbers.rounds = 24;
  numbers.notesPerRound = reference.plays.length / 24;
  numbers.oscillatorsThatWouldHaveBeenScheduledAtStartBeforeB12 = reference.plays.reduce((sum, play) => sum + play.m.length * 6, 0);
  // Analysis rate over 10 s in the middle of the run.
  await sleep(20000);
  const a0 = await page.evaluate(() => ({ n: window.__rec.analyses, f: window.__rec.frames, t: performance.now() }));
  await sleep(10000);
  const a1 = await page.evaluate(() => ({ n: window.__rec.analyses, f: window.__rec.frames, t: performance.now(), alive: window.__rec.alive }));
  numbers.analysesPerSecond = +(((a1.n - a0.n) / (a1.t - a0.t)) * 1000).toFixed(1);
  numbers.drawsPerSecond = +(((a1.f - a0.f) / (a1.t - a0.t)) * 1000).toFixed(1);
  numbers.aliveMidRun = a1.alive;
  await page.waitForSelector('section#rep.on', { timeout: 150000 });
  await sleep(300);
  const result = await page.evaluate(() => {
    const rec = window.__rec;
    return {
      created: rec.osc,
      maxAlive: rec.maxAlive,
      reportAfterEndMs: rec.tReport - rec.tCross,
      longestLongTaskMs: Math.max(0, ...rec.longTasks.filter((t) => t.start > rec.tCross - 2000).map((t) => t.duration)),
      longTasksOver100ms: rec.longTasks.filter((t) => t.duration > 100).length,
      strips: document.querySelectorAll('#notesOut .strip').length,
      title: document.getElementById('repTitle').textContent,
    };
  });
  Object.assign(numbers, result);
  numbers.maxNotesAlive = +(result.maxAlive / 6).toFixed(1);
  expect(result.created === numbers.oscillatorsThatWouldHaveBeenScheduledAtStartBeforeB12, `every note should be played once: created ${result.created}`);
  expect(result.maxAlive <= 72, `too many oscillators alive at once: ${result.maxAlive} (limit 72 = 12 notes)`);
  expect(numbers.analysesPerSecond > 40 && numbers.analysesPerSecond < 60, `analysis rate ${numbers.analysesPerSecond}/s, expected about 50`);
  expect(result.reportAfterEndMs < 500, `the report opened ${Math.round(result.reportAfterEndMs)} ms after the end, expected under 500`);
  expect(result.strips === 24 && !/Stopped/.test(result.title), `report: ${result.strips} strips, title "${result.title}"`);
  await browser.close();
  return { errors: [...errors, ...problems.map((p) => `perf check failed: ${p}`)], numbers };
}

module.exports = { runPerfChecks };

if (require.main === module) {
  const { serve } = require('./serve.cjs');
  (async () => {
    const server = await serve(path.resolve(__dirname, '../..'));
    const { errors, numbers } = await runPerfChecks(server.url);
    server.stop();
    console.log(JSON.stringify({ numbers, errors }, null, 2));
    process.exit(errors.length ? 1 : 0);
  })();
}
