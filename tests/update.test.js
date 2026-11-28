// P2: when the service worker is registered and when the "Update ready" toast may show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRegister, shouldShowUpdate } from '../js/ui/update.js';

test('registers only where the browser supports it, and not with ?nosw=1', () => {
  assert.equal(shouldRegister({ search: '', hasServiceWorker: true }), true);
  assert.equal(shouldRegister({ search: '?debug=1', hasServiceWorker: true }), true);
  assert.equal(shouldRegister({ search: '?nosw=1', hasServiceWorker: true }), false);
  assert.equal(shouldRegister({ search: '?debug=1&nosw=1', hasServiceWorker: true }), false);
  assert.equal(shouldRegister({ search: '', hasServiceWorker: false }), false);
});

test('the update toast shows only when an update waits and no session is open', () => {
  assert.equal(shouldShowUpdate({ waiting: {}, busy: false }), true);
  assert.equal(shouldShowUpdate({ waiting: {}, busy: true }), false, 'deferred while a session is open');
  assert.equal(shouldShowUpdate({ waiting: null, busy: false }), false);
});
