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
