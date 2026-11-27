// The pitch roll: a canvas showing the target notes as blocks sliding past a "now" line,
// with the singer's voice drawn as a line. Pure drawing: the practice screen supplies the state.

import { noteName } from '../music.js';
import { err, activeAt } from '../scoring.js';

/**
 * view = {sequence, frames, now, running, voiceLag, spelling}:
 *  - sequence: the built session ({targets})
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
  function fit(sequence, now, running) {
    const visible = sequence.targets.filter((target) => target.t1 > now - 2 && target.t0 < now + 4);
    const pitches = (visible.length ? visible : sequence.targets.slice(0, 10)).map((target) => target.m);
    const wantedLow = Math.min(...pitches) - 3;
    const wantedHigh = Math.max(...pitches) + 3;
    lowestPitch += (wantedLow - lowestPitch) * 0.08;
    highestPitch += (wantedHigh - highestPitch) * 0.08;
    if (!running) {
      lowestPitch = wantedLow;
      highestPitch = wantedHigh;
    }
  }

  function draw({ sequence, frames, now, running, voiceLag, spelling }) {
    if (!sequence || !sequence.targets.length) return;
    const density = devicePixelRatio || 1;
    const width = canvas.width / density;
    const height = canvas.height / density;
    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, width, height);
    fit(sequence, now, running);

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
    const active = running ? activeAt(sequence.targets, now) : null;
    sequence.targets.forEach((target) => {
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

    // The singer's voice: a line coloured by how close each frame is to the note it is aiming at.
    context.lineWidth = 4;
    context.lineCap = 'round';
    let previousPoint = null;
    for (const frame of frames) {
      const frameTime = frame.t - voiceLag;
      if (frameTime < now - 1.6 || frame.m == null) {
        previousPoint = null;
        continue;
      }
      const target = activeAt(sequence.targets, frameTime)
        || sequence.targets.reduce((a, b) => (Math.abs(b.t0 - frameTime) < Math.abs(a.t0 - frameTime) ? b : a));
      const cents = err(frame.m, target.m);
      const point = [xOf(frameTime), yOf(target.m + cents / 100)];
      if (previousPoint) {
        context.strokeStyle = Math.abs(cents) <= 25 ? colours.on : Math.abs(cents) <= 50 ? colours.near : colours.far;
        context.beginPath();
        context.moveTo(...previousPoint);
        context.lineTo(...point);
        context.stroke();
      }
      previousPoint = point;
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
