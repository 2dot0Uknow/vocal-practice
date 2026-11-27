import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normEx, SAMPLES, buildSession, isTrill } from '../js/exercise.js';
import { fixture, assertSame } from './helpers/fixture.js';
import { SESSION_EXERCISES } from './tools/cases.mjs';

test('buildSession matches the original timeline (targets, piano plays, end time)', () => {
  for (const [key, entry] of Object.entries(fixture.sessions)) {
    assertSame(buildSession(normEx(SESSION_EXERCISES[key]), 0), entry.build, key);
  }
});

test('buildSession: cue chord before each round, and the start time shifts everything', () => {
  const exercise = normEx(SESSION_EXERCISES.scale);
  const at0 = buildSession(exercise, 0);
  const at5 = buildSession(exercise, 5);
  assert.deepEqual(at0.plays[0].m, [48, 52, 55]);
  assert.equal(at0.targets.length, 27);
  assert.ok(Math.abs(at5.targets[0].t0 - at0.targets[0].t0 - 5) < 1e-9);
});

test('isTrill recognises buzzy sounds only', () => {
  for (const sound of ['lip trill', 'lip roll', 'bubbles', 'raspberry', 'brr', 'Lip']) assert.equal(isTrill(sound), true, sound);
  for (const sound of ['ah', 'ng', 'gee', '', undefined]) assert.equal(isTrill(sound), false, String(sound));
});

test('normEx fills defaults and keeps the old single "vow" field working', () => {
  const exercise = normEx({ pat: '1-3-5', start: 48, end: 50, vow: 'ah' });
  assert.deepEqual({ ...exercise, id: 'x' }, {
    id: 'x', name: '1-3-5', pat: '1-3-5', vows: ['ah'], rootVow: '', start: 48, end: 50,
    top: false, both: false, step: 1, bpm: 90, hold: 2,
  });
  assert.equal(normEx({ id: 'keep', pat: '1-2', start: 1, end: 2 }).id, 'keep');
});

test('the built-in sample exercises are unchanged from the original', () => {
  assertSame(SAMPLES, fixture.samples);
  assert.deepEqual(SAMPLES.map((s) => s.id), ['s1', 's2', 's3']);
});

test('B7: normEx keeps an optional spell field only when it is b or #', () => {
  const base = { pat: '1-3-5', start: 48, end: 55 };
  assert.equal('spell' in normEx(base), false, 'old data without it is unchanged');
  assert.equal(normEx({ ...base, spell: 'b' }).spell, 'b');
  assert.equal(normEx({ ...base, spell: '#' }).spell, '#');
  assert.equal('spell' in normEx({ ...base, spell: '' }), false);
  assert.equal('spell' in normEx({ ...base, spell: 'x' }), false);
});
