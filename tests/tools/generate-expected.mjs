// Regenerates tests/fixtures/original-behaviour.json by running the cases through the
// ORIGINAL pre-refactor code (git commit 2aaf0bd). Run from the repo root:
//   node tests/tools/generate-expected.mjs
// The fixture only describes the baseline, so there is normally no reason to re-run this.
import { writeFileSync } from 'node:fs';
import { loadOriginal } from './original.mjs';
import * as cases from './cases.mjs';
import { sine, harmonicTone, noisySine, silence, whiteNoise, singerFrames } from '../helpers/signals.js';

const root = new URL('../..', import.meta.url).pathname;
const { api, dom, storage } = loadOriginal(root);
const plain = (value) => JSON.parse(JSON.stringify(value));
const withoutId = ({ id, ...rest }) => rest;

const fixture = {};

fixture.samples = plain(api.getExs());

// parseLine
const lineResult = (line) => {
  const result = api.parseLine(line);
  return result ? withoutId(plain(result)) : null;
};
api.setDefR({ start: 48, end: 55 });
fixture.parseLine = [...cases.PLACEHOLDER_LINES, ...cases.OTHER_LINES].map((line) => ({ line, expected: lineResult(line) }));
api.setDefR({ ...cases.ALT_RANGE });
fixture.parseLineAltRange = cases.ALT_RANGE_LINES.map((line) => ({ line, expected: lineResult(line) }));
api.setDefR({ start: 48, end: 55 });
fixture.parseAll = {
  text: cases.PLACEHOLDER_LINES.join('\n'),
  expected: plain(api.parseAll(cases.PLACEHOLDER_LINES.join('\n'))).map(withoutId),
};

// music helpers
fixture.parsePat = cases.PATTERN_INPUTS.map((input) => ({ input, expected: plain(api.parsePat(input)) }));
fixture.rootsOf = cases.ROOT_EXERCISES.map((exercise) => {
  const notes = api.parsePat(exercise.pat);
  return { exercise, expected: plain(api.rootsOf(exercise, notes)) };
});
fixture.noteNames = Array.from({ length: 128 }, (_, m) => api.nm(m));
fixture.toMidi = ['C4', 'c4', 'Bb2', 'B#3', 'E 5', 'A#0', 'G9', 'H3', '', null, 'C', 'db4', 'F #2'].map((input) => ({ input, expected: api.toMidi(input) }));
fixture.hz = [0, 33, 48, 60, 69, 81, 100].map((midi) => ({ midi, expected: api.hz(midi) }));
fixture.fToM = [65.4, 110, 261.6, 440, 1000].map((freq) => ({ freq, expected: api.fToM(freq) }));

// err
const errInputs = [];
for (const m of [60, 60.2, 59.7, 60.5, 61.9, 72.3, 47.4, 48, 36.01, 83.99]) {
  for (const tm of [60, 48, 55, 72]) errInputs.push([m, tm]);
}
fixture.err = errInputs.map(([m, tm]) => ({ m, tm, expected: api.err(m, tm) }));

// detect
fixture.detect = [];
const addDetect = (label, samples, sampleRate, options) => {
  const result = options ? api.detect(samples, sampleRate, options) : api.detect(samples, sampleRate);
  fixture.detect.push({ label, sampleRate, length: samples.length, options: options || null, expected: plain(result) });
};
for (const sampleRate of cases.TONE_SAMPLE_RATES) {
  for (const frequency of cases.TONE_FREQUENCIES) {
    addDetect(`sine ${frequency}`, sine(frequency, sampleRate, 2048), sampleRate);
    addDetect(`harmonic ${frequency}`, harmonicTone(frequency, sampleRate, 2048), sampleRate);
  }
}
addDetect('harmonic 220 long window', harmonicTone(220, 48000, 4096), 48000);
addDetect('silence', silence(2048), 48000);
addDetect('too quiet sine', sine(220, 48000, 2048, 0.01), 48000);
addDetect('too quiet sine, trill gate', sine(220, 24000, 2048, 0.01), 24000, { gate: 0.004, min: 0.4 });
addDetect('white noise', whiteNoise(2048, 0.2, 5), 48000);
addDetect('noisy sine', noisySine(300, 48000, 2048, 0.3, 0.1, 6), 48000);
addDetect('very noisy sine', noisySine(300, 48000, 2048, 0.2, 0.3, 7), 48000);
addDetect('trill-mode sine', sine(196, 24000, 2048, 0.05), 24000, { gate: 0.004, min: 0.4 });
addDetect('trill-mode harmonic', harmonicTone(330, 24000, 2048, 0.05), 24000, { gate: 0.004, min: 0.4 });
addDetect('below 65 Hz', sine(50, 48000, 2048), 48000);

