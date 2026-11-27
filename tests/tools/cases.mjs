// Inputs for the characterization tests. Shared by the generator (which runs them through
// the ORIGINAL code) and the tests (which run them through the current modules).

export const PLACEHOLDER_LINES = [
  '- Lip roll arpeggios, E2 - E flat 5',
  '- 1, 3, 2, 4, 3, 5, 4, 3, 2, 1 once with gee and once with gah',
  '- 1 3 5 hold octave, then 7, 8, 9 then down all the way back to 1',
  '- Intervals, 1,2,1,3,1,4, etc... to the octave. Eee on root, yah on the intervals',
];

export const OTHER_LINES = [
  '1 2 3 4 5 4 3 2 1 x2 on nay',
  '1-3-5 hold 5 for 4 beats',
  'Bb2 to F4 lip trills 1 3 5 3 1',
  'Sirens up to A4',
  '1. Five-note scale on mum, C3 to C4, whole steps',
  '* do re mi fa sol fa mi re do on gee',
  'Major scale from E3 up to E4 at 120 bpm',
  'Triad, up and back down, starting on G2 on ah',
  '9 note scale on oo with tempo 70',
  'Octave jumps with "ng"',
  'b3-5-#7 with zz',
  'Hum, A2 - A3, 1 2 3 2 1',
  'Straw phonation 1-5-1 starting on G2',
  'something with no pattern at all',
  '   ',
  '',
  '- Descending 5 4 3 2 1 down to 1 on vv, E4 to C4',
  '1 3 5 8 5 3 1 on lip trill, every half step',
  'Arpeggio on mee-may-mah, D3 - D4',
  '7-1 to 8 gee',
];

export const ALT_RANGE = { start: 50, end: 60 };
export const ALT_RANGE_LINES = [
  'Sirens up to A4',
  '1-3-5 on ah',
  'Lip trill arpeggio',
  'from C3 1 2 3 on nay',
];

export const PATTERN_INPUTS = [
  '1-3-5', '1 3 5~', '1,b3,#5~-8', '1', '', '16-1', '0-1', 'b3-5', '1-9-15', '1--3', 'abc', '1-2-x', '3~ 5~',
  '8-7-6-5-4-3-2-1~', '#1-b2', '1-15',
];

export const ROOT_EXERCISES = [
  { label: 'ascending half steps', pat: '1-3-5', start: 48, end: 55, top: false, both: false, step: 1 },
  { label: 'descending half steps', pat: '1-3-5', start: 55, end: 48, top: false, both: false, step: 1 },
  { label: 'whole steps', pat: '1-3-5', start: 48, end: 60, top: false, both: false, step: 2 },
  { label: 'both directions', pat: '1-3-5', start: 48, end: 52, top: false, both: true, step: 1 },
  { label: 'both with a single root', pat: '1-3-5', start: 48, end: 48, top: false, both: true, step: 1 },
  { label: 'top: whole range sung', pat: '1-3-5-8', start: 40, end: 76, top: true, both: false, step: 1 },
  { label: 'top reversed range', pat: '1-3-5-8', start: 76, end: 40, top: true, both: false, step: 2 },
  { label: 'top and both', pat: '1-5-8', start: 48, end: 72, top: true, both: true, step: 2 },
  { label: 'top: range narrower than pattern', pat: '1-3-5-8-10', start: 48, end: 52, top: true, both: false, step: 1 },
  { label: '48-round cap, ascending', pat: '1-3-5', start: 24, end: 100, top: false, both: false, step: 1 },
  { label: '48-round cap, descending', pat: '1-3-5', start: 100, end: 24, top: false, both: false, step: 1 },
  { label: '48-round cap, top', pat: '1-2', start: 24, end: 100, top: true, both: false, step: 1 },
  { label: '48-round cap, both', pat: '1-3-5', start: 24, end: 100, top: false, both: true, step: 1 },
];

export const TONE_SAMPLE_RATES = [48000, 44100];
export const TONE_FREQUENCIES = [82.41, 110, 196, 261.63, 330, 440, 523.25, 880, 1046.5];

export const SESSION_EXERCISES = {
  scale: { name: '5-note scale', pat: '1-2-3-4-5-4-3-2-1~', vows: ['ah'], rootVow: '', start: 48, end: 50, top: false, both: false, step: 1, bpm: 90, hold: 2 },
  twoPass: { name: 'Trill then ah', pat: '1-3~-5-3-1~', vows: ['lip trill', 'ah'], rootVow: 'ee', start: 48, end: 49, top: false, both: false, step: 1, bpm: 120, hold: 3 },
  sixNotes: { name: 'Six notes', pat: '1-2-3-4-5-8~', vows: ['gee', 'gah', 'mum'], rootVow: '', start: 50, end: 53, top: false, both: true, step: 1, bpm: 100, hold: 2 },
};

export const SINGER_SCENARIOS = {
  perfect: { lag: 0.2, offsetCents: 0, wobbleCents: 4, seed: 11 },
  sharp: { lag: 0.15, offsetCents: 30, wobbleCents: 8, seed: 12 },
  flatWithDropouts: { lag: 0.3, offsetCents: -40, wobbleCents: 10, dropEvery: 4, seed: 13 },
  octaveBelow: { lag: 0.2, offsetCents: 0, octaveShift: -12, wobbleCents: 4, seed: 14 },
  sparse: { lag: 0.2, offsetCents: 5, step: 0.25, seed: 15 },
  wobbly: { lag: 0.1, offsetCents: -10, wobbleCents: 45, seed: 16 },
  airy: { lag: 0.2, offsetCents: 3, wobbleCents: 3, clarity: 0.8, ring: 0.03, seed: 17 },
};
