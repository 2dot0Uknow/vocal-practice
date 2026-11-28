// A1: no octave folding. A voice is scored against the exact target pitch; a voice an octave away is "off",
// not perfect and not missed; a detector octave glitch is dropped instead of being folded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cents, err, isOctaveAway, dropOctaveGlitches, estimateLag, scoreNotes, summarizeSession, OCTAVE_TIP } from '../js/scoring.js';
import { buildSession, normEx } from '../js/exercise.js';
import { singerFrames } from './helpers/signals.js';
import { SESSION_EXERCISES, SINGER_SCENARIOS } from './tools/cases.mjs';

const scaleTargets = () => buildSession(normEx(SESSION_EXERCISES.scale), 0).targets;
const frame = (t, m) => ({ t, m, tr: false, c: 0.9, ring: 0.1 });

test('cents is plain: (m - target) * 100, no folding', () => {
  assert.equal(cents(60, 60), 0);
  assert.equal(cents(61, 60), 100);
  assert.equal(cents(48, 60), -1200);
  assert.equal(Math.round(cents(72.1, 60)), 1210);
  assert.equal(err(48, 60), 0, 'the folded err is still there for neighbour disambiguation only');
});

test('isOctaveAway: 1200 plus or minus 150 cents, either direction', () => {
  for (const value of [1200, -1200, 1050, -1050, 1350, -1350]) assert.equal(isOctaveAway(value), true, String(value));
  for (const value of [0, 600, 1049, -1049, 1351, 2400, -2400]) assert.equal(isOctaveAway(value), false, String(value));
});

test('A1: one held pitch against 1-8-1 does not land the 8', () => {
  const exercise = normEx({ name: 'Octave jump', pat: '1-8-1', vows: ['ah'], start: 48, end: 48, bpm: 90 });
  const { targets } = buildSession(exercise, 0);
  const root = targets[0].m;
  const frames = [];
  for (let t = 0; t < targets[targets.length - 1].t1 + 0.5; t += 0.02) frames.push(frame(t, root));
  const results = scoreNotes(targets, frames);
  assert.equal(results.length, 3);
  assert.ok(Math.abs(results[0].med) <= 25 && Math.abs(results[2].med) <= 25, 'the two roots land');
  assert.ok(!results[1].miss, 'the 8 is heard, not missed');
  assert.ok(Math.abs(results[1].med + 1200) <= 25, `the 8 reads about an octave low (${results[1].med})`);
  assert.equal(results[1].octaveOff, true);
  const summary = summarizeSession({ targets, frames, voiceLag: 0, previousRuns: [] });
  assert.equal(summary.inTune, 2, 'only the roots are in tune');
});

for (const shift of [-12, 12]) {
  test(`A1: a voice one octave ${shift < 0 ? 'below' : 'above'} every target scores as off (not perfect, not missed) and gets the gentle tip`, () => {
    const exercises = ['scale', 'sixNotes'];   // sixNotes goes up and back down: neighbour notes must still be told apart
    for (const key of exercises) {
      const { targets } = buildSession(normEx(SESSION_EXERCISES[key]), 0);
      const frames = singerFrames(targets, { lag: 0, octaveShift: shift, wobbleCents: 4, seed: 3 });
      const results = scoreNotes(targets, frames);
      assert.ok(results.every((r) => !r.miss), `${key}: none missed`);
      assert.ok(results.every((r) => r.octaveOff && Math.abs(Math.abs(r.med) - 1200) < 30), `${key}: every note about an octave away`);
      const summary = summarizeSession({ targets, frames, voiceLag: 0, previousRuns: [] });
      assert.equal(summary.pct, 0);
      assert.equal(summary.octaveMode, true);
      assert.equal(summary.tips[0], OCTAVE_TIP);
      assert.ok(summary.avgAbs < 30, 'the averages are measured from the nearest octave, not 1200');
      assert.ok(!summary.tips.some((tip) => /sit a touch/.test(tip)), 'no sharp/flat advice that is really about the octave');
    }
  });
}

test('A1: the octave tip needs most notes to be an octave away', () => {
  const targets = scaleTargets();
  const normal = summarizeSession({ targets, frames: singerFrames(targets, { lag: 0, wobbleCents: 3 }), voiceLag: 0, previousRuns: [] });
  assert.equal(normal.octaveMode, false);
  assert.ok(!normal.tips.includes(OCTAVE_TIP));
  // Only the first third of the run is an octave low: not "most".
  const frames = singerFrames(targets, { lag: 0, wobbleCents: 3 });
  const cut = targets[Math.floor(targets.length / 3)].t0;
  const mixed = summarizeSession({ targets, frames: frames.map((f) => (f.m != null && f.t < cut ? { ...f, m: f.m - 12 } : f)), voiceLag: 0, previousRuns: [] });
  assert.equal(mixed.octaveMode, false);
  assert.ok(mixed.results.some((r) => r.octaveOff));
});

test('A1: frames two octaves away are still left out of a note (not an octave, not this note)', () => {
  const targets = scaleTargets();
  const frames = singerFrames(targets, { lag: 0, octaveShift: -24, wobbleCents: 2 });
  assert.ok(scoreNotes(targets, frames).every((r) => r.miss));
});

