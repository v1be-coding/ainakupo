import { describe, expect, it } from "vitest";
import { ApiError, RateLimitedError } from "./api.js";
import { loadDashboard } from "./load.js";
import type { Summary } from "./types.js";

const GENERAL = "Couldn't load data. Try again later.";
const day = { date: "2026-11-19", traceCount: 0 };
const zero = {
  traceCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  knownCostUsd: 0,
  unknownCostCount: 0,
  avgDurationMs: null,
  evaluationCount: 0,
  avgScore: null,
};
const emptySummary: Summary = { totals: zero, episodes: [], daily: [day] };
const fullSummary: Summary = {
  totals: { ...zero, traceCount: 1 },
  episodes: [{ episode: "test-episode", ...zero, traceCount: 1 }],
  daily: [{ ...day, traceCount: 1 }],
};

type Outcome = unknown;
// A stand-in for api(): resolves or rejects per path, and records each call.
function fakeApi(outcomes: Record<string, Outcome>) {
  const calls: string[] = [];
  const fetchJson = <T>(path: string): Promise<T> => {
    calls.push(path);
    const outcome = outcomes[path];
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome as T);
  };
  return { calls, fetchJson };
}

describe("loadDashboard", () => {
  it("asks for the summary and the recent traces once each", async () => {
    const { calls, fetchJson } = fakeApi({
      "/api/summary": fullSummary,
      "/api/traces/recent": { traces: [] },
    });

    await loadDashboard(fetchJson);

    expect(calls.sort()).toEqual(["/api/summary", "/api/traces/recent"]);
  });

  it("gives the data state with both answers", async () => {
    const { fetchJson } = fakeApi({
      "/api/summary": fullSummary,
      "/api/traces/recent": { traces: [] },
    });

    expect(await loadDashboard(fetchJson)).toEqual({
      kind: "data",
      summary: fullSummary,
      traces: [],
    });
  });

  it("gives the empty state when no episode has sent a trace", async () => {
    const { fetchJson } = fakeApi({
      "/api/summary": emptySummary,
      "/api/traces/recent": { traces: [] },
    });

    expect(await loadDashboard(fetchJson)).toEqual({ kind: "empty" });
  });

  it.each([
    ["a failed summary fetch", new TypeError("Failed to fetch"), { traces: [] }],
    ["a 500 on the recent traces", fullSummary, new ApiError(500)],
    ["both failing without a 429", new ApiError(503), new TypeError("Failed to fetch")],
  ])("gives the general error for %s", async (_name, summary, recent) => {
    const { fetchJson } = fakeApi({ "/api/summary": summary, "/api/traces/recent": recent });

    expect(await loadDashboard(fetchJson)).toEqual({ kind: "error", message: GENERAL });
  });

  it.each([
    ["the summary", new RateLimitedError(30, "rate_limited"), { traces: [] }, 30],
    [
      "the recent traces, with a 500 on the summary",
      new ApiError(500),
      new RateLimitedError(17, "unknown"),
      17,
    ],
    [
      "the summary, with the other aborted",
      new RateLimitedError(12, "rate_limited"),
      new TypeError("aborted"),
      12,
    ],
  ])("gives the limit text for a 429 on %s", async (_name, summary, recent, seconds) => {
    const { fetchJson } = fakeApi({ "/api/summary": summary, "/api/traces/recent": recent });

    expect(await loadDashboard(fetchJson)).toEqual({
      kind: "error",
      message: `Too many requests. Try again in ${seconds} seconds.`,
    });
  });

  it("says too many requests even for a daily cap answer", async () => {
    const { fetchJson } = fakeApi({
      "/api/summary": new RateLimitedError(45, "daily_cap"),
      "/api/traces/recent": { traces: [] },
    });

    expect(await loadDashboard(fetchJson)).toEqual({
      kind: "error",
      message: "Too many requests. Try again in 45 seconds.",
    });
  });
});
