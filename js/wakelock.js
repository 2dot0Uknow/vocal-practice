// Screen Wake Lock: keeps the phone awake while a session runs. Unsupported or refused = silently nothing.

let sentinel = null;
let wanted = false;

/** Ask the browser to keep the screen on. Safe to call again (e.g. when the page becomes visible). */
export async function acquireWakeLock() {
  wanted = true;
  if (sentinel || !('wakeLock' in navigator)) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!wanted || sentinel) {
      // The session ended (or another request won) while we waited.
      lock.release().catch(() => {});
      return;
    }
    sentinel = lock;
    lock.addEventListener('release', () => {
      if (sentinel === lock) sentinel = null;
    });
  } catch (error) {
    // Refused (low battery, not allowed): carry on without it.
  }
}

/** Let the screen sleep again. */
export function releaseWakeLock() {
  wanted = false;
  const lock = sentinel;
  sentinel = null;
  if (lock) lock.release().catch(() => {});
}
