import type { Summary } from "./types.js";

const CAPTION = "Traces per day (UTC), last 14 days";

// Geometry in viewBox units. The stylesheet scales the SVG to its box; every
// size here is an SVG attribute because the CSP blocks style="".
const WIDTH = 560;
const HEIGHT = 180;
const TOP = 20;
const BOTTOM = 24;
const SIDE = 4;
const GAP = 6;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const BASELINE = HEIGHT - BOTTOM;

type Daily = Summary["daily"];

/** The image's accessible name: the caption, the date range and every day's count, unformatted. */
export function chartLabel(daily: Daily): string {
  const first = daily[0]?.date ?? "";
  const last = daily.at(-1)?.date ?? "";
  return `${CAPTION}, from ${first} to ${last}: ${daily.map((day) => day.traceCount).join(", ")}`;
}

// The time chart (spec #4, Page › Data › Chart): one bar per UTC day, oldest
// first, with the first and last dates under the baseline.
export function DailyChart({ daily }: { daily: Daily }) {
  const max = Math.max(0, ...daily.map((day) => day.traceCount));
  const scale = Math.max(1, max);
  const slot = (WIDTH - 2 * SIDE) / Math.max(1, daily.length);
  const barWidth = Math.max(1, slot - GAP);
  const first = daily[0];
  const last = daily.at(-1);

  return (
    <figure className="chart">
      <figcaption className="chart-caption">{CAPTION}</figcaption>
      <svg
        className="chart-svg"
        role="img"
        aria-label={chartLabel(daily)}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        preserveAspectRatio="xMidYMid meet"
      >
        <text className="chart-axis" x={SIDE} y={TOP - 6}>
          {`max ${max}`}
        </text>
        {daily.map((day, i) => {
          const height = (day.traceCount / scale) * PLOT_HEIGHT;
          return (
            <rect
              key={day.date}
              className="chart-bar"
              x={SIDE + i * slot + GAP / 2}
              y={BASELINE - height}
              width={barWidth}
              height={height}
              rx={2}
            />
          );
        })}
        <line className="chart-baseline" x1={SIDE} x2={WIDTH - SIDE} y1={BASELINE} y2={BASELINE} />
        {first && (
          <text className="chart-axis" x={SIDE} y={HEIGHT - 6}>
            {first.date}
          </text>
        )}
        {last && daily.length > 1 && (
          <text className="chart-axis" x={WIDTH - SIDE} y={HEIGHT - 6} textAnchor="end">
            {last.date}
          </text>
        )}
      </svg>
    </figure>
  );
}
