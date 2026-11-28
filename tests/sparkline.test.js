// F9: the report's sparkline geometry and wording (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparkline, SPARK_WIDTH, SPARK_HEIGHT } from '../js/sparkline.js';

test('F9: fewer than 2 runs: nothing to draw', () => {
  assert.equal(sparkline([]), null);
  assert.equal(sparkline([55]), null);
});

test('F9: the label names the first and last of the window', () => {
  assert.equal(sparkline([40, 55, 72]).label, 'Last 3 runs: 40% to 72%');
  assert.equal(sparkline([10, 20]).label, 'Last 2 runs: 10% to 20%');
});

test('F9: only the last ten runs are used, newest last', () => {
  const runs = Array.from({ length: 14 }, (_, i) => 10 + i * 5);   // 10 ... 75
  const line = sparkline(runs);
  assert.equal(line.count, 10);
  assert.equal(line.label, 'Last 10 runs: 30% to 75%');
  assert.equal(line.points.length, 10);
});

test('F9: points run left to right inside the box, higher percent is higher up, newest dot is last', () => {
  const line = sparkline([40, 80, 60]);
  const xs = line.points.map((p) => p.x);
  assert.deepEqual(xs, [4, SPARK_WIDTH / 2, SPARK_WIDTH - 4]);
  const [first, second, third] = line.points;
  assert.ok(second.y < third.y && third.y < first.y);   // 80 above 60 above 40 (y grows downwards)
  line.points.forEach((p) => assert.ok(p.y >= 0 && p.y <= SPARK_HEIGHT && p.x >= 0 && p.x <= SPARK_WIDTH));
  assert.equal(line.path, line.points.map((p) => `${p.x},${p.y}`).join(' '));
});

test('F9: equal runs make a flat line in the middle; a tiny wobble is not stretched to the full height', () => {
  const flat = sparkline([50, 50, 50]);
  assert.ok(flat.points.every((p) => p.y === SPARK_HEIGHT / 2));
  const wobble = sparkline([50, 52]);
  assert.ok(wobble.points[0].y - wobble.points[1].y < (SPARK_HEIGHT - 8) * 0.2);
});
