import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chartLabel } from "./DailyChart.js";
import { DataView } from "./DataView.js";
import type { Summary } from "./types.js";

const daily = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-11-${String(6 + i).padStart(2, "0")}`,
  traceCount: i === 13 ? 1_234 : i,
}));

const summary: Summary = {
  totals: {
    traceCount: 1_325,
    inputTokens: 1_000_000,
    outputTokens: 2_345,
    knownCostUsd: 1_234.5678,
    unknownCostCount: 3,
    avgDurationMs: 1_234,
    evaluationCount: 12,
    avgScore: 4.2,
  },
  episodes: [],
  daily,
};

const render = (s: Summary) => renderToStaticMarkup(<DataView summary={s} traces={[]} />);
const unescape = (html: string) => html.replaceAll("&lt;", "<").replaceAll("&amp;", "&");
// The text of each element with this tag, tags stripped.
const texts = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "gs"))].map((m) =>
    unescape(m[1].replace(/<[^>]+>/g, "")),
  );

describe("chartLabel", () => {
  it("names the range and every count, unformatted", () => {
    expect(chartLabel(daily)).toBe(
      "Traces per day (UTC), last 14 days, from 2026-11-06 to 2026-11-19: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1234",
    );
  });
});

describe("DataView", () => {
  it("shows a Totals region with five terms and their formatted values", () => {
    const html = render(summary);

    expect(html).toMatch(/<section[^>]*aria-labelledby="totals-heading"/);
    expect(html).toMatch(/<h2 id="totals-heading"[^>]*>Totals<\/h2>/);
    expect(texts(html, "dt")).toEqual([
      "Traces",
      "Tokens",
      "Known cost",
      "Avg duration",
      "Avg score",
    ]);
    expect(texts(html, "dd")).toEqual([
      "1,325",
      "1,002,345",
      "$1,234.5678+ 3 with unknown cost",
      "1,234 ms",
      "4.2 / 5from 12 evaluations",
    ]);
  });

  it("leaves out the notes when their counts are 0, and says no scores", () => {
    const html = render({
      ...summary,
      totals: { ...summary.totals, unknownCostCount: 0, evaluationCount: 0, avgScore: null },
    });

    expect(texts(html, "dd").slice(2)).toEqual(["$1,234.5678", "1,234 ms", "no scores"]);
    expect(html).not.toContain("unknown cost");
    expect(html).not.toContain("evaluations");
  });

  it("shows the chart as a captioned figure holding a named SVG image", () => {
    const html = render(summary);

    expect(texts(html, "figcaption")).toEqual(["Traces per day (UTC), last 14 days"]);
    expect(html).toMatch(/<figure[^>]*>\s*<figcaption/);
    expect(html).toContain(`<svg class="chart-svg" role="img" aria-label="${chartLabel(daily)}"`);
    expect(html.split("<rect").length - 1).toBe(14);
  });

  it("shows the Sending episodes then the Recent traces table below the chart", () => {
    const html = render(summary);

    expect(texts(html, "caption")).toEqual(["Sending episodes", "Recent traces"]);
    expect(html.indexOf("<figure")).toBeLessThan(html.indexOf("<table"));
  });

  it("writes no inline style and no status, alert or empty text", () => {
    const html = render(summary);

    expect(html).not.toContain("style=");
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("No traces yet");
  });
});
