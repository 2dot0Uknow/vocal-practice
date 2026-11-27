// The practice screen: plays the piano, listens through the mic, draws the pitch roll and, when
// the session ends, hands the recorded frames to the report.

import { $, fillRange } from './dom.js';
import { state } from '../state.js';
import { store, KEYS } from '../store.js';
import { noteName, hzToMidi } from '../music.js';
import { buildSession, describeExercise } from '../exercise.js';
import { detect } from '../pitch.js';
import { err, strictAt, estimateLag, activeAt, median, summarizeSession } from '../scoring.js';
import {
  ensureAudio, setPianoVolume, openMic, micInputLatency, outputDelayEstimate, getAudioContext,
  resetTrillMode, setTrillMode, captureMicSamples, analysisWindow, brightness, playPianoNote, closeAudio,
} from '../audio.js';
import { navTo, goHome } from './navigation.js';
import { createRoll } from './roll.js';
import { previousRunsOf, showReport } from './report.js';

let currentExercise = null;
let sequence = null;            // the built session: {targets, plays, end}
let frames = [];                // one entry per analysis of the microphone
let running = false;
let animationFrame = 0;

// Delay between the piano being scheduled and you hearing it (output latency), in seconds.
// null = work it out automatically at Start. The picture-delay slider overrides it (saved as vp_lat).
let outputLatency = store.get(KEYS.pictureDelay, null);
// Delay between you singing and the mic frame being analysed.
let inputLatency = 0.02;
// Voice lag: how long after a note sounds the singer's matching pitch shows up (saved as vp_vlag).
let voiceLag = store.get(KEYS.voiceLag, 0.15);
let lastLagEstimateAt = 0;
let recentTrillPitches = [];    // trill mode: pitches from the last ~0.15 s, for smoothing

let roll = null;

/** The song clock: audio time minus what the player hears late. */
const songTime = () => getAudioContext().currentTime - outputLatency;

function showPictureDelay() {
  $('sync').value = Math.round((outputLatency ?? 0.1) * 1000);
  fillRange($('sync'));
  $('syncV').textContent = outputLatency == null ? 'auto' : Math.round(outputLatency * 1000) + ' ms';
}

function drawRoll(now = running ? songTime() : 0) {
  roll.draw({ sequence, frames, now, running, voiceLag });
}

/** Re-read the theme colours and redraw (called after the theme changes). */
export function refreshRoll() {
  roll.readColours();
  drawRoll();
}

export function openPractice(exercise) {
  currentExercise = exercise;
  navTo('prac');
  $('pName').textContent = exercise.name + (state.queue.length ? `  ·  ${state.queue.length} more after this` : '');
  $('pInfo').textContent = describeExercise(exercise);
  sequence = buildSession(exercise, 0);
  frames = [];
  $('goBtn').textContent = 'Start';
  $('rSyl').textContent = sequence.targets[0]?.syl || '–';
  roll.fit(sequence, 0, running);
  drawRoll();
}

async function startSession() {
  if (running) {
    stopSession();
    return;
  }
  ensureAudio();
  if (!(await openMic())) {
    $('rCents').textContent = 'Mic unavailable. Allow access, and open from the https:// address.';
    return;
  }
  if (outputLatency == null) {
    const estimate = outputDelayEstimate();
    outputLatency = Math.min(0.5, estimate > 0.01 ? estimate : 0.1);
  }
  inputLatency = micInputLatency();
  showPictureDelay();
  // Start 0.6 s from now so the first chord is scheduled in good time.
  const startTime = getAudioContext().currentTime + 0.6;
  sequence = buildSession(currentExercise, startTime);
  frames = [];
  resetTrillMode();
  recentTrillPitches = [];
  lastLagEstimateAt = 0;
  sequence.plays.forEach((play) => play.m.forEach((midi) => playPianoNote(midi, play.t, play.d)));
  running = true;
  $('goBtn').textContent = 'Stop';
  loop();
}

/** Stop a running session and release the piano and the microphone. */
export function stopSession() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(animationFrame);
  closeAudio();
  $('goBtn').textContent = 'Start';
}

