import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EpisodesTable, RecentTracesTable } from "./Tables.js";
import type { RecentTrace, Summary } from "./types.js";

const unescape = (html: string) => html.replaceAll("&lt;", "<").replaceAll("&amp;", "&");
const strip = (html: string) => unescape(html.replace(/<[^>]+>/g, ""));
const matches = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);

const columnHeaders = (html: string) =>
  matches(html, /<th scope="col"[^>]*>(.*?)<\/th>/gs).map(strip);
const rowHeaders = (html: string) => matches(html, /<th scope="row"[^>]*>(.*?)<\/th>/gs).map(strip);
const bodyRows = (html: string) =>
  matches(html.split("<tbody>")[1] ?? "", /<tr[^>]*>(.*?)<\/tr>/gs);
const cells = (row: string) => matches(row, /<td[^>]*>(.*?)<\/td>/gs).map(strip);

const episodes: Summary["episodes"] = [
  {
    episode: "busy-episode",
    traceCount: 12_345,
    inputTokens: 1_000_000,
    outputTokens: 2_500,
    knownCostUsd: 1_234.5678,
    unknownCostCount: 3,
    avgDurationMs: 61_000,
    evaluationCount: 12,
    avgScore: 4.2,
  },
  {
    episode: "quiet-episode",
    traceCount: 1,
    inputTokens: 5,
    outputTokens: 0,
    knownCostUsd: 0.00004,
    unknownCostCount: 0,
    avgDurationMs: 7,
    evaluationCount: 0,
    avgScore: null,
  },
];

const trace = (over: Partial<RecentTrace>): RecentTrace => ({
  id: "00000000-0000-4000-8000-000000000001",
  runId: null,
  episode: "busy-episode",
  feature: "summarize",
  provider: "anthropic",
  model: "claude-haiku-5-5",
  inputTokens: 12_345,
  outputTokens: 678,
  durationMs: 1_234,
  costUsd: 0.0123,
  status: "ok",
  startedAt: "2026-11-19T14:03:07.000Z",
  ...over,
});

const traces = [
  trace({}),
  trace({
    id: "00000000-0000-4000-8000-000000000002",
    feature: "tiny",
    inputTokens: 5,
    outputTokens: 0,
    durationMs: 7,
    costUsd: 0.00004,
    status: "error",
    startedAt: "2026-11-19T14:02:00.500Z",
  }),
  trace({
    id: "00000000-0000-4000-8000-000000000003",
    episode: "quiet-episode",
    feature: "unpriced",
    provider: "openai",
    model: "gpt-test",
    inputTokens: 1_000_000,
    outputTokens: 2_500,
    durationMs: 61_000,
    costUsd: null,
  }),
];

describe("EpisodesTable", () => {
  const html = renderToStaticMarkup(<EpisodesTable episodes={episodes} />);

  it("is captioned and has its column headers in order", () => {
    expect(html).toContain("<caption");
    expect(strip(matches(html, /<caption[^>]*>(.*?)<\/caption>/gs)[0] ?? "")).toBe(
      "Sending episodes",
    );
    expect(columnHeaders(html)).toEqual([
      "Episode",
      "Traces",
      "Input tokens",
      "Output tokens",
      "Known cost",
      "Unknown cost",
      "Avg duration",
      "Evaluations",
      "Avg score",
    ]);
  });

  it("has one row per episode in API order, the episode as row header", () => {
    expect(rowHeaders(html)).toEqual(["busy-episode", "quiet-episode"]);
    expect(bodyRows(html).map(cells)).toEqual([
      ["12,345", "1,000,000", "2,500", "$1,234.5678", "3", "61,000 ms", "12", "4.2"],
      ["1", "5", "0", "<$0.0001", "0", "7 ms", "0", "no scores"],
    ]);
  });
});

describe("RecentTracesTable", () => {
  const html = renderToStaticMarkup(<RecentTracesTable traces={traces} />);

  it("is captioned and has its column headers in order", () => {
    expect(strip(matches(html, /<caption[^>]*>(.*?)<\/caption>/gs)[0] ?? "")).toBe("Recent traces");
    expect(columnHeaders(html)).toEqual([
      "Started (UTC)",
      "Episode",
      "Feature",
      "Model",
      "Input tokens",
      "Output tokens",
      "Duration",
      "Cost",
      "Status",
    ]);
  });

  it("has one formatted row per trace in API order", () => {
    expect(rowHeaders(html)).toEqual([]);
    expect(bodyRows(html).map(cells)).toEqual([
      [
        "2026-11-19 14:03:07",
        "busy-episode",
        "summarize",
        "claude-haiku-5-5",
        "12,345",
        "678",
        "1,234 ms",
        "$0.0123",
        "OK",
      ],
      [
        "2026-11-19 14:02:00",
        "busy-episode",
        "tiny",
        "claude-haiku-5-5",
        "5",
        "0",
        "7 ms",
        "<$0.0001",
        "Error",
      ],
      [
        "2026-11-19 14:03:07",
        "quiet-episode",
        "unpriced",
        "gpt-test",
        "1,000,000",
        "2,500",
        "61,000 ms",
        "unknown",
        "OK",
      ],
    ]);
  });

  it("has a header row and no body rows when there are no traces", () => {
    const empty = renderToStaticMarkup(<RecentTracesTable traces={[]} />);
    expect(columnHeaders(empty)).toHaveLength(9);
    expect(bodyRows(empty)).toEqual([]);
  });
});

describe("both tables", () => {
  const html =
    renderToStaticMarkup(<EpisodesTable episodes={episodes} />) +
    renderToStaticMarkup(<RecentTracesTable traces={traces} />);

  it("sit in a focusable wrapper named by the caption, with no inline style", () => {
    expect(html).toContain(
      '<div class="table-scroll" role="region" aria-labelledby="episodes-caption" tabindex="0">',
    );
    expect(html).toContain('<caption id="episodes-caption">');
    expect(html).toContain('aria-labelledby="recent-caption"');
    expect(html).toContain('<caption id="recent-caption">');
    expect(html).not.toContain("style=");
  });
});
