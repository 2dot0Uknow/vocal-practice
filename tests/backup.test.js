// P5: export shape, import validation, migration of older backups, Merge and Replace rules, applying with rollback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_KEYS, BACKUP_APP, buildBackup, backupFileName, parseBackup, countsOf, describeCounts, mergeData, replaceData, applyWrites } from '../js/backup.js';
import { KEYS } from '../js/store.js';
import { CURRENT_SCHEMA } from '../js/migrate.js';
import { MAX_HISTORY } from '../js/history.js';
import { SAMPLES } from '../js/exercise.js';

const exercise = (id, name = id) => ({ id, name, pat: '1-3-5', vows: ['ah'], rootVow: '', start: 48, end: 53, top: false, both: false, step: 1, bpm: 90, hold: 2 });
const run = (ts, exId, pct = 80) => ({ name: exId, exId, pct, ts, date: 'Nov 27' });
const fullData = () => ({
  vp_ex: [exercise('a'), exercise('b')],
  vp_hist: [run(300, 'a'), run(200, 'b'), run(100, 'a')],
  vp_def: { start: 45, end: 52 },
  vp_lat: 0.2,
  vp_vlag: 0.18,
  vp_theme: 'dark',
  vp_onboarded: 1,
});
const fileOf = (overrides = {}) => JSON.stringify({ app: 'vocal-practice', schema: CURRENT_SCHEMA, exportedAt: '2026-11-27T09:00:00.000Z', data: fullData(), ...overrides });

test('P5: a backup carries every saved key (all of store KEYS except the schema number)', () => {
  assert.deepEqual([...BACKUP_KEYS].sort(), ['vp_def', 'vp_ex', 'vp_hist', 'vp_lat', 'vp_onboarded', 'vp_theme', 'vp_vlag']);
  assert.ok(!BACKUP_KEYS.includes(KEYS.schema));
  assert.equal(BACKUP_KEYS.length, Object.keys(KEYS).length - 1, 'a key added to store.js is added to backups too');
});

test('P5: export has the agreed shape', () => {
  const data = fullData();
  const backup = buildBackup((key) => data[key], new Date('2026-11-27T09:30:00Z'));
  assert.deepEqual(Object.keys(backup), ['app', 'schema', 'exportedAt', 'data']);
  assert.equal(backup.app, BACKUP_APP);
  assert.equal(backup.app, 'vocal-practice');
  assert.equal(backup.schema, CURRENT_SCHEMA);
  assert.equal(backup.exportedAt, '2026-11-27T09:30:00.000Z');
  assert.deepEqual(backup.data, data);
});

test('P5: export leaves out keys with no saved value, so "automatic" stays automatic', () => {
  const backup = buildBackup((key) => ({ vp_ex: [exercise('a')], vp_lat: null, vp_theme: '' })[key]);
  assert.deepEqual(Object.keys(backup.data).sort(), ['vp_ex', 'vp_theme']);   // an empty theme means "match the phone" and is kept
});

test('P5: the file name is vocal-practice-backup-YYYY-MM-DD.json in the phone\'s own date', () => {
  assert.equal(backupFileName(new Date(2026, 10, 27, 23, 59)), 'vocal-practice-backup-2026-11-27.json');
  assert.equal(backupFileName(new Date(2027, 0, 5)), 'vocal-practice-backup-2027-01-05.json');
});

test('import: a good file is accepted and summarised', () => {
  const result = parseBackup(fileOf());
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, fullData());
  assert.deepEqual(result.counts, { exercises: 2, sessions: 3 });
  assert.equal(describeCounts(result.counts), '2 exercises, 3 sessions');
  assert.equal(describeCounts({ exercises: 1, sessions: 1 }), '1 exercise, 1 session');
  assert.equal(describeCounts({ exercises: 12, sessions: 48 }), '12 exercises, 48 sessions');
});

test('import: export then import round-trips', () => {
  const data = fullData();
  const text = JSON.stringify(buildBackup((key) => data[key]));
  assert.deepEqual(parseBackup(text).data, data);
});

test('import: a file with only some keys is fine', () => {
  const result = parseBackup(fileOf({ data: { vp_ex: [exercise('a')] } }));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data), ['vp_ex']);
  assert.deepEqual(result.counts, { exercises: 1, sessions: 0 });
});

test('import: keys the app does not know are ignored, not saved', () => {
  const result = parseBackup(fileOf({ data: { ...fullData(), vp_other: 5, evil: '<script>' } }));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data).sort(), [...BACKUP_KEYS].sort());
});

