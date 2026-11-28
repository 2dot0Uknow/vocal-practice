// A7: every session file in tests/fixtures/sessions/ is replayed through summarizeSession().
// For now it only checks that nothing throws and the report data looks like a report; exact expectations can come later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { summarizeSession } from '../js/scoring.js';
import { summaryInputFrom, buildDebugSession, isDebugMode, APP_VERSION } from '../js/debug.js';

const folder = new URL('./fixtures/sessions/', import.meta.url);
const files = readdirSync(folder).filter((name) => name.endsWith('.json'));

test('there is at least the synthetic example session', () => {
  assert.ok(files.includes('synthetic-scale.json'));
});

for (const name of files) {
  test(`session fixture ${name}: summarizeSession does not throw`, () => {
    const session = JSON.parse(readFileSync(new URL(name, folder), 'utf8'));
    for (const key of ['exercise', 'targets', 'frames', 'voiceLag', 'outputLatency', 'gate', 'pianoLeak', 'userAgent', 'appVersion']) {
      assert.ok(key in session, `${name} has ${key}`);
    }
    let summary;
    assert.doesNotThrow(() => { summary = summarizeSession(summaryInputFrom(session)); });
    assert.equal(summary.total, session.targets.length);
    assert.ok(Number.isInteger(summary.pct));
    assert.doesNotThrow(() => JSON.stringify(summary));
  });
}

test('the synthetic example scores as the singer it was made from (a steady, slightly sharp singer lands the notes)', () => {
  const session = JSON.parse(readFileSync(new URL('synthetic-scale.json', folder), 'utf8'));
  const summary = summarizeSession(summaryInputFrom(session));
  assert.ok(summary.pct >= 90, `pct ${summary.pct}`);
});

test('buildDebugSession keeps what a fixture needs, rounds the numbers, and round-trips through JSON', () => {
  const frames = [{ t: 1.234567, m: 60.123456, c: 0.912345, ring: 0.123456, tr: false }, { t: 1.25, m: null, tr: true }];
  const session = buildDebugSession({ exercise: { name: 'x' }, targets: [{ m: 60, t0: 1, t1: 2 }], frames, voiceLag: 0.15, outputLatency: 0.1, gate: 0.008, pianoLeak: true, userAgent: 'UA' });
  assert.deepEqual(session.frames[0], { t: 1.2346, m: 60.1235, tr: false, c: 0.912, ring: 0.1235 });
  assert.deepEqual(session.frames[1], { t: 1.25, m: null, tr: true });
  assert.equal(session.gate, 0.008);
  assert.equal(session.pianoLeak, true);
  assert.equal(session.narrowBand, false);
  assert.equal(session.appVersion, APP_VERSION);
  assert.equal(session.userAgent, 'UA');
  assert.deepEqual(JSON.parse(JSON.stringify(session)), session);
});

test('isDebugMode only for ?debug=1', () => {
  assert.equal(isDebugMode('?debug=1'), true);
  assert.equal(isDebugMode('?a=2&debug=1'), true);
  for (const search of ['', '?debug=0', '?debug', '?debugger=1', undefined]) assert.equal(isDebugMode(search), false, String(search));
});
