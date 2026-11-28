// "Your data" at the bottom of the library (P5): Export a backup file, Import one (Merge or Replace).
// The file rules live in js/backup.js; this module is the buttons, the file picker and the messages.

import { $ } from './dom.js';
import { state, loadState } from '../state.js';
import { store, KEYS } from '../store.js';
import { buildBackup, backupFileName, parseBackup, countsOf, describeCounts, mergeData, replaceData, applyWrites } from '../backup.js';
import { requestPersistence } from '../persist.js';
import { renderLibrary } from './library.js';
import { reloadTheme } from './theme.js';
import { reloadSavedSettings } from './practice.js';

let pending = null;   // a checked backup waiting for Merge / Replace / Cancel

function say(message) {
  $('dataMsg').textContent = message;
  $('dataMsg').hidden = !message;
}

function closeImport() {
  pending = null;
  $('importCard').hidden = true;
}

export function exportBackup() {
  say('');
  closeImport();
  // The exercises are what the library shows (the built-in samples count until something is saved).
  const backup = buildBackup((key) => (key === KEYS.exercises ? state.exercises : store.get(key, undefined)));
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  say(`Saved a backup with ${describeCounts(countsOf(backup.data))}. Look in your Downloads.`);
}

async function chooseFile(event) {
  const file = event.target.files[0];
  event.target.value = '';   // choosing the same file again must work
  if (!file) return;
  say('');
  closeImport();
  let text;
  try {
    text = await file.text();
  } catch (error) {
    say("I couldn't read that file. Try picking it again.");
    return;
  }
  const result = parseBackup(text);
  if (!result.ok) {
    say(result.message);
    return;
  }
  pending = result;
  $('importSummary').textContent = `This backup has ${describeCounts(result.counts)}.`;
  $('importCard').hidden = false;
  $('mergeBtn').focus();
}

function runImport(mode) {
  if (!pending) return;
  const writes = mode === 'merge'
    ? mergeData({ exercises: state.exercises, history: store.get(KEYS.history, []) }, pending.data)
    : replaceData(pending.data);
  const saved = applyWrites(store, writes);
  closeImport();
  if (!saved) {
    say("I couldn't save the backup, so nothing was changed. Your phone's storage might be full.");
    return;
  }
  loadState();
  reloadTheme();
  reloadSavedSettings();
  renderLibrary();
  requestPersistence();
  say(`Done. You now have ${describeCounts(countsOf({ [KEYS.exercises]: state.exercises, [KEYS.history]: store.get(KEYS.history, []) }))}.`);
}

export function initData() {
  $('exportBtn').onclick = exportBackup;
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = chooseFile;
  $('mergeBtn').onclick = () => runImport('merge');
  $('replaceBtn').onclick = () => runImport('replace');
  $('importCancel').onclick = closeImport;
}
