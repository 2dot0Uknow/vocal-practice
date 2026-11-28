// Browser checks for PR 6 (A1 octave, A2 piano leak notice, A3 narrow-band tone rows, A7 ?debug=1 download).
// The fake microphone plays a steady 196 Hz tone = G3 (MIDI 55; scenario.cjs steadyToneFile), so:
//  - an exercise whose only note is G3 is landed;
//  - the same note an octave up (G4) is heard ~1200 cents low: with no octave folding it scores as OFF with the gentle
//    tip (before A1 it scored as perfect, because the error was folded to the nearest octave);
//  - every exercise whose first cue chord contains a G (root C, G or E-flat/...: root + 7 semitones) "leaks" the piano,
//    because the tone sits on a chord note (in any octave, A2): a convenient stand-in for a speaker, and a root of D
//    (chord D F# A) has no G, so no leak.
//  - the fake mic is a pure tone, so it has nothing above 4 kHz: the tone rows are expected to be hidden (A3), and the
//    check only requires the rows' presence to agree with the `narrowBand` the app reports.
const path = require('node:path');
const { openApp } = require('./scenario.cjs');

const exercise = (id, root, name) => ({ id, name, pat: '1~-1~', vows: ['ah'], rootVow: '', start: root, end: root, top: false, both: false, step: 1, bpm: 120, hold: 2 });
const EXERCISES = [
  exercise('g3', 55, 'G3 held'),             // lands; chord G B D contains G: leak
  exercise('g4', 67, 'G4 held'),             // an octave above the tone: off + octave tip; chord G B D: leak
  exercise('d3', 50, 'D3 held'),             // chord D F# A has no G: no leak
];
const seed = `
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('vp_ex', ${JSON.stringify(JSON.stringify(EXERCISES))});
    localStorage.removeItem('vp_hist');
  }`;

