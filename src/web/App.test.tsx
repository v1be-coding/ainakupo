import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";
import type { PageState, Summary } from "./types.js";

const render = (state: PageState) => renderToStaticMarkup(<App state={state} />);
const count = (html: string, text: string) => html.split(text).length - 1;

const summary: Summary = {
  totals: {
    traceCount: 1,
    inputTokens: 0,
    outputTokens: 0,
    knownCostUsd: 0,
    unknownCostCount: 0,
    avgDurationMs: 5,
    evaluationCount: 0,
    avgScore: null,
  },
  episodes: [],
  daily: [],
};

const states: [string, PageState][] = [
  ["loading", { kind: "loading" }],
  ["error", { kind: "error", message: "Couldn't load data. Try again later." }],
  ["empty", { kind: "empty" }],
  ["data", { kind: "data", summary, traces: [] }],
];

describe("App", () => {
  it.each(states)("always shows the header and footer (%s)", (_name, state) => {
    const html = render(state);

    expect(count(html, "<h1")).toBe(1);
    expect(html).toContain("<h1>AInakupo</h1>");
    expect(html).toContain(
      "What the AI features in V1be Coding&#x27;s live apps cost, how fast they answer and how well.",
    );
    expect(html).toContain("Production traces only · times in UTC");
    expect(html).toMatch(/<footer[^>]*>.*Prompt and response text is never shown here\./s);
    expect(html).toContain(
      '<a href="https://github.com/v1be-coding/ainakupo">Source on GitHub</a>',
    );
  });

  it.each(states)("never writes an inline style (%s)", (_name, state) => {
    expect(render(state)).not.toContain("style=");
  });

  it("shows only the loading status while loading", () => {
    const html = render({ kind: "loading" });

    expect(html).toContain('role="status"');
    expect(html).toContain("Loading…");
    expect(html).not.toContain('role="alert"');
  });

  it("shows one alert with the message, and nothing else, on an error", () => {
    const html = render({ kind: "error", message: "Too many requests. Try again in 30 seconds." });

    expect(count(html, 'role="alert"')).toBe(1);
    expect(html).toMatch(/role="alert"[^>]*>Too many requests\. Try again in 30 seconds\.</);
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("No traces yet");
  });

  it("shows the empty text once, and no status or alert", () => {
    const html = render({ kind: "empty" });

    expect(count(html, "No traces yet")).toBe(1);
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<figure");
  });

  it("shows the data view, with no status, alert or empty text, once loaded", () => {
    const html = render({ kind: "data", summary, traces: [] });

    expect(html).toContain('data-state="data"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("No traces yet");
  });
});