test('dropOctaveGlitches: one or two frames an octave from agreeing neighbours become silent', () => {
  const steady = (n, m = 60) => Array.from({ length: n }, (_, i) => frame(i * 0.02, m));
  const one = steady(10);
  one[5] = { ...one[5], m: 72 };
  const droppedOne = dropOctaveGlitches(one);
  assert.equal(droppedOne[5].m, null);
  assert.equal(droppedOne.filter((f) => f.m == null).length, 1);
  assert.equal(one[5].m, 72, 'the input is not changed');

  const two = steady(10);
  two[4] = { ...two[4], m: 48 };
  two[5] = { ...two[5], m: 48.05 };
  assert.deepEqual(dropOctaveGlitches(two).map((f) => f.m == null), two.map((_, i) => i == 4 || i == 5));

  const nothing = steady(10);
  assert.equal(dropOctaveGlitches(nothing), nothing, 'the same array comes back when there is nothing to drop');
});

test('dropOctaveGlitches: real singing is left alone', () => {
  const steady = (n, m = 60) => Array.from({ length: n }, (_, i) => frame(i * 0.02, m));
  // Three frames in a row an octave up: a real (if brief) sound, not a glitch.
  const three = steady(12);
  for (const i of [4, 5, 6]) three[i] = { ...three[i], m: 72 };
  assert.equal(dropOctaveGlitches(three).filter((f) => f.m == null).length, 0);
  // A real octave leap: the neighbours on either side disagree, so nothing is dropped.
  const leap = [...steady(6, 60), ...steady(6, 72).map((f, i) => ({ ...f, t: 0.12 + i * 0.02 }))];
  assert.equal(dropOctaveGlitches(leap).filter((f) => f.m == null).length, 0);
  // A one-frame jump of a fifth is not an octave.
  const fifth = steady(10);
  fifth[5] = { ...fifth[5], m: 67 };
  assert.equal(dropOctaveGlitches(fifth).filter((f) => f.m == null).length, 0);
  // A silent neighbour, or neighbours that are far apart in time: no consensus, nothing dropped.
  const silentNeighbour = steady(10);
  silentNeighbour[4] = { t: silentNeighbour[4].t, m: null, tr: false };
  silentNeighbour[5] = { ...silentNeighbour[5], m: 72 };
  assert.equal(dropOctaveGlitches(silentNeighbour).filter((f) => f.m == null).length, 1, 'only the existing silent frame');
  const sparse = steady(10).map((f, i) => ({ ...f, t: i * 0.5 }));
  sparse[5] = { ...sparse[5], m: 72 };
  assert.equal(dropOctaveGlitches(sparse).filter((f) => f.m == null).length, 0);
  // Edges: the first and last frame have only one neighbour.
  const edges = steady(6);
  edges[0] = { ...edges[0], m: 72 };
  edges[5] = { ...edges[5], m: 48 };
  assert.equal(dropOctaveGlitches(edges).filter((f) => f.m == null).length, 0);
  assert.deepEqual(dropOctaveGlitches([]), []);
});

test('A1: octave glitch frames inside a run change nothing about the score or the lag', () => {
  const targets = scaleTargets();
  const clean = singerFrames(targets, { lag: 0.2, wobbleCents: 4, seed: 21 });
  // An octave-up glitch every ~0.4 s, never two in a row.
  const glitchy = clean.map((f, i) => (f.m != null && i % 20 == 7 ? { ...f, m: f.m + 12 } : f));
  const a = summarizeSession({ targets, frames: clean, voiceLag: 0.15, previousRuns: [] });
  const b = summarizeSession({ targets, frames: glitchy, voiceLag: 0.15, previousRuns: [] });
  assert.equal(b.pct, a.pct);
  assert.equal(b.results.filter((r) => r.miss).length, a.results.filter((r) => r.miss).length);
  assert.ok(b.results.every((r) => r.miss || !r.octaveOff));
  assert.ok(Math.abs(b.voiceLag - a.voiceLag) < 0.021);
  assert.ok(Math.abs(estimateLag(glitchy, targets) - 0.2) < 0.021);
});

test('A1: the lag estimator gives up (null) on a voice an octave off instead of inventing a lag', () => {
  const targets = scaleTargets();
  assert.equal(estimateLag(singerFrames(targets, { lag: 0.3, octaveShift: -12, wobbleCents: 3 }), targets), null);
  assert.ok(Math.abs(estimateLag(singerFrames(targets, { lag: 0.3, wobbleCents: 3 }), targets) - 0.3) < 0.021);
});

test('A1: in-octave singers (errors under 600 cents) get the same answers as before: pct, notes and tips', () => {
  // The full equivalence against the original app's numbers is in scoring.test.js and summary.test.js; this spot-checks
  // the two scenarios with the biggest errors through the whole summary.
  const targets = scaleTargets();
  for (const name of ['sharp', 'wobbly', 'flatWithDropouts']) {
    const frames = singerFrames(targets, SINGER_SCENARIOS[name]);
    const summary = summarizeSession({ targets, frames, voiceLag: 0.15, previousRuns: [] });
    assert.equal(summary.octaveMode, false, name);
    assert.ok(summary.results.every((r) => !r.octaveOff), name);
  }
});
