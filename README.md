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
js/music.js           note names, toMidi / midiToHz / hzToMidi, parsePat (pattern language), rootsOf (round roots)
js/exercise.js        exercise model (normEx), sample exercises, buildSession (timeline of notes and piano plays), describeExercise
js/converter.js       parseLine / parseAll: coach's text -> exercise
js/pitch.js           detect: McLeod pitch detection on a window of samples
js/scoring.js         err, strictAt, activeAt, estimateLag, scoreNotes, summarizeSession (all of the report's numbers and wording)
js/session.js         session state machine, decideEnd (what stopping means), mic-failure wording (pure)
js/wakelock.js        Screen Wake Lock while a session runs
js/audio.js           audio context, synthesised piano, microphone chain, trill mode
js/store.js           localStorage wrapper and the storage key names
js/state.js           in-memory state shared by screens (exercises, default range, "practice all" queue)
js/ui/dom.js          $, esc, range-slider fill
js/ui/navigation.js   screen switching and the browser Back button
js/ui/library.js      library screen: journey stats, exercise list, history
js/ui/editor.js       add / edit screen, "Hear one round"
js/ui/photo.js        photo -> text (Tesseract, loaded on demand; needs a connection)
js/ui/practice.js     practice screen: session loop, mic, readouts
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
| `vp_hist` | array of `{name, pct, ts, date}`, newest first, at most 200 | One entry per finished run that heard the singer. `pct` = % of notes landed in tune, `ts` = `Date.now()`, `date` = short display date such as "Nov 27". |
| `vp_def` | `{start, end}` (MIDI note numbers) | Range used when a converted line names no starting note. Default `{start: 48, end: 55}` (C3 to G3). |
| `vp_lat` | number, seconds (0 to 0.5) | Picture delay set with the slider. Missing/null = automatic. |
| `vp_vlag` | number, seconds | Voice lag learned from your sessions (default 0.15). |
| `vp_theme` | `""`, `"light"` or `"dark"` | Colour theme; empty = match the phone. |

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
  hold: 2 }              // beats a held (~) note lasts, 1 to 4
```

## Credits

Fonts: Nunito and Inter (Google Fonts, SIL Open Font License).
