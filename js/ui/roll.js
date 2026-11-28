// The pitch roll: a canvas showing the target notes as blocks sliding past a "now" line,
// with the singer's voice drawn as a line. Pure drawing: the practice screen supplies the state.

import { noteName } from '../music.js';
import { cents, activeAt, dropOctaveGlitches } from '../scoring.js';
import { firstIndexWhere, targetRange, nearestTargetByStart } from '../timeindex.js';

/**
 * view = {targets, frames, now, running, voiceLag, spelling}:
 *  - targets: the notes on the song clock so far, in time order (the run's live targets)
 *  - frames: the microphone frames, in time order. Only the visible window of frames and targets is touched (B12).
 *  - now: current position on the song clock (seconds)
 *  - spelling: how to spell note names ('b', '#' or 'auto'; see noteName)
 *  - voiceLag: seconds to shift the voice frames back by
 */
export function createRoll(canvas) {
  const context = canvas.getContext('2d');
  // Visible pitch range (MIDI); it glides toward whatever notes are coming up.
  let lowestPitch = 45;
  let highestPitch = 60;
  let colours = {};

  // Canvas can't read CSS variables, so resolve them through a hidden element.
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.appendChild(probe);

  function readColours() {
    const resolve = (variable) => {
      probe.style.color = `var(${variable})`;
      return getComputedStyle(probe).color;
    };
    colours = {
      ink: resolve('--ink'),
      bar: resolve('--bar'),
      line: resolve('--line'),
      muted: resolve('--muted'),
      pri: resolve('--pri'),
      on: resolve('--on'),
      near: resolve('--near'),
      far: resolve('--far'),
    };
  }

  /** Match the canvas's drawing size to its on-screen size (and the screen's pixel density). */
  function resize() {
    const density = devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * density;
    canvas.height = canvas.clientHeight * density;
    readColours();
  }

  /** Ease the visible range toward the notes from 2 s ago to 4 s ahead; snap to it when not running. */
  function fit(targets, now, running) {
    // Targets are in time order and do not overlap: the ones in view are one contiguous slice.
    const first = firstIndexWhere(targets, (target) => target.t1 > now - 2);
    const last = firstIndexWhere(targets, (target) => target.t0 >= now + 4, first);
    const visible = targets.slice(first, last);
    // Held between rounds there is nothing in view: keep the range as it is.
    if (!visible.length && running) return;
    const pitches = (visible.length ? visible : targets.slice(0, 10)).map((target) => target.m);
    const wantedLow = Math.min(...pitches) - 3;
    const wantedHigh = Math.max(...pitches) + 3;
    lowestPitch += (wantedLow - lowestPitch) * 0.08;
    highestPitch += (wantedHigh - highestPitch) * 0.08;
    if (!running) {
      lowestPitch = wantedLow;
      highestPitch = wantedHigh;
    }
  }

  function draw({ targets, frames, now, running, voiceLag, spelling }) {
    if (!targets || !targets.length) return;
    const density = devicePixelRatio || 1;
    const width = canvas.width / density;
    const height = canvas.height / density;
    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, width, height);
    fit(targets, now, running);

    // Five seconds fit across the screen; "now" sits 30% from the left.
    const pixelsPerSecond = width / 5;
    const xOf = (t) => width * 0.3 + (t - now) * pixelsPerSecond;
    const yOf = (midi) => height - ((midi - lowestPitch) / (highestPitch - lowestPitch)) * height;
    const semitoneHeight = height / (highestPitch - lowestPitch);

    // Semitone grid lines, with labels on every C and G.
    context.font = '11px Inter,sans-serif';
    context.textBaseline = 'middle';
    for (let midi = Math.ceil(lowestPitch); midi <= highestPitch; midi++) {
      context.fillStyle = colours.line;
      context.fillRect(0, yOf(midi), width, midi % 12 == 0 ? 1.5 : 0.5);
      if (midi % 12 == 0 || midi % 12 == 7) {
        context.fillStyle = colours.muted;
        context.fillText(noteName(midi, spelling), 6, yOf(midi) - 7);
      }
    }

    // Target notes as rounded blocks, the current one highlighted, with the sound's name above.
    const active = running ? activeAt(targets, now) : null;
    // Only the notes that can be on screen: from "now" back to the left edge to the right edge.
    const onScreen = targetRange(targets, now - 0.3 * 5, now + 0.7 * 5);
    targets.slice(onScreen.start, onScreen.end).forEach((target) => {
      const left = xOf(target.t0);
      const right = xOf(target.t1);
      if (right < 0 || left > width) return;
      context.fillStyle = target == active ? colours.pri : colours.bar;
      context.beginPath();
      context.roundRect(left + 1, yOf(target.m) - semitoneHeight * 0.4, Math.max(4, right - left - 2), semitoneHeight * 0.8, 4);
      context.fill();
      if (target.syl && right - left > 26) {
        context.fillStyle = colours.muted;
        context.fillText(target.syl, left + 3, yOf(target.m) - semitoneHeight * 0.4 - 8);
      }
    });

    // The singer's voice: a line drawn at the pitch actually sung (A1: no octave folding), coloured by how close each
    // frame is to the note it is aiming at. A pitch outside the visible range is pinned to the top or bottom edge
    // (the line runs along the edge) and the newest point gets a small arrow there, so a voice an octave off is still visible.
    context.lineWidth = 4;
    context.lineCap = 'round';
    let previousPoint = null;
    // Frames are in time order: start at the first one that is recent enough. Detector octave glitches are not drawn.
    const visibleFrames = dropOctaveGlitches(frames.slice(firstIndexWhere(frames, (frame) => frame.t - voiceLag >= now - 1.6)));
    let edge = 0;   // -1 / 1: the newest point is below / above the visible range
    let edgeX = 0;
    for (const frame of visibleFrames) {
      const frameTime = frame.t - voiceLag;
      if (frame.m == null) {
        previousPoint = null;
        continue;
      }
      const target = activeAt(targets, frameTime) || nearestTargetByStart(targets, frameTime);
      const off = cents(frame.m, target.m);
      const rawY = yOf(frame.m);
      const y = Math.max(4, Math.min(height - 4, rawY));
      edge = rawY < 4 ? 1 : rawY > height - 4 ? -1 : 0;
      edgeX = xOf(frameTime);
      const point = [edgeX, y];
      if (previousPoint) {
        context.strokeStyle = Math.abs(off) <= 25 ? colours.on : Math.abs(off) <= 50 ? colours.near : colours.far;
        context.beginPath();
        context.moveTo(...previousPoint);
        context.lineTo(...point);
        context.stroke();
      }
      previousPoint = point;
    }
    if (edge) {
      // A small triangle on the edge, pointing the way the voice went off the picture.
      const tipY = edge > 0 ? 2 : height - 2;
      const baseY = edge > 0 ? 12 : height - 12;
      context.fillStyle = colours.far;
      context.beginPath();
      context.moveTo(edgeX, tipY);
      context.lineTo(edgeX - 7, baseY);
      context.lineTo(edgeX + 7, baseY);
      context.closePath();
      context.fill();
    }

    // The "now" line.
    context.fillStyle = colours.pri;
    context.globalAlpha = 0.55;
    context.fillRect(width * 0.3 - 1, 0, 2, height);
    context.globalAlpha = 1;
    if (!running) {
      context.fillStyle = colours.muted;
      context.font = '14px Inter,sans-serif';
      context.textAlign = 'center';
      context.fillText('Press Start, then sing along with the piano', width / 2, 24);
      context.textAlign = 'left';
    }
  }

  return { draw, fit, resize, readColours };
}
