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
`tests/browser/scenario.cjs` if yours differ). The browser is started with a fake microphone. The service worker is blocked in every check except `offline-checks`
(`openApp(url, {serviceWorker: true})` lets it register), so the cache cannot make the other checks depend on each other.

```
node tests/browser/check-app.cjs                  # tour every screen; fails on any console/page error
node tests/browser/session-checks.cjs            # start/stop, double tap, Back, hidden page, mic failure, picture-delay reset (also run by check-app)
node tests/browser/converter-checks.cjs          # (run by check-app) converter lines, guess notes, Eb spelling, Save/Convert feedback
node tests/browser/history-checks.cjs            # (run by check-app) schema-1 data migrates to 2, new history fields, rename keeps history
node tests/browser/scoring-checks.cjs         # (run by check-app) octave-off scoring, piano-leak notice, narrow-band tone rows, ?debug=1 download
node tests/browser/polish-checks.cjs         # (run by check-app) recorded piano (17 samples, limiter, fallback), practice layout at 412x915, round line, fade to a dash, reorder / duplicate / undo, Hear one round, set summary, sparkline, first-launch card, theme label
node tests/browser/polish-checks.cjs --shots out/   # same, and screenshots of library, practice and report in light and dark
node tests/browser/flow-checks.cjs               # (run by check-app) Pause / Resume, Again, Skip, skip the last round; which piano notes were scheduled and cancelled
node tests/browser/perf-checks.cjs               # (check-app --perf) plays a 24-round arpeggio to the end (~2 min): oscillators created vs alive, analyses per second, report delay
node tests/browser/a11y-checks.cjs [--shots out/]  # (run by check-app) accessibility audit of every screen in both themes (names, ids, headings, focus, contrast >= 4.5), plus cell cues, labels, roll labels / glow, theme-color, favicon, no inline styles, fades and the percent count-up
node tests/browser/offline-checks.cjs [--shots out/]  # (run by check-app) service worker, offline session, update toast, installability, export / import
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
styles.css            all styles (design intent in the comment at the top; @font-face for the self-hosted fonts)
manifest.webmanifest  install info (name, icons, colours; relative start_url / scope so it works under /vocal-practice/ and on localhost)
sw.js                 the service worker (a module): caches the app's own files, offline-first; waits for a tap before updating
icons/                app icons 192, 512 and maskable 512 (tools/make-icons.cjs drew them once from favicon.svg)
fonts/                Nunito and Inter as Latin WOFF2 (tools/make-fonts.sh shows how they were made) and their OFL licences
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
js/piano.js           the recorded piano's maths: which sample for a note, playbackRate, envelope times (pure)
js/flow.js            round line, "Ready…" count-in, when readouts fade, set summary rows (pure)
js/library-ops.js     reorder / duplicate / delete + undo, first-launch range and re-basing the samples (pure)
js/sparkline.js       the report's last-ten-runs line: geometry and label (pure)
js/audio.js           audio context, recorded piano (samples loaded lazily; synthesised piano as the fallback) behind a limiter, microphone chain, trill mode
js/version.js         APP_VERSION, the one number to change to ship an update
js/precache.js        the explicit list of files sw.js stores (tests/precache.test.js checks it against the disk)
js/backup.js          Export / Import: file shape, validation, Merge and Replace rules (pure)
js/persist.js         asks the browser to keep the storage (navigator.storage.persist, once)
js/store.js           localStorage wrapper and the storage key names; set() returns false on failure and the first failure of a visit is reported
js/migrate.js         migrate(storage): data-shape version (vp_schema) and the steps that bring saved data up to date
js/history.js         history entries (what a run saves), previousRunsOf (by exercise id), the 200-entry cap
js/state.js           in-memory state shared by screens (exercises, default range, "practice all" queue)
js/ui/dom.js          $, esc, range-slider fill
js/ui/navigation.js   screen switching and the browser Back button
js/ui/library.js      library screen: journey stats, exercise list, history
js/ui/editor.js       add / edit screen, "Hear one round"
js/ui/photo.js        photo -> text (Tesseract, loaded on demand; needs a connection)
js/ui/practice.js     practice screen: scheduler tick (places rounds, plays the piano ahead), 20 ms analysis timer, drawing loop, Pause / Again / Skip buttons
js/ui/roll.js         the pitch roll canvas (round labels, held-in-tune glow; fonts and sizes from the --roll-* CSS properties)
js/ui/report.js       report screen: HTML from summarizeSession(), saves history
js/ui/toast.js        the bottom message with Undo
js/ui/data.js         "Your data" section: Export, Import, Merge / Replace buttons
js/ui/update.js       registers sw.js; the "Update ready, tap to reload" toast
js/ui/theme.js        theme button (shows Auto / Light / Dark)
favicon.svg / .png    the sun mark (tools/make-favicon.cjs made the PNG once with sharp; it is committed, nothing builds it)
tests/                node --test files (contrast.test.js measures every text / fill pair from styles.css); helpers/ (synthetic signals), fixtures/, tools/ (generator), browser/ (Playwright)
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
| `vp_onboarded` | `1` | The first-launch "comfortable range" card was answered or dismissed; it is never shown again. A flag, not a data shape, so no migration. |
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

## The piano

`audio/piano/` has 17 mono MP3 samples (C, D#, F#, A in each octave, C2 to C6, 2.8 s each with a 0.4 s fade, 392 KB in all).
They are fetched and decoded once, on the first tap anywhere, or when a practice screen or "Hear one round" needs them, and kept for
the page's life. A note plays the nearest sample at `playbackRate = 2^((midi - sampleMidi)/12)` (never more than one semitone away),
with a 5 ms attack and a 0.25 s release from the end of the note, so held notes end cleanly. A note longer than 2 s also gets a soft sustain layer (a sine on the pitch plus a quiet octave, low-passed, about -18 dB under the
sample, fading in from 1.2 s to 1.6 s) that keeps the pitch audible to the end and releases with the sample; nothing loops. It is part of the
note's handle, so Pause / Again / Skip fade it with the sample. Until the samples are ready, or if loading fails (a
`console.warn`, no error), the original synthesised piano plays, unchanged. Everything goes through a compressor used as a limiter
(threshold -10 dB, ratio 12, 3 ms attack, 0.25 s release) after the volume slider. Chrome itself prints "Failed to load resource" for a
sample that cannot be fetched; the app cannot silence that line.

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

## Offline, installing and updates

The app is installable (manifest + icons; Chrome on Android offers "Install app" / "Add to Home screen") and works with no connection after
the first visit. `sw.js` stores every file in `js/precache.js` (the app, the fonts, the icons and all 17 piano samples, about 0.6 MB) when a version
installs, answers those from the cache first, and sends everything else to the network. The Tesseract text reader (photo import) stays online-only:
it is fetched from its CDN only when you use "Photo or screenshot".

### Releasing an update

Change the one line in `js/version.js` (the release date, `YYYY.MM.DD`, plus a letter for a second release the same day: `2026.11.27b`), commit, push.
That is all. The version is in the cache name, so the browser sees a different `sw.js` (it re-checks the files `sw.js` imports), installs the new
cache alongside the old one, and phones that have the app open show "Update ready, tap to reload" (on the library, editor and report, never
on a practice screen, so a session is not interrupted; it appears when the session ends). Tapping it switches to the new version and reloads;
the old cache is deleted when the new version activates. The version also shows small at the bottom of the library.
If a file is added to or removed from the app, edit `js/precache.js` too: `node --test` fails until the list matches the files on disk.
Without a version bump, an edited file is not picked up by phones that already have the app (they keep the cached copy).

To look at the site without the service worker, add `?nosw=1` to the address (it only skips registering; use Chrome's
Application > Service Workers > Unregister to remove an installed one). In the browser checks the worker is blocked unless a check asks for it.

### Your data: backup and restore

The "Your data" section at the bottom of the library has **Export backup** (downloads `vocal-practice-backup-YYYY-MM-DD.json`) and
**Import backup**. The file is `{app: "vocal-practice", schema, exportedAt, data: {vp_ex, vp_hist, vp_def, vp_lat, vp_vlag, vp_theme, vp_onboarded}}`
(a key is left out when nothing is saved for it). Import checks the file (right app, a data shape this version knows, the right kinds of values), runs an
older backup through the same migrations as saved data, shows "12 exercises, 48 sessions" and asks:
**Merge** keeps what is on the phone, adds exercises with a new id, and unions the history (same time + exercise counts once), newest first, at most 200; settings are untouched.
**Replace** makes the phone match the backup exactly (a setting the backup lacks goes back to automatic). If a save fails halfway, the earlier data is put back.
After the first successful save of the library the app asks the browser to keep its storage (`navigator.storage.persist()`), once per visit and not at all when already granted.
If the browser ever refuses a save (storage full), a toast says so once per visit and suggests exporting a backup.

### Follow-up: Tesseract integrity hash

The script is pinned to `tesseract.js@5.1.1` and loaded with `crossorigin`, but without a Subresource Integrity hash: one cannot be computed without fetching the exact file,
and it is not safe to invent one. To add it, on a machine with a connection run
`curl -s https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js | openssl dgst -sha384 -binary | openssl base64 -A`
and set `script.integrity = 'sha384-<that output>'` next to `script.crossOrigin` in `js/ui/photo.js`. (Tesseract also fetches its worker, WASM core and language data at run time; those are not covered by this hash.)

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

Fonts: Nunito (Nunito Project Authors) and Inter (Inter Project Authors), SIL Open Font License 1.1, served from `fonts/` as trimmed Latin variable WOFF2 files.
Licences: `fonts/OFL-Nunito.txt`, `fonts/OFL-Inter.txt`; `tools/make-fonts.sh` shows how the files were made.

Piano: Salamander Grand Piano by Alexander Holm, CC BY 3.0, trimmed and converted to mono.
(`audio/piano/`, see `audio/piano/LICENSE.txt`; `tools/make-piano-samples.sh` shows exactly how the 17 files were made.)
