// P5: ask the browser to treat this site's storage as "keep" (not to clear it when the phone runs low on space).
// Asked once per visit, after the first successful save of the exercises, and not at all when it is already granted.
// Nothing is stored for this: navigator.storage.persisted() says whether it is already done.

let asked = false;

/** Returns true when storage is (now) persistent. `storageManager` is navigator.storage (handed in so tests can stub it). */
export async function requestPersistence(storageManager = globalThis.navigator?.storage) {
  if (asked || !storageManager || typeof storageManager.persist !== 'function') return false;
  asked = true;
  try {
    if (typeof storageManager.persisted === 'function' && (await storageManager.persisted())) return true;
    return Boolean(await storageManager.persist());
  } catch (error) {
    return false;   // optional nicety; never worth an error
  }
}

/** For tests: forget that we asked. */
export const resetPersistenceAsked = () => {
  asked = false;
};
