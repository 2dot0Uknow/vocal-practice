// Loads the expected values captured from the original (pre-refactor) code and compares results to them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const fixture = JSON.parse(readFileSync(new URL('../fixtures/original-behaviour.json', import.meta.url), 'utf8'));

/** Same as the original ids being random: compare an exercise without its id. */
export const withoutId = ({ id, ...rest }) => rest;

/** Deep equality where numbers may differ by a tiny relative amount (floating point across machines). */
export function assertSame(actual, expected, message = '', tolerance = 1e-9, path = 'value') {
  const a = JSON.parse(JSON.stringify(actual ?? null));
  assertDeep(a, expected, tolerance, path, message);
}

function assertDeep(actual, expected, tolerance, path, message) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const allowed = tolerance * Math.max(1, Math.abs(expected));
    assert.ok(Math.abs(actual - expected) <= allowed, `${message} ${path}: ${actual} != ${expected}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${message} ${path}: expected an array`);
    assert.equal(actual.length, expected.length, `${message} ${path}: length`);
    expected.forEach((item, i) => assertDeep(actual[i], item, tolerance, `${path}[${i}]`, message));
    return;
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', `${message} ${path}: expected an object`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${message} ${path}: keys`);
    for (const key of Object.keys(expected)) assertDeep(actual[key], expected[key], tolerance, `${path}.${key}`, message);
    return;
  }
  assert.equal(actual, expected, `${message} ${path}`);
}
