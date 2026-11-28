// The session report screen. summarizeSession() (scoring.js) does the maths; this file only
// turns that data into HTML, saves the run to history and shows the screen.

import { $, esc } from './dom.js';
import { navTo } from './navigation.js';
import { noteName, spellingOf } from '../music.js';
import { store, KEYS } from '../store.js';
import { state } from '../state.js';
import { historyEntry, addToHistory, previousRunsOf } from '../history.js';
import { sparkline } from '../sparkline.js';
import { recordSetResult, setSummaryRows } from '../flow.js';

/**
 * The stat bars: label, a coloured bar, and a word. The colour is a class (lv-on / lv-near / lv-far) and the width
 * travels in data-w; applyBarWidths() sets it after the HTML is in the page (no inline style attributes, V6).
 */
export const statRowsHTML = (rows) => rows.map(({ name, value, label }) => `<div class="stat"><span>${name}</span><span class="b"><i class="${value >= 70 ? 'lv-on' : value >= 45 ? 'lv-near' : 'lv-far'}" data-w="${Math.round(value)}"></i></span><span>${esc(label)}</span></div>`).join('');

export function applyBarWidths(root) {
  root.querySelectorAll('[data-w]').forEach((bar) => { bar.style.width = bar.dataset.w + '%'; });
}

export const listItemsHTML = (items) => items.map((text) => `<li>${esc(text)}</li>`).join('');

/**
 * How one note landed, in words (V2): the cell's aria-label, e.g. "C3, 12 cents sharp, landed".
 * Within 25 cents is "landed", within 50 "close", further "still finding it".
 */
export function cellLabel(name, result) {
  if (result.miss) return `${name}, not heard`;
  if (result.octaveOff) return `${name}, an octave ${result.med < 0 ? 'below' : 'above'} the piano, still finding it`;
  const cents = Math.abs(result.med);
  const rounded = Math.round(cents);
  const word = cents <= 25 ? 'landed' : cents <= 50 ? 'close' : 'still finding it';
  const side = rounded == 0 ? 'in tune' : `${rounded} cent${rounded == 1 ? '' : 's'} ${result.med > 0 ? 'sharp' : 'flat'}`;
  return `${name}, ${side}, ${word}`;
}

/**
 * "Note by note": one strip per round (and per sound pass), one cell per note. Besides its colour each cell carries a
 * mark (V2): a tick when it landed (within 25 cents), an up / down arrow when it is further off, "8vb" / "8va" for an octave away.
 */
export function noteStripsHTML(results, exercise) {
  const groups = {};
  results.forEach((result) => {
    const key = result.round + '-' + result.pass;
    (groups[key] = groups[key] || []).push(result);
  });
  return Object.values(groups).map((strip) => `<div class="strip-group"><span class="rl" aria-hidden="true">Round ${strip[0].round + 1}${exercise.vows.length > 1 ? ' · ' + esc(exercise.vows[strip[0].pass]) : ''}</span><div class="strip" role="list" aria-label="Round ${strip[0].round + 1}${exercise.vows.length > 1 ? ', ' + esc(exercise.vows[strip[0].pass]) : ''}">${strip.map((result) => {
    const cents = result.miss ? null : Math.abs(result.med);
    const level = result.miss ? 'miss' : cents <= 25 ? 'on' : cents <= 50 ? 'near' : 'far';
    // A1: a note about an octave from the piano shows as "8vb" / "8va" instead of a number like -1200.
    const shown = result.miss ? '—' : result.octaveOff ? (result.med < 0 ? '8vb' : '8va') : (result.med > 0 ? '+' : '') + Math.round(result.med);
    const cue = result.miss || result.octaveOff ? '' : cents <= 25 ? '✓' : result.med > 0 ? '↑' : '↓';
    const name = noteName(result.m, spellingOf(exercise));
    return `<div class="cell ${level}" role="listitem" aria-label="${esc(cellLabel(name, result))}"><b>${name}</b>${cue ? `<span class="cue">${cue}</span> ` : ''}${shown}</div>`;
  }).join('')}</div></div>`).join('');
}

