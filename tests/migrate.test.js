// P7: schema version and migration. Uses a fake storage object, never the real localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, addExerciseIds, CURRENT_SCHEMA, STEPS } from '../js/migrate.js';
import { SAMPLES } from '../js/exercise.js';

/** A storage-like object that records writes and can be told to fail. */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  return {
    data,
    writes,
    failOn: null,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem(key, value) {
      if (this.failOn === key) throw new Error('quota');
      writes.push(key);
      data.set(key, value);
    },
    removeItem: (key) => data.delete(key),
    snapshot: () => JSON.stringify([...data.entries()].sort()),
  };
}

// Today's saved shapes (schema 1: no vp_schema key).
const savedExercises = [
  ...SAMPLES.map((exercise) => ({ ...exercise })),
  { id: 'x1700000000000ab12', name: 'Siren', pat: '1-5-8-5-1', vows: ['ng'], rootVow: '', start: 45, end: 52, top: false, both: false, step: 1, bpm: 90, hold: 2, spell: 'b', futureField: { keep: 'me' } },
  { id: 'x1700000000001cd34', name: 'Siren', pat: '1-3-5', vows: ['ah'], rootVow: '', start: 48, end: 53, top: false, both: false, step: 2, bpm: 100, hold: 2 },
];
const savedHistory = [
  { name: 'Siren', pct: 72, ts: 1764000000000, date: 'Nov 24' },
  { name: '5-note scale', pct: 80, ts: 1763900000000, date: 'Nov 23', note: 'unknown field survives' },
  { name: 'Deleted long ago', pct: 55, ts: 1763800000000, date: 'Nov 22' },
  { name: 'Sustain on "ng"', pct: 60, ts: 1763700000000, date: 'Nov 21' },
];
const schema1 = () => ({
  vp_ex: JSON.stringify(savedExercises),
  vp_hist: JSON.stringify(savedHistory),
  vp_def: JSON.stringify({ start: 48, end: 55 }),
  vp_lat: '0.12',
  vp_vlag: '0.18',
  vp_theme: '"dark"',
});

const silenceWarnings = (fn) => {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return [fn(), warnings];
  } finally {
    console.warn = original;
  }
};

test('schema 1 -> 2: history entries get exId by name (first match wins); nothing else changes', () => {
  const storage = fakeStorage(schema1());
  const before = schema1();
  const [result, warnings] = silenceWarnings(() => migrate(storage));
  assert.deepEqual(warnings, []);
  assert.equal(result.failed, false);
  assert.equal(storage.getItem('vp_schema'), '2');
  const history = JSON.parse(storage.getItem('vp_hist'));
  assert.equal(history.length, 4, 'no entry dropped');
  assert.equal(history[0].exId, 'x1700000000000ab12', 'duplicate name: the first exercise wins');
  assert.equal(history[1].exId, 's1', 'sample ids link too');
  assert.equal(history[2].exId, undefined, 'unmatched entry stays unlinked');
  assert.equal(history[3].exId, 's3');
  assert.equal(history[1].note, 'unknown field survives');
  history.forEach((entry, i) => {
    const { exId, ...rest } = entry;
    assert.deepEqual(rest, savedHistory[i], 'every original field kept as it was');
  });
  for (const key of ['vp_ex', 'vp_def', 'vp_lat', 'vp_vlag', 'vp_theme']) {
    assert.equal(storage.getItem(key), before[key], `${key} untouched`);
    assert.ok(!storage.writes.includes(key), `${key} not rewritten`);
  }
  assert.equal(storage.writes.at(-1), 'vp_schema', 'version is written last');
});

test('running again changes nothing (idempotent), even if the version key were lost', () => {
  const storage = fakeStorage(schema1());
  silenceWarnings(() => migrate(storage));
  const after = storage.snapshot();
  storage.writes.length = 0;
  silenceWarnings(() => migrate(storage));
  assert.equal(storage.snapshot(), after);
  assert.deepEqual(storage.writes, []);
  storage.data.delete('vp_schema');
  silenceWarnings(() => migrate(storage));
  assert.equal(storage.snapshot(), after, 'step re-run on already linked data gives the same data');
});