/** One animation frame: listen, detect the pitch, update the readouts and the roll. */
function loop() {
  if (!running) return;
  captureMicSamples();
  const now = songTime();
  const target = activeAt(sequence.targets, now) || sequence.targets.find((x) => x.t0 > now);
  const trill = !!(target && target.trill);
  setTrillMode(trill);
  const { samples, sampleRate } = analysisWindow(trill);
  const pitch = trill
    ? detect(samples, sampleRate, { gate: 0.004, min: 0.4 })
    : detect(samples, sampleRate);
  const frame = { t: now - inputLatency, m: null, tr: trill };
  if (pitch) {
    frame.m = hzToMidi(pitch.f);
    frame.c = pitch.c;
    frame.ring = brightness();
  }
  if (trill) {
    // Smooth over the flutter: median of the last ~0.15 s, and bridge short dropouts.
    if (frame.m != null) recentTrillPitches.push({ t: now, m: frame.m });
    const windowSeconds = target ? Math.min(0.15, Math.max(0.06, (target.t1 - target.t0) * 0.3)) : 0.15;
    recentTrillPitches = recentTrillPitches.filter((entry) => now - entry.t < windowSeconds);
    if (recentTrillPitches.length) frame.m = median(recentTrillPitches.map((entry) => entry.m));
  } else {
    recentTrillPitches = [];
  }
  frames.push(frame);

  // Every 1.5 s, nudge the voice lag toward what the last 8 s of singing suggests.
  if (now - lastLagEstimateAt > 1.5) {
    lastLagEstimateAt = now;
    const estimate = estimateLag(frames.filter((f) => f.t > now - 8), sequence.targets);
    if (estimate != null) voiceLag = voiceLag + (estimate - voiceLag) * 0.5;
  }

  // The note the voice is judged against: the one sounding when it was sung (after lag), else the current one.
  const judgedTarget = frame.m != null ? (strictAt(sequence.targets, frame.t - voiceLag) || target) : target;
  $('rTarget').textContent = target ? noteName(target.m) : '–';
  $('rSyl').textContent = target && target.syl ? target.syl : '–';
  if (frame.m != null) {
    $('rNote').textContent = noteName(frame.m);
    if (judgedTarget) {
      const cents = err(frame.m, judgedTarget.m);
      $('rCents').textContent = (cents > 0 ? '+' : '') + Math.round(cents) + ' cents';
      // The needle spans +-100 cents across the meter.
      $('needle').style.left = `calc(${50 + Math.max(-50, Math.min(50, cents / 2))}% - 2px)`;
    }
  }
  drawRoll(now);
  if (now > sequence.end) {
    const exercise = currentExercise;
    stopSession();
    finishSession(exercise);
    return;
  }
  animationFrame = requestAnimationFrame(loop);
}

/** Score the recorded session, remember the learned voice lag and show the report. */
function finishSession(exercise) {
  const summary = summarizeSession({
    targets: sequence.targets,
    frames,
    voiceLag,
    previousRuns: previousRunsOf(exercise),
  });
  voiceLag = summary.voiceLag;
  store.set(KEYS.voiceLag, voiceLag);
  showReport(exercise, summary);
}

export function initPractice() {
  roll = createRoll($('cv'));
  new ResizeObserver(() => {
    roll.resize();
    drawRoll();
  }).observe($('cv'));
  new MutationObserver(() => roll.readColours()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  setPianoVolume(+$('vol').value);
  $('vol').oninput = () => setPianoVolume(+$('vol').value);
  $('sync').oninput = () => {
    outputLatency = +$('sync').value / 1000;
    store.set(KEYS.pictureDelay, outputLatency);
    showPictureDelay();
  };
  showPictureDelay();

  $('goBtn').onclick = startSession;
  $('backBtn').onclick = goHome;
  $('againBtn').onclick = () => openPractice(currentExercise);
  $('nextBtn').onclick = () => openPractice(state.queue.shift());
}