// build + scoring
fixture.sessions = {};
const sessionScenarios = [];
for (const [key, exercise] of Object.entries(cases.SESSION_EXERCISES)) {
  const normalised = api.normEx(exercise);
  const session = api.build(normalised, 0);
  const entry = { exercise, build: plain(session), scenarios: {} };
  api.setSeq(session);
  for (const [scenarioName, scenario] of Object.entries(cases.SINGER_SCENARIOS)) {
    const frames = singerFrames(session.targets, scenario);
    const lag = scenario.lag;
    const shifted = frames.map((f) => ({ ...f, t: f.t - lag }));
    entry.scenarios[scenarioName] = {
      estimateLag: api.estimateLag(frames),
      scoreNotes: plain(api.scoreNotes(session.targets, shifted)),
    };
  }
  entry.fewFrames = { estimateLag: api.estimateLag(singerFrames(session.targets, { step: 2 })) };
  entry.strictAt = [-1, 0, 0.5, 1.37, 2.9, 5, 8, 20, 1000].map((t) => ({ t, expected: plain(api.strictAt(t)) }));
  fixture.sessions[key] = entry;
  sessionScenarios.push(key);
}

// report (the DOM-writing original, captured through a fake DOM)
fixture.report = [];
const reportScenarios = [
  ['scale', 'perfect', []], ['scale', 'sharp', [{ name: 'S', pct: 10 }]], ['scale', 'flatWithDropouts', [{ name: 'S', pct: 99 }, { name: 'S', pct: 20 }]],
  ['scale', 'octaveBelow', [{ name: 'S', pct: 100 }]], ['scale', 'sparse', []], ['scale', 'wobbly', [{ name: 'S', pct: 40 }]],
  ['scale', 'airy', [{ name: 'S', pct: 40 }]], ['twoPass', 'perfect', [{ name: 'S', pct: 5 }]], ['twoPass', 'flatWithDropouts', []],
  ['twoPass', 'sparse', [{ name: 'S', pct: 50 }]], ['twoPass', 'wobbly', []], ['twoPass', 'airy', [{ name: 'S', pct: 0 }]],
  ['sixNotes', 'perfect', [{ name: 'S', pct: 100 }]], ['sixNotes', 'sharp', []], ['sixNotes', 'octaveBelow', []],
  ['sixNotes', 'flatWithDropouts', [{ name: 'S', pct: 61 }]],
];
const reportCases = [];
for (const [key, scenarioName, previousRuns] of reportScenarios) reportCases.push({ key, scenarioName, previousRuns, silent: false });
reportCases.push({ key: 'scale', scenarioName: 'perfect', previousRuns: [], silent: true });
reportCases.push({ key: 'twoPass', scenarioName: 'perfect', previousRuns: [{ name: 'S', pct: 3 }], silent: true });
for (const reportCase of reportCases) {
  const { key, scenarioName, previousRuns, silent } = reportCase;
  const exercise = api.normEx(cases.SESSION_EXERCISES[key]);
  const session = api.build(exercise, 0);
  let frames = singerFrames(session.targets, cases.SINGER_SCENARIOS[scenarioName]);
  if (silent) frames = frames.map((f) => ({ t: f.t, m: null, tr: false }));
  storage.clear();
  storage.set('vp_hist', JSON.stringify(previousRuns.map((run) => ({ ...run, name: exercise.name, ts: 1, date: 'x' }))));
  for (const node of Object.keys(dom.nodes)) delete dom.nodes[node];
  api.setSeq(session);
  api.setFrames(frames);
  api.setVL(0.15);
  api.setQueue([]);
  api.report(exercise);
  const nodes = {};
  for (const [id, node] of Object.entries(dom.nodes)) nodes[id] = { textContent: node.textContent, innerHTML: node.innerHTML, hidden: node.hidden };
  const history = JSON.parse(storage.get('vp_hist'));
  fixture.report.push({
    key, scenarioName, silent, previousRuns, voiceLagIn: 0.15,
    voiceLagOut: JSON.parse(storage.get('vp_vlag')),
    nodes: plain(nodes),
    savedEntry: history.length > previousRuns.length ? { name: history[0].name, pct: history[0].pct } : null,
  });
}

writeFileSync(new URL('../fixtures/original-behaviour.json', import.meta.url), JSON.stringify(fixture, null, 1) + '\n');
console.log('wrote fixture;', Object.keys(fixture).join(', '));