test('first launch with no saved library links history against the built-in samples; no vp_ex is invented', () => {
  const storage = fakeStorage({ vp_hist: JSON.stringify([{ name: '5-note scale', pct: 50, ts: 1, date: 'x' }]) });
  silenceWarnings(() => migrate(storage));
  assert.equal(JSON.parse(storage.getItem('vp_hist'))[0].exId, 's1');
  assert.equal(storage.getItem('vp_ex'), null);
  assert.equal(storage.getItem('vp_schema'), '2');
});

test('brand-new install (nothing saved): just stamps the version', () => {
  const storage = fakeStorage();
  silenceWarnings(() => migrate(storage));
  assert.equal(storage.snapshot(), JSON.stringify([['vp_schema', '2']]));
});

test('entries that are not understood are kept as they are (non-objects, existing exId, unreadable history)', () => {
  const odd = [null, 'text', 7, { name: 'Siren', exId: 'mine' }, { pct: 3 }];
  const storage = fakeStorage({ vp_ex: JSON.stringify(savedExercises), vp_hist: JSON.stringify(odd) });
  silenceWarnings(() => migrate(storage));
  assert.deepEqual(JSON.parse(storage.getItem('vp_hist')), odd);
  const broken = fakeStorage({ vp_ex: JSON.stringify(savedExercises), vp_hist: '{oops' });
  silenceWarnings(() => migrate(broken));
  assert.equal(broken.getItem('vp_hist'), '{oops', 'unreadable data is never overwritten');
});

test('a step that throws leaves storage exactly as it was, warns, and hands back the in-memory data', () => {
  const storage = fakeStorage(schema1());
  const before = storage.snapshot();
  const steps = [STEPS[0], { from: 2, run: () => { throw new Error('boom'); } }];
  const [result, warnings] = silenceWarnings(() => migrate(storage, { steps, target: 3 }));
  assert.equal(storage.snapshot(), before, 'storage unchanged, even though step 1 itself worked');
  assert.deepEqual(storage.writes, []);
  assert.equal(result.failed, true);
  assert.equal(warnings.length, 1);
  assert.ok(Array.isArray(result.data.vp_hist), 'the app can keep running on this');
});

test('a missing step is a failure too (never half-migrated)', () => {
  const storage = fakeStorage(schema1());
  const before = storage.snapshot();
  const [result] = silenceWarnings(() => migrate(storage, { steps: [], target: 2 }));
  assert.equal(storage.snapshot(), before);
  assert.equal(result.failed, true);
});

test('a write that fails midway is rolled back and vp_schema is not written', () => {
  const storage = fakeStorage(schema1());
  const before = storage.snapshot();
  storage.failOn = 'vp_schema';
  const [result, warnings] = silenceWarnings(() => migrate(storage));
  assert.equal(storage.snapshot(), before, 'history put back as it was');
  assert.equal(result.failed, true);
  assert.equal(warnings.length, 1);
  assert.ok(result.data.vp_hist.every((entry, i) => i == 2 || entry.exId), 'in-memory copy is the migrated one');
});

test('a schema newer than this app is left untouched with a warning', () => {
  const storage = fakeStorage({ ...schema1(), vp_schema: '99' });
  const before = storage.snapshot();
  const [result, warnings] = silenceWarnings(() => migrate(storage));
  assert.equal(storage.snapshot(), before);
  assert.equal(warnings.length, 1);
  assert.equal(result.data, null);
  assert.equal(result.to, 99);
});

test('a garbled version value is left untouched with a warning', () => {
  for (const garbage of ['"two"', '1.5', '0', '{oops']) {
    const storage = fakeStorage({ ...schema1(), vp_schema: garbage });
    const before = storage.snapshot();
    const [, warnings] = silenceWarnings(() => migrate(storage));
    assert.equal(storage.snapshot(), before, garbage);
    assert.equal(warnings.length, 1, garbage);
  }
});

test('the current version is a no-op', () => {
  const storage = fakeStorage({ ...schema1(), vp_schema: String(CURRENT_SCHEMA) });
  const before = storage.snapshot();
  silenceWarnings(() => migrate(storage));
  assert.equal(storage.snapshot(), before);
  assert.equal(CURRENT_SCHEMA, 2);
});

test('addExerciseIds does not mutate its input', () => {
  const history = [{ name: 'Siren', pct: 1 }];
  const out = addExerciseIds({ exercises: savedExercises, history });
  assert.equal(history[0].exId, undefined);
  assert.equal(out.history[0].exId, 'x1700000000000ab12');
});
