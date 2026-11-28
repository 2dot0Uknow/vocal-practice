// Offline copy and updates (P2): registers sw.js and shows "Update ready, tap to reload" when a new version is waiting.
//
// The new version is never swapped in by itself: the waiting worker only takes over after the person taps the toast
// (the page sends SKIP_WAITING), and the page reloads when that happens. The toast stays away while `isBusy()` says a
// practice session is open, and comes back when it ends.

import { $ } from './dom.js';

/** Register the service worker? Not without browser support, and not when the address has ?nosw=1 (for debugging and tests). */
export const shouldRegister = ({ search = '', hasServiceWorker = false } = {}) => hasServiceWorker && new URLSearchParams(search).get('nosw') !== '1';

/** Should the "Update ready" toast be on screen? */
export const shouldShowUpdate = ({ waiting, busy }) => Boolean(waiting) && !busy;

export function initUpdates({ isBusy = () => false } = {}) {
  if (!shouldRegister({ search: location.search, hasServiceWorker: 'serviceWorker' in navigator })) return;
  let waiting = null;
  let accepted = false;   // the person tapped; only then does a change of controlling worker reload the page
  let watching = null;

  const refresh = () => {
    const show = shouldShowUpdate({ waiting, busy: isBusy() });
    $('updateToast').hidden = !show;
    document.body.classList.toggle('has-update', show);
  };
  const offer = (worker) => {
    waiting = worker;
    refresh();
    // Screens change without events here, so look again every second while an update is waiting (cheap, and it stops once reloaded).
    if (!watching) watching = setInterval(refresh, 1000);
  };

  $('updateBtn').onclick = () => {
    if (!waiting || isBusy()) return;
    accepted = true;
    $('updateBtn').disabled = true;
    $('updateBtn').textContent = 'Updating…';
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!accepted || reloading) return;   // the first install taking control (clients.claim) must not reload anything
    reloading = true;
    location.reload();
  });

  // type 'module' lets sw.js import the version and the file list; updateViaCache 'none' makes the browser look for a new sw.js
  // (and what it imports) on the network every time, not in its HTTP cache.
  navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' }).then((registration) => {
    // An update that finished installing in an earlier visit and is still waiting.
    if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      // By the time this runs a quick install may be over, and the worker then sits in `waiting` instead of `installing`.
      const installing = registration.installing || registration.waiting;
      if (!installing) return;
      const check = () => {
        // With no controller this is the very first install: nothing to update from.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) offer(installing);
      };
      installing.addEventListener('statechange', check);
      check();   // it may already have finished installing by the time this runs
    });
    // A phone app can stay open for days: look for a new version whenever it comes back to the front.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  }).catch((error) => console.warn('Offline mode is not available:', error));
}
