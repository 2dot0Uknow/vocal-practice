// Browser checks for Pause / Again / Skip and the look-ahead scheduler (PR 5: B12, F1). Real headless Chrome, fake mic.
// The page is instrumented before it loads (see INSTRUMENT in session-checks.cjs) and, on top of that, every oscillator
// start is logged: window.__rec.starts = [{when, freq, endedAt}] so the checks can see which piano notes were scheduled
// for when, and which were cancelled before they sounded (endedAt before when).
const path = require('node:path');
const { openApp, sleep } = require('./scenario.cjs');
const { INSTRUMENT } = require('./session-checks.cjs');

const EXTRA = `
(() => {
  const rec = window.__rec;
  rec.starts = [];
  rec.alive = 0;
  rec.maxAlive = 0;
  const realStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when, ...rest) {
    const entry = { when, freq: this.frequency.value, endedAt: null };
    rec.starts.push(entry);
    rec.alive++;
    rec.maxAlive = Math.max(rec.maxAlive, rec.alive);
    this.addEventListener('ended', () => { rec.alive--; entry.endedAt = this.context.currentTime; });
    return realStart.call(this, when, ...rest);
  };
})();`;

// Four rounds (C3, C#3, D3, D#3) of 1-3-5 at 200 bpm: a round is 2.8 s (cue chord at its start, notes from +1.6 s).
// The first chord sounds 0.6 s after Start, so rounds begin at 0.6, 3.4, 6.2, 9.0 on the audio clock; the run ends at 12.1.
const FLOW = { id: 'xf', name: 'Flow rounds', pat: '1-3-5', vows: ['ah'], rootVow: '', start: 48, end: 51, top: false, both: false, step: 1, bpm: 200, hold: 2 };
const ONE_ROUND = { ...FLOW, id: 'x1', name: 'One round', end: 48 };
const ROUND_STARTS = [0.6, 3.4, 6.2, 9.0];
const ROOTS = [48, 49, 50, 51];