test('import: wrong app, not JSON, not an object: friendly "not a backup" message', () => {
  for (const text of [fileOf({ app: 'something-else' }), '{"schema":2,"data":{}}', 'not json at all', '[]', 'null', '42', '']) {
    const result = parseBackup(text);
    assert.equal(result.ok, false, text);
    assert.match(result.message, /doesn't look like a Vocal Practice backup/);
  }
});

test('import: a newer schema is refused with a message about updating', () => {
  const result = parseBackup(fileOf({ schema: CURRENT_SCHEMA + 1 }));
  assert.equal(result.ok, false);
  assert.match(result.message, /newer version of the app/);
});

test('import: malformed contents are refused as damaged, whichever part is wrong', () => {
  const bad = [
    { schema: 'two' }, { schema: 0 }, { schema: 1.5 }, { schema: undefined },
    { data: null }, { data: [] }, { data: 'x' },
    { data: { vp_ex: 'nope' } },
    { data: { vp_ex: [exercise('a'), 'x'] } },
    { data: { vp_ex: [{ id: 'a' }] } },
    { data: { vp_ex: [{ ...exercise('a'), start: 'C3' }] } },
    { data: { vp_ex: [{ ...exercise('a'), vows: 'ah' }] } },
    { data: { vp_hist: {} } },
    { data: { vp_hist: [1, 2] } },
    { data: { vp_hist: [{ name: 'x', ts: 'yesterday' }] } },
    { data: { vp_def: { start: 'C3', end: 55 } } },
    { data: { vp_def: [48, 55] } },
    { data: { vp_lat: 'fast' } },
    { data: { vp_lat: -1 } },
    { data: { vp_vlag: 'slow' } },
    { data: { vp_theme: 'purple' } },
    { data: { vp_onboarded: 'yes' } },
  ];
  for (const overrides of bad) {
    const result = parseBackup(fileOf(overrides));
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.match(result.message, /damaged|doesn't look like/);
  }
});

test('import: an older backup (schema 1) is migrated: history gets the exercise ids, nothing is lost', () => {
  const old = {
    vp_ex: [exercise('a', 'Siren'), exercise('b', 'Scale')],
    vp_hist: [{ name: 'Siren', pct: 70, ts: 300, date: 'Nov 3', extra: 'kept' }, { name: 'Gone', pct: 50, ts: 200, date: 'Nov 2' }],
    vp_theme: 'light',
  };
  const result = parseBackup(fileOf({ schema: 1, data: old }));
  assert.equal(result.ok, true);
  assert.equal(result.schema, 1);
  assert.deepEqual(result.data.vp_hist, [{ name: 'Siren', pct: 70, ts: 300, date: 'Nov 3', extra: 'kept', exId: 'a' }, { name: 'Gone', pct: 50, ts: 200, date: 'Nov 2' }]);
  assert.deepEqual(result.data.vp_ex, old.vp_ex);
  assert.equal(result.data.vp_theme, 'light');
  assert.deepEqual(result.counts, { exercises: 2, sessions: 2 });
});

test('import: an older backup with no exercises links history against the built-in samples, like the app does', () => {
  const result = parseBackup(fileOf({ schema: 1, data: { vp_hist: [{ name: SAMPLES[0].name, pct: 60, ts: 5, date: 'x' }] } }));
  assert.equal(result.data.vp_hist[0].exId, SAMPLES[0].id);
});

// ---- Merge ----

test('merge: exercises by id, what is on the phone is kept and new ones come after it', () => {
  const mine = [exercise('a', 'My A'), exercise('c', 'My C')];
  const incoming = { vp_ex: [exercise('a', 'Backup A'), exercise('b', 'Backup B')] };
  const writes = mergeData({ exercises: mine, history: [] }, incoming);
  assert.deepEqual(writes.vp_ex.map((e) => [e.id, e.name]), [['a', 'My A'], ['c', 'My C'], ['b', 'Backup B']]);
});

test('merge: when no exercise is new the library is not rewritten', () => {
  const writes = mergeData({ exercises: [exercise('a')], history: [] }, { vp_ex: [exercise('a')] });
  assert.ok(!('vp_ex' in writes));
});

test('merge: history is the union by ts + exercise, newest first; the phone\'s copy wins a duplicate', () => {
  const mine = [run(300, 'a', 90), run(100, 'a', 50)];
  const incoming = { vp_hist: [run(300, 'a', 10), run(300, 'b', 70), run(200, 'a', 60), run(50, 'b', 40)] };
  const merged = mergeData({ exercises: [], history: mine }, incoming).vp_hist;
  assert.deepEqual(merged.map((e) => [e.ts, e.exId, e.pct]), [[300, 'a', 90], [300, 'b', 70], [200, 'a', 60], [100, 'a', 50], [50, 'b', 40]]);
});

test('merge: history is capped at 200, keeping the newest', () => {
  const many = (from, count) => Array.from({ length: count }, (_, i) => run(from + i, 'a'));
  const merged = mergeData({ exercises: [], history: many(1000, 150) }, { vp_hist: many(5000, 150) }).vp_hist;
  assert.equal(merged.length, MAX_HISTORY);
  assert.equal(merged[0].ts, 5149);
  assert.ok(merged.every((entry, i) => i === 0 || merged[i - 1].ts >= entry.ts), 'sorted newest first');
  assert.equal(merged.at(-1).ts, 1000 + 150 - 50, 'the oldest 100 of the 300 were dropped');
});

test('merge: entries with no timestamp survive, are not collapsed together, and sort last', () => {
  const merged = mergeData({ exercises: [], history: [{ name: 'Old', pct: 1, date: 'Oct 1' }] }, { vp_hist: [{ name: 'Older', pct: 2, date: 'Sep 1' }, run(10, 'a'), { name: 'Old', pct: 1, date: 'Oct 1' }] }).vp_hist;
  assert.deepEqual(merged.map((e) => e.name), ['a', 'Old', 'Older']);
});

test('merge: settings on the phone are left alone', () => {
  const writes = mergeData({ exercises: [], history: [] }, fullData());
  assert.deepEqual(Object.keys(writes).sort(), ['vp_ex', 'vp_hist']);
});

test('merge never changes its inputs', () => {
  const mine = { exercises: [exercise('a')], history: [run(2, 'a')] };
  const incoming = { vp_ex: [exercise('b')], vp_hist: [run(1, 'b')] };
  const before = JSON.stringify([mine, incoming]);
  mergeData(mine, incoming);
  assert.equal(JSON.stringify([mine, incoming]), before);
});

// ---- Replace and applying ----

test('replace: every key takes the backup\'s value and a key the backup lacks is cleared', () => {
  const writes = replaceData({ vp_ex: [exercise('z')], vp_theme: 'dark' });
  assert.deepEqual(Object.keys(writes).sort(), [...BACKUP_KEYS].sort());
  assert.deepEqual(writes.vp_ex, [exercise('z')]);
  assert.equal(writes.vp_theme, 'dark');
  assert.equal(writes.vp_hist, undefined);
  assert.equal(writes.vp_lat, undefined);
});

function fakeStore(initial = {}, failOn = null) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key, fallback) => (data.has(key) ? data.get(key) : fallback),
    set(key, value) {
      if (key === failOn) return false;
      data.set(key, value);
      return true;
    },
    remove: (key) => data.delete(key),
  };
}

