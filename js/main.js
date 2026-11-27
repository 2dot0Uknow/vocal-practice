// App entry point: load saved data, wire every screen together, show the library.

import { loadState } from './state.js';
import { initRangeFills } from './ui/dom.js';
import { initNavigation } from './ui/navigation.js';
import { initTheme } from './ui/theme.js';
import { initLibrary, renderLibrary } from './ui/library.js';
import { initEditor, stopPreview } from './ui/editor.js';
import { initPhoto } from './ui/photo.js';
import { initPractice, stopSession, refreshRoll } from './ui/practice.js';

loadState();
initNavigation({ stopSession, stopPreview, showLibrary: renderLibrary });
initLibrary();
initEditor();
initPhoto();
initPractice();
initTheme(refreshRoll);
initRangeFills();
renderLibrary();
