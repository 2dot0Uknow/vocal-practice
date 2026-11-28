# Vocal Practice

A small web app that turns a vocal coach's written exercises into piano-guided drills.
Paste or type the exercises (or photograph them), and the app plays each pattern up a range
on a piano, listens through the microphone, draws your pitch against the target notes, and
gives you a short, encouraging session report.

Live at https://2dot0uknow.github.io/vocal-practice/ (GitHub Pages serves the repo root).

There is no framework, no build step and no npm dependency: plain HTML, CSS and ES modules, served as they are.

## Run it locally

ES modules do not load from `file://`, so serve the folder:

```
python3 -m http.server 8000
```

then open http://localhost:8000/. The microphone only works on `localhost` or `https://`.

## Run the tests

Needs Node 22 and nothing else (no `npm install`):

```
node --test
```

The tests cover the pure logic (music maths, the text converter, pitch detection, scoring and the
report's numbers, storage keys). Most of the expected values in `tests/fixtures/original-behaviour.json`
were produced by running the original single-file app (commit `2aaf0bd`) through
`tests/tools/generate-expected.mjs`, so they pin down what the app did before it was split into modules.
Where the app does something plainly wrong today, the test says so ("KNOWN TODAY") and a later fix
updates it on purpose.

GitHub Actions runs `node --test` on every push and pull request (`.github/workflows/test.yml`).

## Browser checks (not run in CI)

These drive real headless Chrome through the whole app with Playwright. They expect Playwright at
`/opt/npm-tools/node_modules/playwright` and Chrome at `/usr/bin/google-chrome` (edit the two paths at the top of
`tests/browser/scenario.cjs` if yours differ). The browser is started with a fake microphone.

```
node tests/browser/check-app.cjs                  # tour every screen; fails on any console/page error
node tests/browser/session-checks.cjs            # start/stop, double tap, Back, hidden page, mic failure, picture-delay reset (also run by check-app)
node tests/browser/converter-checks.cjs          # (run by check-app) converter lines, guess notes, Eb spelling, Save/Convert feedback
node tests/browser/history-checks.cjs            # (run by check-app) schema-1 data migrates to 2, new history fields, rename keeps history
node tests/browser/scoring-checks.cjs         # (run by check-app) octave-off scoring, piano-leak notice, narrow-band tone rows, ?debug=1 download
node tests/browser/flow-checks.cjs               # (run by check-app) Pause / Resume, Again, Skip, skip the last round; which piano notes were scheduled and cancelled
node tests/browser/perf-checks.cjs               # (check-app --perf) plays a 24-round arpeggio to the end (~2 min): oscillators created vs alive, analyses per second, report delay
node tests/browser/check-app.cjs --shots out/     # same, and save screenshots into out/
node tests/browser/compare-old-new.cjs            # same tour on commit 2aaf0bd and on your working tree; fails if anything differs
node tests/browser/compare-old-new.cjs <commit>   # compare against another baseline commit
```

`compare-old-new` compares the library text, the converted cards and editor summaries, localStorage contents,
the screens' structure and pixel-identical screenshots. It is meant for changes that must not alter behaviour;
when a later change alters behaviour on purpose, expect (and review) the differences it reports.

## Module map

```
index.html            markup only
styles.css            all styles (design intent in the comment at the top)
js/main.js            entry point: loads data, wires the screens together
js/music.js           note names (sharps, flats or automatic spelling), toMidi / midiToHz / hzToMidi, parsePat (pattern language), rootsOf (round roots)
js/exercise.js        exercise model (normEx), sample exercises, planRounds / placeRound (a round's notes relative to its start, then on the clock), buildSession (the old whole-timeline layout, kept as the reference for tests), describeExercise
js/run.js             a practice run as rounds placed on the song clock one at a time: Pause (at the round boundary) / Resume / Again / Skip (pure)
js/scheduler.js       look-ahead piano scheduling (~2 s ahead, every ~25 ms) with cancel for notes that have not sounded (clock and audio calls handed in, so pure)
js/timeindex.js      binary-search helpers and the frame store: frames and targets are time-ordered, so drawing and scoring touch only their window
js/converter.js       parseLine / parseAll: coach's text -> exercise
js/pitch.js           detect: McLeod pitch detection on a window of samples
js/scoring.js         cents (as sung, no octave folding), err (folded; only for telling neighbouring notes apart), dropOctaveGlitches, strictAt, activeAt, estimateLag, scoreNotes, summarizeSession (all of the report's numbers and wording)
js/tone.js            tone as a trend against your own earlier runs of the same exercise + sound; narrow-band input detection (pure)
js/calibration.js     first-chord measurements: noise floor -> pitch gate, piano-leak detection (pure)
js/debug.js           the ?debug=1 session download: what goes in the file, and reading one back (pure)
js/session.js         session state machine, decideEnd (what stopping means), mic-failure wording (pure)
js/wakelock.js        Screen Wake Lock while a session runs
js/audio.js           audio context, synthesised piano, microphone chain, trill mode
js/store.js           localStorage wrapper and the storage key names
js/migrate.js         migrate(storage): data-shape version (vp_schema) and the steps that bring saved data up to date
js/history.js         history entries (what a run saves), previousRunsOf (by exercise id), the 200-entry cap
js/state.js           in-memory state shared by screens (exercises, default range, "practice all" queue)
js/ui/dom.js          $, esc, range-slider fill
js/ui/navigation.js   screen switching and the browser Back button
js/ui/library.js      library screen: journey stats, exercise list, history
js/ui/editor.js       add / edit screen, "Hear one round"
js/ui/photo.js        photo -> text (Tesseract, loaded on demand; needs a connection)
js/ui/practice.js     practice screen: scheduler tick (places rounds, plays the piano ahead), 20 ms analysis timer, drawing loop, Pause / Again / Skip buttons
js/ui/roll.js         the pitch roll canvas
js/ui/report.js       report screen: HTML from summarizeSession(), saves history
js/ui/theme.js        theme button
tests/                node --test files; helpers/ (synthetic signals), fixtures/, tools/ (generator), browser/ (Playwright)
```

Everything outside `js/ui/`, `js/audio.js`, `js/wakelock.js`, `js/main.js` and `js/state.js` is pure (no DOM, no audio, no storage)
and importable from Node.

## What is stored on the device (localStorage)

| Key | Shape | Meaning |
| --- | --- | --- |
| `vp_ex` | array of exercises (below) | The library. Missing = the three built-in samples are shown. |
| `vp_hist` | array of entries, newest first, at most 200 (below) | One entry per finished run that heard the singer. |
| `vp_def` | `{start, end}` (MIDI note numbers) | Range used when a converted line names no starting note. Default `{start: 48, end: 55}` (C3 to G3). |
| `vp_lat` | number, seconds (0 to 0.5) | Picture delay set with the slider. Missing/null = automatic. |
| `vp_vlag` | number, seconds | Voice lag learned from your sessions (default 0.15). |
| `vp_theme` | `""`, `"light"` or `"dark"` | Colour theme; empty = match the phone. |
| `vp_schema` | integer | Data-shape version. Absent = 1 (the original shape). Now 2. See "Migrations". |

A history entry:

```
{ name: "5-note scale",  // the exercise's name when it was sung (a label; renaming does not rewrite it)
  exId: "s1",            // id of the exercise it belongs to; absent on old entries that matched no exercise
  pct: 80, ts: 1764000000000, date: "Nov 27",   // % of notes landed in tune, Date.now(), short display date
  avgCents: 14,          // average cents off, ignoring sharp / flat
  lean: -6,              // signed average cents (negative = flat)
  steadiness: 8.2,       // typical wobble on held notes, cents
  clarity: 0.91,         // 0 to 1; null when the run had no tone notes (pure lip trill)
  ring: 0.12,            // null likewise
  topNote: 64,           // MIDI of the highest note landed within 50 cents; null if none
  rounds: 5, notes: 40,  // rounds completed, notes in the run
  sound: "ah" }          // the run's main sound (most common syllable; "" if none). Absent on older entries
```

Scoring changed in a later version (no octave folding, see "Scoring notes"), so `pct` of old and new runs is not perfectly comparable. `sound` is optional and needs no migration; `clarity` / `ring` are `null` for a run on a narrow-band mic.

Entries from before schema 2 have only `name, pct, ts, date` (plus `exId` once migrated). Everything that reads history
must cope with the other fields being absent.

## Scoring notes

- **No octave folding.** The singer is expected to sing in the piano's octave. A note is scored by its exact distance in cents
  (`cents()`); a voice about an octave away (1200 +/- 150 cents) is "off" (kept, large cents value, shown as 8vb / 8va) and
  gets a gentle tip when most notes are like that. Other frames more than 450 cents away are still left out of a note.
  A single frame (or two) an octave from agreeing neighbours is a detector glitch and is dropped before scoring and drawing.
- **Noise floor.** During the first cue chord the median RMS of the mic is measured; the pitch gate is 3 x that, kept between
  0.004 and 0.012 (today's value). Trill mode keeps its own fixed gate of 0.004: its mic chain is filtered and boosted, so the floor does not carry over.
- **Piano leak.** If, in the first chord, a confident pitch within 50 cents of a chord note (any octave) shows up in more than 40% of
  the analysed frames, a dismissible notice appears and the report says the score may be generous. Warning only.
- **Tone rows** (Clear tone, Ring) are a trend against the average of the newest 10 saved runs of the same exercise and the same
  `sound`, once there are 3. Clarity: more than 0.025 above / below is "clearer" / "airier". Ring: more than 25% (at least 0.015) of the average above / below is "brighter" / "softer".
  Before that: "Getting a baseline (n of 3)" and no tone tips. Narrow-band input (track sample rate 16 kHz or lower, or a median
  above-4-kHz / below-4-kHz energy ratio under 1e-5) hides the rows, tips and praise.

## Debug downloads and session fixtures

Open the app with `?debug=1` on the end of the address: the report then shows "Download session data", a JSON file with the
exercise, targets, pitch frames, voice lag, output latency, pitch gate, piano-leak flag, user agent and app version.
Put such files in `tests/fixtures/sessions/` (see the README there); `tests/sessions.test.js` runs each through `summarizeSession`.

## Migrations

`migrate()` (js/migrate.js) runs at startup before the data is loaded. It reads `vp_schema`, applies the steps in `STEPS`
in order, and writes the changed keys and then `vp_schema` only after every step worked. A step that throws, a write that
fails, or a version newer than the app knows leaves saved data exactly as it was (a `console.warn`, not an error) and the
app carries on with the in-memory result. Steps never drop what they do not understand and are safe to run twice.

- 1 to 2: adds `exId` to each history entry by matching `name` against today's exercises (the three built-in samples when
  nothing is saved yet). If several exercises share a name, the first wins. Unmatched entries stay without `exId`: they still
  count in the journey but do not feed "best yet" / "up from last time".

To add a step: append `{ from: N, run }` to `STEPS` and raise `CURRENT_SCHEMA`; add a test with a realistic fixture of the old shape.

An exercise:

```
{ id: "x...",            // unique id
  name: "5-note scale",
  pat: "1-2-3-4-5-4-3-2-1~",  // scale degrees, b/# prefix allowed, ~ = held note, degrees 1 to 15
  vows: ["ah"],          // sounds, one pass each (empty = a single pass on no particular sound)
  rootVow: "",           // optional different sound on degree 1
  start: 48, end: 55,    // MIDI numbers
  top: false,            // false: start..end are the starting notes; true: the whole range sung
  both: false,           // come back down after the top
  step: 1,               // semitones between rounds (1 or 2)
  bpm: 90,               // 30 to 200
  hold: 2,               // beats a held (~) note lasts, 1 to 4
  spell: "b" }           // optional: "b" (written with flats) or "#" (sharps). Absent = automatic: Db Eb Ab Bb, F#
```

## Credits

Fonts: Nunito and Inter (Google Fonts, SIL Open Font License).
