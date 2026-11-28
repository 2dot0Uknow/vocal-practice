// P5: ask for persistent storage once, only when it is not already granted.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { requestPersistence, resetPersistenceAsked } from '../js/persist.js';

beforeEach(() => resetPersistenceAsked());

const manager = ({ persisted = false, grant = true, throws = false } = {}) => {
  const calls = { persist: 0, persisted: 0 };
  return {
    calls,
    persisted: async () => { calls.persisted++; return persisted; },
    persist: async () => { calls.persist++; if (throws) throw new Error('no'); return grant; },
  };
};

test('asks the browser to persist, once per visit', async () => {
  const storage = manager();
  assert.equal(await requestPersistence(storage), true);
  assert.equal(await requestPersistence(storage), false, 'the second call does nothing');
  assert.deepEqual(storage.calls, { persist: 1, persisted: 1 });
});

test('does not ask when storage is already persistent', async () => {
  const storage = manager({ persisted: true });
  assert.equal(await requestPersistence(storage), true);
  assert.equal(storage.calls.persist, 0);
});

test('a refusal is fine, and so is a browser without the feature or one that throws', async () => {
  assert.equal(await requestPersistence(manager({ grant: false })), false);
  resetPersistenceAsked();
  assert.equal(await requestPersistence(undefined), false);
  assert.equal(await requestPersistence({}), false);
  resetPersistenceAsked();
  assert.equal(await requestPersistence(manager({ throws: true })), false);
});
