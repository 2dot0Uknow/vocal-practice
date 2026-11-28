#!/usr/bin/env bash
# Builds audio/piano/*.mp3 from the Salamander Grand Piano V3 (CC BY 3.0, Alexander Holm).
# The source files are NOT part of this repo; SRC points at a local copy (Tone.js's audio/salamander folder).
# Re-run only if you want to regenerate the samples; the result is committed.
#
# One sample per minor third, C2 ... C6 (C, D#, F#, A in every octave): 17 files.
# For each: mono, first 2.8 s, a 0.4 s fade-out at the end, loudness matched, 64 kbps MP3.
#
# Loudness: the notes' level is measured over their first second (RMS, after the downmix) and every sample is
# gained to -20 dBFS RMS over that second, so neighbouring samples do not jump when the sampler switches between them.
# A brick-wall limiter at -1 dBFS keeps the loudest attacks from clipping after the gain.
#
# Why MP3: decodeAudioData handles it in every browser (Chrome on Android included), and ffmpeg's encoder delay is
# written into the file's Info tag, so the decoded sample starts on the note's attack (checked in tests/browser/piano-checks.cjs).
set -euo pipefail

SRC="${SRC:-/home/claude/vendor/tonejs-audio/salamander}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/audio/piano"
TARGET_DB=-20
MONO="pan=mono|c0=0.5*c0+0.5*c1"   # average of left and right
mkdir -p "$OUT"

for octave in 2 3 4 5; do
  for note in C Ds Fs A; do
    names+=("$note$octave")
  done
done
names+=("C6")

for name in "${names[@]}"; do
  # Pass 1: RMS level of the first second of the mono downmix.
  # (The downmix has to be in the filter chain: a plain -ac 1 is applied after the filters, so would not be measured.)
  level=$(ffmpeg -v error -t 1 -i "$SRC/$name.mp3" \
    -af "$MONO,astats=metadata=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null - \
    | grep RMS_level | tail -1 | cut -d= -f2)
  gain=$(awk -v target="$TARGET_DB" -v level="$level" 'BEGIN { printf "%.2f", target - level }')
  # Pass 2: mono, 2.8 s, gain, limiter, fade out over the last 0.4 s, MP3.
  ffmpeg -v error -y -i "$SRC/$name.mp3" -t 2.8 \
    -af "$MONO,volume=${gain}dB,alimiter=limit=0.89:level=disabled,afade=t=out:st=2.4:d=0.4" \
    -c:a libmp3lame -b:a 64k -ar 44100 "$OUT/$name.mp3"
  echo "$name  was ${level} dB, gain ${gain} dB"
done
du -cb "$OUT"/*.mp3 | tail -1
