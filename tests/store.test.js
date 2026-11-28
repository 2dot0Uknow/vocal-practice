import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { store, KEYS } from '../js/store.js';

let data;
let failWrites;

beforeEach(() => {
  data = new Map();
  failWrites = false;
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => {
      if (failWrites) throw new Error('quota');
      data.set(key, value);
    },
  };
});
afterEach(() => {
  delete globalThis.localStorage;
});

test('storage keys are the ones already saved on people\'s phones', () => {
  assert.deepEqual(KEYS, {
    exercises: 'vp_ex',
    history: 'vp_hist',
    defaultRange: 'vp_def',
    pictureDelay: 'vp_lat',
    voiceLag: 'vp_vlag',
    theme: 'vp_theme',
    onboarded: 'vp_onboarded', // F10: a new key (a flag), not a shape change
    schema: 'vp_schema', // P7: the data-shape version
  });
});

test('store.get returns the fallback when nothing is saved, or the value is not valid JSON', () => {
  assert.deepEqual(store.get('vp_hist', []), []);
  data.set('vp_hist', '{oops');
  assert.deepEqual(store.get('vp_hist', ['fallback']), ['fallback']);
  data.set('vp_theme', 'null');
  assert.equal(store.get('vp_theme', ''), '');
});

test('store.set writes JSON and store.get reads it back (including 0 and empty string)', () => {
  store.set('vp_def', { start: 48, end: 55 });
  assert.equal(data.get('vp_def'), '{"start":48,"end":55}');
  assert.deepEqual(store.get('vp_def', null), { start: 48, end: 55 });
  store.set('vp_lat', 0);
  assert.equal(store.get('vp_lat', 0.1), 0);
  store.set('vp_theme', '');
  assert.equal(store.get('vp_theme', 'x'), '');
});

test('store.set never throws, even when storage is full', () => {
  failWrites = true;
  assert.doesNotThrow(() => store.set('vp_ex', [1]));
});

test('store.get never throws when localStorage is missing', () => {
  delete globalThis.localStorage;
  assert.equal(store.get('vp_ex', 'fallback'), 'fallback');
  assert.doesNotThrow(() => store.set('vp_ex', 1));
});

test('store.remove forgets a key so reads fall back to the default again (B11: picture delay back to automatic)', () => {
  store.set(KEYS.pictureDelay, 0.23);
  assert.equal(store.get(KEYS.pictureDelay, null), 0.23);
  store.remove(KEYS.pictureDelay);
  assert.equal(store.get(KEYS.pictureDelay, null), null);
  assert.equal(data.has('vp_lat'), false);
});

test('store.useInMemory stands in for a key until it is written (a failed migration keeps running on its in-memory copy)', () => {
  data.set('vp_hist', '[{"name":"old"}]');
  store.useInMemory({ vp_hist: [{ name: 'in memory' }] });
  assert.deepEqual(store.get('vp_hist', []), [{ name: 'in memory' }]);
  assert.equal(data.get('vp_hist'), '[{"name":"old"}]', 'storage itself is untouched');
  store.set('vp_hist', [{ name: 'written' }]);
  assert.deepEqual(store.get('vp_hist', []), [{ name: 'written' }]);
});

// ---- P6: failed saves ----

test('P6: store.set returns true when saved and false when the browser refuses', () => {
  assert.equal(store.set('vp_def', { start: 48, end: 55 }), true);
  failWrites = true;
  assert.equal(store.set('vp_def', { start: 1, end: 2 }), false);
  assert.deepEqual(store.get('vp_def', null), { start: 48, end: 55 }, 'the earlier value is still there');
});

test('P6: the failure handler runs once per visit, not on every write', () => {
  const reports = [];
  store.onWriteFailed((error) => reports.push(error.message));
  failWrites = true;
  store.set('vp_ex', [1]);
  store.set('vp_hist', [2]);
  store.set('vp_theme', 'dark');
  assert.deepEqual(reports, ['quota']);
  failWrites = false;
  assert.equal(store.set('vp_theme', 'dark'), true, 'a good write does not call it');
  assert.equal(reports.length, 1);
  store.onWriteFailed(null);
});

test('P6: a storage stub whose setItem always throws (quota, private mode) gives false and one report', () => {
  globalThis.localStorage = { getItem: () => null, removeItem() {}, setItem() { throw new DOMException('full', 'QuotaExceededError'); } };
  let reports = 0;
  store.onWriteFailed(() => reports++);
  assert.equal(store.set('vp_ex', []), false);
  assert.equal(store.set('vp_hist', []), false);
  assert.equal(reports, 1);
  store.onWriteFailed(null);
});

test('P6: a handler that throws does not break saving', () => {
  store.onWriteFailed(() => { throw new Error('toast failed'); });
  failWrites = true;
  assert.doesNotThrow(() => store.set('vp_ex', []));
  store.onWriteFailed(null);
});