/** F9: the last ten saved runs of this exercise as a tiny inline SVG (no axes); the newest run is the big dot. Hidden with fewer than 2 runs. */
export function sparklineHTML(percents, highlightLast) {
  const line = sparkline(percents);
  if (!line) return '';
  const dots = line.points.map((point, i) => `<circle cx="${point.x}" cy="${point.y}" r="${i === line.points.length - 1 ? 4 : 2.5}"${highlightLast && i === line.points.length - 1 ? ' class="now"' : ''}/>`).join('');
  return `<svg viewBox="0 0 120 32" role="img" aria-label="${esc(line.label)}"><polyline points="${line.path}"/>${dots}</svg><span aria-hidden="true">Last ${line.count} runs</span>`;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let countFrame = 0;

/** V9: the percent counts up from 0 once when the report opens (at most 600 ms); straight to the number under reduced motion. The real number is always in the page for screen readers. */
function showPercent(percent) {
  cancelAnimationFrame(countFrame);
  $('sPctText').textContent = percent + '%';
  if (reducedMotion() || percent <= 0) {
    $('sPct').textContent = percent + '%';
    return;
  }
  const started = performance.now();
  const duration = Math.min(600, 200 + percent * 4);
  $('sPct').textContent = '0%';
  const step = (now) => {
    const progress = Math.max(0, Math.min(1, (now - started) / duration));   // a frame's timestamp can be a hair before `started`
    const eased = 1 - (1 - progress) ** 3;
    $('sPct').textContent = Math.round(percent * eased) + '%';
    if (progress < 1) countFrame = requestAnimationFrame(step);
  };
  countFrame = requestAnimationFrame(step);
}

let debugUrl = null;   // object URL of the current debug download, released when the next report opens

/**
 * Fill the report screen from a summary, save the run if anything was heard, and open it.
 * options.title replaces the heading; options.save = false shows the report without saving it (stopped runs).
 * options.debugSession (A7, only with ?debug=1): the session's data, offered as a JSON download.
 */
export function showReport(exercise, summary, { title = exercise.name, save = true, debugSession = null } = {}) {
  $('repTitle').textContent = title;
  showPercent(summary.pct);
  $('sSub').textContent = summary.subtitle;
  $('stats').innerHTML = statRowsHTML(summary.rows);
  applyBarWidths($('stats'));
  $('tips').innerHTML = listItemsHTML(summary.tips);
  $('good').innerHTML = listItemsHTML(summary.good);
  $('cheer').textContent = summary.cheer;
  $('notesOut').innerHTML = noteStripsHTML(summary.results, exercise);
  const saved = !!(save && summary.saveable);
  if (saved) {
    store.set(KEYS.history, addToHistory(store.get(KEYS.history, []), historyEntry(exercise, summary)));
    state.historyShown = 3;
  }
  // F9: saved runs of this exercise, oldest first (history is newest first). A stopped run is not in it, so nothing is highlighted then.
  const percents = previousRunsOf(store.get(KEYS.history, []), exercise).map((entry) => entry.pct).filter((pct) => typeof pct == 'number').reverse();
  const sparkHTML = sparklineHTML(percents, saved);
  $('spark').innerHTML = sparkHTML;
  $('spark').hidden = !sparkHTML;
  showSetSummary(exercise, summary, saved, !save);
  $('trNote').hidden = !summary.hasTrillNotes;
  $('toneNote').hidden = summary.toneHidden;
  $('leakNote').textContent = summary.leakNote;
  $('leakNote').hidden = !summary.leakNote;
  if (debugUrl) URL.revokeObjectURL(debugUrl);
  debugUrl = null;
  $('debugRow').hidden = !debugSession;
  if (debugSession) {
    debugUrl = URL.createObjectURL(new Blob([JSON.stringify(debugSession)], { type: 'application/json' }));
    $('debugLink').href = debugUrl;
    $('debugLink').download = `vocal-practice-session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  }
  $('nextBtn').hidden = !state.queue.length;
  // Main action full width: "Next" in a set, otherwise "Go again"; the other buttons sit beneath in a row.
  $('againBtn').classList.toggle('pri', !state.queue.length);
  $('againBtn').classList.toggle('wide', !state.queue.length);
  $('doneBtn').classList.toggle('wide', !state.queue.length);   // alone beneath the main button, so it takes the full width too
  if (state.queue.length) $('nextBtn').textContent = 'Next: ' + state.queue[0].name;
  navTo('rep');
}

/** F8: in "Practice all", remember this exercise's result; after the last one's report, list the whole set. */
function showSetSummary(exercise, summary, saved, partial) {
  $('setCard').hidden = true;
  if (!state.set) return;
  state.set.results = recordSetResult(state.set.results, { id: exercise.id, name: exercise.name, pct: summary.pct, saved, partial });
  if (state.queue.length || state.set.total < 2) return;
  $('setRows').innerHTML = setSummaryRows(state.set.results).map((row) => `<div class="setrow"><span>${esc(row.name)}</span><span>${esc(row.text)}</span></div>`).join('');
  $('setCard').hidden = false;
}
