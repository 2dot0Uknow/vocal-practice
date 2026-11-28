# Real session fixtures

Each `*.json` file here is one practice session, run through `summarizeSession()` by `tests/sessions.test.js`
(for now the test only checks that nothing throws; exact expectations can be added once there are real sessions).

## How to add a real session

1. Open the app with `?debug=1` on the end of the address, e.g. `https://2dot0uknow.github.io/vocal-practice/?debug=1`
   (or `http://localhost:8000/?debug=1` when serving locally).
2. Do a run to the end. On the report screen, tap **Download session data**.
3. Put the downloaded file in this folder (rename it to say what it is, e.g. `pixel-wired-headphones-scale.json`).
   Do not edit it. Nothing in it identifies you except the browser's `userAgent` string.
4. `node --test` now includes it.

## What is in a file

`exercise`, `targets` (the notes, in seconds on the song clock), `frames` (one per mic analysis, about 50 a second:
`t` seconds, `m` MIDI pitch or null, `c` clarity, `ring` brightness, `tr` trill mode), `voiceLag`, `outputLatency`,
`gate` (the pitch gate after the noise-floor measurement), `pianoLeak`, `narrowBand`, `micSampleRate`, `userAgent`, `appVersion`.

`synthetic-scale.json` is made up (a steady synthetic singer, 8 cents sharp, 0.2 s behind the piano), so the test always has something to run.