async function runScoringChecks(baseUrl) {
  const problems = [];
  const expect = (condition, message) => { if (!condition) problems.push(message); };
  const errors = [];
  const observations = {};
  const debugUrl = baseUrl.replace(/\/?$/, '/') + '?debug=1';

  const runExercise = async (page, index) => {
    await page.evaluate(() => document.querySelector('[data-go=lib]')?.click());
    await page.waitForSelector('#list');
    await page.click(`#list button[data-a=p][data-i="${index}"]`);
    await page.click('#goBtn');
    // The leak notice appears on the practice screen once the first chord is over.
    const sawLeakCard = await page.waitForFunction(() => !document.getElementById('leakCard').hidden || document.querySelector('section.on')?.id === 'rep', null, { timeout: 40000 })
      .then(() => page.evaluate(() => !document.getElementById('leakCard').hidden));
    await page.waitForFunction(() => document.querySelector('section.on')?.id === 'rep', null, { timeout: 40000 });
    return page.evaluate((sawCard) => ({
      sawLeakCard: sawCard,
      sPct: document.getElementById('sPct').textContent,
      sSub: document.getElementById('sSub').textContent,
      tips: document.getElementById('tips').innerText,
      cells: document.getElementById('notesOut').innerText,
      statNames: [...document.querySelectorAll('#stats .stat > span:first-child')].map((s) => s.textContent),
      leakNote: document.getElementById('leakNote').hidden ? '' : document.getElementById('leakNote').textContent,
      debugRowHidden: document.getElementById('debugRow').hidden,
      toneNoteHidden: document.getElementById('toneNote').hidden,
    }), sawLeakCard);
  };

  // ?debug=1 for all three runs; a normal tab is checked afterwards.
  const { browser, page, errors: pageErrors } = await openApp(debugUrl, { initScript: seed, steadyTone: true });
  errors.push(...pageErrors);
  try {
    // 1. Landed note, piano on a chord note: leak.
    const g3 = await runExercise(page, 0);
    observations.g3 = g3;
    expect(g3.sPct === '100%', `G3 held should land (saw ${g3.sPct})`);
    expect(!/octave/i.test(g3.tips + g3.sSub), 'G3 held should not get the octave tip');
    expect(g3.sawLeakCard, 'the practice screen should show the piano-leak notice (the tone is on a chord note)');
    expect(g3.leakNote.includes('a little generous'), `report should say the score may be generous (saw "${g3.leakNote}")`);

    // 2. Debug download: present, and holds the fields a fixture needs.
    expect(!g3.debugRowHidden, 'debug link should be shown with ?debug=1');
    const session = await page.evaluate(async () => JSON.parse(await (await fetch(document.getElementById('debugLink').href)).text()));
    observations.debug = { keys: Object.keys(session), gate: session.gate, narrowBand: session.narrowBand, micSampleRate: session.micSampleRate, outputLatency: session.outputLatency, frames: session.frames.length };
    for (const key of ['exercise', 'targets', 'frames', 'voiceLag', 'outputLatency', 'gate', 'pianoLeak', 'userAgent', 'appVersion']) expect(key in session, `debug JSON lacks ${key}`);
    expect(session.targets.length === 2 && session.frames.length > 50, `debug JSON: ${session.targets.length} targets, ${session.frames.length} frames`);
    expect(session.gate >= 0.004 && session.gate <= 0.012, `gate ${session.gate} outside 0.004 to 0.012`);
    expect(session.pianoLeak === true, 'debug JSON should record the leak');
    expect(session.frames.every((f) => 't' in f && 'm' in f && 'tr' in f), 'frames need t, m, tr');
    // A3: tone rows follow narrowBand (a pure tone has no high band: expected narrow).
    const hasToneRows = g3.statNames.includes('Clear tone');
    expect(hasToneRows === !session.narrowBand, `tone rows (${hasToneRows}) disagree with narrowBand (${session.narrowBand})`);
    expect(g3.toneNoteHidden === session.narrowBand, 'the tone footnote should hide with the tone rows');

    // 3. An octave above the mic's note: off, not perfect, not missed, with the gentle tip.
    const g4 = await runExercise(page, 1);
    observations.g4 = g4;
    expect(g4.sPct === '0%', `G4 held against a G3 voice should score 0% (saw ${g4.sPct})`);
    expect(/octave/i.test(g4.sSub), `subtitle should mention the octave (saw "${g4.sSub}")`);
    expect(g4.tips.includes('singing an octave below the piano'), `octave tip missing (saw "${g4.tips}")`);
    expect(g4.cells.includes('8vb'), `note cell should read 8vb (saw "${g4.cells}")`);
    expect(!g4.cells.includes('—'), 'the note should be heard (off), not missed');
    expect(g4.sawLeakCard && g4.leakNote, 'G4 chord also contains G: leak expected (octave-equivalent match)');

    // 4. No G in the first chord: no leak notice, no generous line.
    // (The fake voice is 500 cents from D3, so this run hears nothing: that is also unchanged by A1.)
    const d3 = await runExercise(page, 2);
    observations.d3 = d3;
    expect(!d3.sawLeakCard, 'no leak notice when the first chord has no G');
    expect(d3.leakNote === '', 'no generous line without a leak');
    const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('vp_hist')));
    // The D3 run is a G3 voice 500 cents from the note: left out as "not this note" (as before A1), so nothing was heard and nothing is saved.
    expect(hist.length === 2 && hist.every((entry) => entry.sound === 'ah'), `two saved runs, each with sound "ah" (saw ${JSON.stringify(hist.map((e) => e.sound))})`);
    // Without ?debug=1 (same browser tab, plain address) there is no download link.
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForSelector('#list');
    const plain = await runExercise(page, 0);
    expect(plain.debugRowHidden, 'no debug link without ?debug=1');
  } catch (error) {
    problems.push(`threw ${error.message}`);
  }
  await browser.close();
  return { errors: [...errors, ...problems.map((p) => `scoring check failed: ${p}`)], problems, observations };
}

module.exports = { runScoringChecks };

if (require.main === module) {
  const { serve } = require('./serve.cjs');
  (async () => {
    const server = await serve(path.resolve(__dirname, '../..'));
    const { errors, observations } = await runScoringChecks(server.url);
    server.stop();
    console.log(JSON.stringify({ observations, errors }, null, 2));
    process.exit(errors.length ? 1 : 0);
  })();
}
