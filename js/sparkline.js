// F9: the report's little line of the last ten runs. Pure geometry and wording; the report turns it into an inline SVG.

export const SPARK_RUNS = 10;
export const SPARK_WIDTH = 120;
export const SPARK_HEIGHT = 32;
const PAD = 4;           // room for the dots at the edges
const MIN_SPAN = 20;     // percent points: a small wobble must not look like a big climb

/**
 * `percents` are the saved runs of one exercise, OLDEST FIRST. Returns null with fewer than 2 runs, else
 * {points: [{x, y}], path ("x,y x,y ..." for a polyline), label, count}. Only the last SPARK_RUNS are used, the last
 * point is the newest run. Higher is up (the SVG's y runs downwards, so it is flipped).
 */
export function sparkline(percents, width = SPARK_WIDTH, height = SPARK_HEIGHT) {
  const values = percents.slice(-SPARK_RUNS);
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(MIN_SPAN, high - low);
  const middle = (high + low) / 2;
  const bottom = middle - span / 2;
  const points = values.map((value, i) => ({
    x: round1(PAD + (i * (width - 2 * PAD)) / (values.length - 1)),
    y: round1(height - PAD - ((value - bottom) / span) * (height - 2 * PAD)),
  }));
  return {
    points,
    path: points.map((point) => `${point.x},${point.y}`).join(' '),
    label: `Last ${values.length} runs: ${values[0]}% to ${values[values.length - 1]}%`,
    count: values.length,
  };
}

const round1 = (value) => Math.round(value * 10) / 10;