test('apply: saves the values, clears the undefined ones and writes the schema number', () => {
  const target = fakeStore({ vp_ex: [exercise('old')], vp_lat: 0.3, vp_hist: [run(1, 'old')] });
  assert.equal(applyWrites(target, replaceData({ vp_ex: [exercise('new')], vp_theme: 'dark' })), true);
  assert.deepEqual(target.get('vp_ex'), [exercise('new')]);
  assert.equal(target.get('vp_theme'), 'dark');
  assert.equal(target.data.has('vp_lat'), false);
  assert.equal(target.data.has('vp_hist'), false);
  assert.equal(target.get('vp_schema'), CURRENT_SCHEMA);
});

test('apply: if a save fails, everything is put back and false is returned', () => {
  const start = { vp_ex: [exercise('old')], vp_hist: [run(1, 'old')], vp_lat: 0.3 };
  const target = fakeStore(start, 'vp_hist');
  assert.equal(applyWrites(target, replaceData({ vp_ex: [exercise('new')], vp_hist: [run(9, 'new')], vp_theme: 'dark' })), false);
  assert.deepEqual(Object.fromEntries(target.data), start);
});

test('apply: a failing schema write also rolls back', () => {
  const start = { vp_ex: [exercise('old')] };
  const target = fakeStore(start, 'vp_schema');
  assert.equal(applyWrites(target, { vp_ex: [exercise('new')] }), false);
  assert.deepEqual(Object.fromEntries(target.data), start);
});

test('countsOf copes with missing keys', () => {
  assert.deepEqual(countsOf({}), { exercises: 0, sessions: 0 });
});
