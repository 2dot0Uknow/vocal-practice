// App entry point: load saved data, wire every screen together, show the library.

import { loadState } from './state.js';
import { store } from './store.js';
import { migrate } from './migrate.js';
import { initRangeFills } from './ui/dom.js';
import { initNavigation } from './ui/navigation.js';
import { initTheme } from './ui/theme.js';
import { initLibrary, renderLibrary } from './ui/library.js';
import { initEditor, stopPreview } from './ui/editor.js';
import { initPhoto } from './ui/photo.js';
import { initPractice, abortSession, refreshRoll } from './ui/practice.js';
import { hideToast } from './ui/toast.js';
import { loadPianoSamples } from './audio.js';

// Bring saved data up to date first. If that is not possible, run on the in-memory result and leave storage alone.
const migration = migrate();
if (migration.data) store.useInMemory(migration.data);
loadState();
initNavigation({ stopSession: abortSession, stopPreview, showLibrary: renderLibrary, leaveLibrary: hideToast });
initLibrary();
initEditor();
initPhoto();
initPractice();
initTheme(refreshRoll);
initRangeFills();
renderLibrary();

// F5: the first tap anywhere starts fetching the piano samples, so they are ready by the time a note is needed.
document.addEventListener('pointerdown', () => loadPianoSamples(), { once: true, capture: true });