async function runFlowChecks(baseUrl) {
  const { browser, page, errors } = await openApp(baseUrl, { initScript: INSTRUMENT + EXTRA, steadyTone: true });
  const problems = [];
  const expect = (condition, message) => { if (!condition) problems.push(message); };
  const active = () => page.evaluate(() => [...document.querySelectorAll('section.on')].map((s) => s.id).join(','));
  const text = (id) => page.evaluate((i) => document.getElementById(i).textContent, id);
  const visible = (id) => page.evaluate((i) => !document.getElementById(i).hidden, id);
  const disabled = (id) => page.evaluate((i) => document.getElementById(i).disabled, id);
  const clock = () => page.evaluate(() => { const c = window.__rec.ctxs[window.__rec.ctxs.length - 1]; return c ? c.currentTime : 0; });
  const waitClock = (seconds) => page.waitForFunction((t) => { const c = window.__rec.ctxs[window.__rec.ctxs.length - 1]; return c && c.currentTime >= t; }, seconds, { timeout: 30000, polling: 20 });
  const oscillators = () => page.evaluate(() => window.__rec.osc);
  // Cue chords seen so far: the starts that come in groups of 18 oscillators (3 notes x 6 harmonics) at one time.
  const chords = () => page.evaluate(() => {
    const groups = new Map();
    window.__rec.starts.forEach((entry) => {
      const key = entry.when.toFixed(4);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    return [...groups.values()].filter((group) => group.length === 18).sort((a, b) => a[0].when - b[0].when).map((group) => ({
      when: group[0].when,
      root: Math.round(69 + 12 * Math.log2(Math.min(...group.map((e) => e.freq)) / 440)),
      cancelled: group.every((e) => e.endedAt != null && e.endedAt < e.when),
    }));
  });
  const stripLabels = () => page.evaluate(() => [...document.querySelectorAll('#notesOut .rl')].map((n) => n.textContent));
  const cellCount = () => page.evaluate(() => document.querySelectorAll('#notesOut .cell').length);
  const hist = () => page.evaluate(() => JSON.parse(localStorage.getItem('vp_hist') || '[]'));
  const fresh = async (exercise = FLOW) => {
    await page.evaluate((ex) => {
      localStorage.setItem('vp_ex', JSON.stringify([ex]));
      localStorage.removeItem('vp_hist');
      localStorage.removeItem('vp_lat');
    }, exercise);
    await page.reload();
    await page.waitForSelector('#list');
    await page.click('#list button[data-a=p][data-i="0"]');
    expect((await active()) === 'prac', 'practice screen did not open');
  };
  const start = async () => {
    await page.click('#goBtn');
    await page.waitForFunction(() => document.getElementById('goBtn').textContent === 'Stop');
  };
  const check = async (name, body, exercise) => {
    try {
      await fresh(exercise);
      await body();
    } catch (error) {
      problems.push(`${name}: threw ${error.message}`);
    }
  };
  const waitReport = () => page.waitForSelector('section#rep.on', { timeout: 30000 });

  // The three buttons exist only while running; Pause / Again / Skip are secondary and sit in the button row.
  await check('buttons only while running', async () => {
    for (const id of ['pauseBtn', 'repeatBtn', 'skipBtn']) expect(!(await visible(id)), `${id} visible before Start`);
    await start();
    for (const id of ['pauseBtn', 'repeatBtn', 'skipBtn']) expect(await visible(id), `${id} not visible while running`);
    expect((await text('pauseBtn')) === 'Pause' && (await text('repeatBtn')) === 'Again' && (await text('skipBtn')) === 'Skip', 'button words should be Pause, Again, Skip');
    expect(await page.evaluate(() => ['pauseBtn', 'repeatBtn', 'skipBtn'].every((id) => !document.getElementById(id).classList.contains('pri') && document.getElementById(id).parentElement === document.getElementById('goBtn').parentElement)), 'Pause / Again / Skip should be secondary buttons in the same row as Start');
    await page.click('#goBtn');
    for (const id of ['pauseBtn', 'repeatBtn', 'skipBtn']) expect(!(await visible(id)), `${id} still visible after Stop`);
  });

  // Pause holds at the round boundary: no piano while paused; Resume starts the next round with its cue chord ~0.6 s later.
  await check('pause and resume', async () => {
    await start();
    await waitClock(2.0);    // round 2's chord (3.4) is already handed to the audio layer (2.0 + 2 > 3.4)
    await page.click('#pauseBtn');
    expect((await text('pauseBtn')) === 'Pausing…', `pause: button said "${await text('pauseBtn')}" while waiting`);
    expect((await text('pauseNote')) === 'Pausing after this round…' && (await visible('pauseNote')), 'pause: waiting message missing');
    await page.waitForFunction(() => document.getElementById('pauseBtn').textContent === 'Resume', null, { timeout: 8000 });
    const heldAt = await clock();
    expect(heldAt >= 3.3 && heldAt < 4.5, `pause: held at ${heldAt}, expected at the end of round 1 (3.4)`);
    expect(/^Paused/.test(await text('pauseNote')), 'pause: paused message missing');
    expect((await disabled('repeatBtn')) && (await disabled('skipBtn')), 'pause: Again and Skip should be off while paused');
    const before = await oscillators();
    const chordsAfterPause = await chords();
    await sleep(2500);   // would be round 2's cue chord and notes
    expect((await oscillators()) === before, 'pause: piano notes were scheduled while paused');
    expect((await clock()) > heldAt + 2, 'pause: the audio clock should keep running');
    // The round-2 chord that had been handed over early (at 3.4) was cancelled before it sounded.
    const early = chordsAfterPause.find((c) => Math.abs(c.when - ROUND_STARTS[1]) < 0.05);
    expect(early && early.cancelled, 'pause: round 2 chord at 3.4 should have been scheduled early and then cancelled before sounding');
    expect((await active()) === 'prac', 'pause: left the practice screen');
    // Resume.
    const resumeAt = await clock();
    await page.click('#pauseBtn');
    await sleep(1200);
    const after = await chords();
    const resumed = after.find((c) => c.when > resumeAt && !c.cancelled);
    expect(resumed && resumed.root === ROOTS[1], `resume: next chord was ${JSON.stringify(resumed)}, expected root ${ROOTS[1]}`);
    expect(resumed && resumed.when - resumeAt > 0.45 && resumed.when - resumeAt < 1.0, `resume: chord ${resumed && (resumed.when - resumeAt).toFixed(2)} s after the tap, expected about 0.6`);
    expect(resumed && !resumed.cancelled, 'resume: the new chord should sound');
    expect((await text('pauseBtn')) === 'Pause', 'resume: button should say Pause again');
    expect(!(await visible('pauseNote')), 'resume: the paused message should go');
    await waitReport();
    expect((await stripLabels()).join() === 'Round 1,Round 2,Round 3,Round 4', `pause: report rounds ${await stripLabels()}`);
    expect((await cellCount()) === 12, `pause: expected 12 note cells, saw ${await cellCount()}`);
    expect(!/Stopped/.test(await text('repTitle')), 'pause: a run that finished should not say Stopped');
  });

  // Pause can be cancelled by tapping again before it takes effect: the run goes straight on.
  await check('pause cancelled', async () => {
    await start();
    await waitClock(1.2);
    await page.click('#pauseBtn');
    await page.click('#pauseBtn');
    expect((await text('pauseBtn')) === 'Pause', 'pause cancel: button should say Pause again');
    await waitReport();
    expect((await stripLabels()).length === 4, 'pause cancel: all four rounds should be in the report');
  });

  // Stop while paused: the rounds that were finished are reported, nothing is saved.
  await check('stop while paused', async () => {
    await start();
    await waitClock(1.0);
    await page.click('#pauseBtn');
    await page.waitForFunction(() => document.getElementById('pauseBtn').textContent === 'Resume', null, { timeout: 8000 });
    await sleep(800);
    await page.click('#goBtn');
    expect((await active()) === 'rep', 'stop while paused: report not shown');
    expect(/Stopped after round 1$/.test(await text('repTitle')), `stop while paused: title "${await text('repTitle')}"`);
    expect((await hist()).length === 0, 'stop while paused: history changed');
    expect(await page.evaluate(() => window.__rec.ctxs.every((c) => c.state === 'closed')), 'stop while paused: audio left open');
  });

  // Again: replays the current round from its cue chord, immediately; the report counts each round once.
  await check('again', async () => {
    await start();
    await waitClock(4.4);   // round 2 started at 3.4
    const tap = await clock();
    await page.click('#repeatBtn');
    await sleep(900);
    const list = await chords();
    const replay = list.find((c) => c.when > tap && !c.cancelled);
    expect(replay && replay.root === ROOTS[1], `again: next chord ${JSON.stringify(replay)}, expected the round 2 chord (root ${ROOTS[1]})`);
    expect(replay && replay.when - tap < 0.5, `again: chord ${replay && (replay.when - tap).toFixed(2)} s after the tap, expected right away`);
    expect(replay && !replay.cancelled, 'again: the new chord should sound');
    // What was still to come of the first attempt of round 2 was cancelled (its notes at 5.0 s and later never sound).
    const unplayed = await page.evaluate((from) => window.__rec.starts.filter((e) => e.when > from + 0.3 && e.when < from + 0.6 + 1.2 && e.endedAt != null && e.endedAt < e.when).length, tap);
    expect(unplayed > 0, 'again: nothing of the abandoned attempt was cancelled');
    await waitReport();
    const labels = await stripLabels();
    expect(labels.join() === 'Round 1,Round 2,Round 3,Round 4', `again: report rounds ${labels}, each round should count once`);
    expect((await cellCount()) === 12, `again: expected 12 note cells, saw ${await cellCount()}`);
    expect(!/Stopped/.test(await text('repTitle')), 'again: a finished run should not say Stopped');
    expect((await hist()).length === 1 && (await hist())[0].rounds === 4 && (await hist())[0].notes === 12, `again: saved entry ${JSON.stringify(await hist())}`);
  });

  // Skip: the next round's cue chord right away; the skipped round is not in the report.
  await check('skip', async () => {
    await start();
    await waitClock(4.4);   // inside round 2
    const tap = await clock();
    await page.click('#skipBtn');
    await sleep(900);
    const replay = (await chords()).find((c) => c.when > tap && !c.cancelled);
    expect(replay && replay.root === ROOTS[2], `skip: next chord ${JSON.stringify(replay)}, expected the round 3 chord (root ${ROOTS[2]})`);
    expect(replay && replay.when - tap < 0.5, 'skip: the next chord should come right away');
    await waitReport();
    const labels = await stripLabels();
    expect(labels.join() === 'Round 1,Round 3,Round 4', `skip: report rounds ${labels}, round 2 should be absent`);
    expect((await cellCount()) === 9, `skip: expected 9 note cells (no misses for the skipped round), saw ${await cellCount()}`);
    expect(!/Stopped/.test(await text('repTitle')), 'skip: a finished run should not say Stopped');
    expect((await hist()).length === 1 && (await hist())[0].rounds === 3 && (await hist())[0].notes === 9, `skip: saved entry ${JSON.stringify(await hist())}`);
  });

  // Skipping the last round ends the run as finished, with the rounds that were sung.
  await check('skip the last round', async () => {
    await start();
    await waitClock(9.6);   // inside round 4 (starts 9.0)
    const tap = await clock();
    await page.click('#skipBtn');
    await waitReport();
    expect((await clock()) - tap < 2, 'skip last: the report should open at once');
    expect((await stripLabels()).join() === 'Round 1,Round 2,Round 3', `skip last: report rounds ${await stripLabels()}`);
    expect(!/Stopped/.test(await text('repTitle')), 'skip last: should be a finished run');
    expect((await hist()).length === 1, 'skip last: a finished run should be saved');
    expect(await page.evaluate(() => window.__rec.ctxs.every((c) => c.state === 'closed')), 'skip last: audio left open');
  });

  // Skipping the only round, with nothing sung, is just a stop: no report, back to Start.
  await check('skip with nothing sung', async () => {
    await start();
    await waitClock(1.5);
    await page.click('#skipBtn');
    await sleep(500);
    expect((await active()) === 'prac', 'skip nothing: should stay on the practice screen');
    expect((await text('goBtn')) === 'Start', 'skip nothing: button should read Start');
    expect((await hist()).length === 0, 'skip nothing: history changed');
    expect(!(await visible('pauseBtn')), 'skip nothing: Pause should be hidden again');
  }, ONE_ROUND);

  await browser.close();
  return { errors: [...errors, ...problems.map((p) => `flow check failed: ${p}`)], problems };
}

module.exports = { runFlowChecks };

if (require.main === module) {
  const { serve } = require('./serve.cjs');
  (async () => {
    const server = await serve(path.resolve(__dirname, '../..'));
    const { errors } = await runFlowChecks(server.url);
    server.stop();
    console.log(JSON.stringify({ errors }, null, 2));
    process.exit(errors.length ? 1 : 0);
  })();
}
