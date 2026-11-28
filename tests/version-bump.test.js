// The CI guard: changed cached files without a version bump fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkVersionBump, FAILURE_MESSAGE } from '../tools/check-version-bump.mjs';
import { PRECACHE } from '../js/precache.js';

const PRE = ['index.html', 'js/main.js', 'js/version.js', 'audio/piano/C2.mp3'];

test('nothing relevant changed: fine', () => {
  assert.equal(checkVersionBump([], PRE).ok, true);
  assert.equal(checkVersionBump(['README.md', 'tests/x.test.js', 'tools/a.mjs', '.github/workflows/test.yml', 'fonts/OFL-Inter.txt'], PRE).ok, true);
});

test('a cached file changed without the version: fails with the clear message and names the files', () => {
  for (const file of ['index.html', 'js/main.js', 'audio/piano/C2.mp3', 'sw.js']) {
    const result = checkVersionBump(['README.md', file], PRE);
    assert.equal(result.ok, false, file);
    assert.ok(result.message.startsWith(FAILURE_MESSAGE));
    assert.ok(result.message.includes(file));
  }
  assert.match(FAILURE_MESSAGE, /^App files changed but js\/version\.js wasn't bumped — phones would keep the old copy\. Bump APP_VERSION \(see README › Releasing an update\)\.$/);
});

test('cached files changed together with the version: fine (also when version.js is newly added)', () => {
  assert.equal(checkVersionBump(['js/main.js', 'js/version.js'], PRE).ok, true);
  assert.equal(checkVersionBump(['sw.js', 'js/version.js', 'index.html'], PRE).ok, true);
});

test('only the version changed: fine', () => {
  assert.equal(checkVersionBump(['js/version.js'], PRE).ok, true);
});

test('it uses the real list: every file the worker caches needs the bump', () => {
  for (const file of PRECACHE.filter((path) => path !== 'js/version.js')) assert.equal(checkVersionBump([file], PRECACHE).ok, false, file);
});
