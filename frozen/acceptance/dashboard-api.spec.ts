import { asRecent, averageAfter, newTrace, outOfOrder, TEST_EPISODE, type RecentTrace, type Summary } from "../helpers/ainakupo.js";
import { expect, test } from "../helpers/fixtures.js";
import { last14UtcDates } from "../helpers/format.js";

// Spec #4: GET /api/summary and GET /api/traces/recent. Each title starts with
// the test contract lines (in the spec issue) that it checks. Branch data builds
// up, so counts are checked by difference.

test("C14: a production trace changes the totals, its episode's row and today's count by exactly itself", { tag: ["@C14"] }, async ({ keyed, request }) => {
  // The episode is listed once it has a production trace, so its row exists before.
  expect((await keyed.post("/api/traces", { key: "production", json: newTrace() })).status).toBe(201);
  const before = (await (await request.get("/api/summary")).json()) as Summary;
  expect(before.episodes.map((row) => row.episode)).toEqual([TEST_EPISODE]);

  const trace = newTrace({ inputTokens: 1_234, outputTokens: 567, durationMs: 890, costUsd: null });
  expect((await keyed.post("/api/traces", { key: "production", json: trace })).status).toBe(201);
  // A preview trace changes no count, token or cost.
  expect((await keyed.post("/api/traces", { key: "preview", json: newTrace({ inputTokens: 99_999, costUsd: 5 }) })).status).toBe(201);
  const after = (await (await request.get("/api/summary")).json()) as Summary;

  const [beforeRow] = before.episodes;
  const [afterRow] = after.episodes;
  const durationOf = (was: { avgDurationMs: number | null; traceCount: number }, now: { avgDurationMs: number | null }) =>
    averageAfter({ before: was.avgDurationMs, count: was.traceCount, added: 1, min: 890, max: 890, decimals: 0, after: now.avgDurationMs });
  expect(after.totals).toEqual({
    ...before.totals,
    traceCount: before.totals.traceCount + 1,
    inputTokens: before.totals.inputTokens + 1_234,
    outputTokens: before.totals.outputTokens + 567,
    unknownCostCount: before.totals.unknownCostCount + 1,
    avgDurationMs: durationOf(before.totals, after.totals),
  });
  expect(after.episodes).toEqual([
    {
      ...beforeRow,
      traceCount: (beforeRow?.traceCount ?? 0) + 1,
      inputTokens: (beforeRow?.inputTokens ?? 0) + 1_234,
      outputTokens: (beforeRow?.outputTokens ?? 0) + 567,
      unknownCostCount: (beforeRow?.unknownCostCount ?? 0) + 1,
      avgDurationMs: durationOf(beforeRow ?? before.totals, afterRow ?? after.totals),
    },
  ]);
  expect(after.daily).toEqual([...before.daily.slice(0, 13), { date: before.daily[13]?.date, traceCount: (before.daily[13]?.traceCount ?? 0) + 1 }]);
});

test("C14: daily holds the 14 UTC dates ending today, and a known cost adds to the known total", { tag: ["@C14"] }, async ({ keyed, request }) => {
  expect((await keyed.post("/api/traces", { key: "production", json: newTrace() })).status).toBe(201);
  const before = (await (await request.get("/api/summary")).json()) as Summary;
  expect(before.daily.map((day) => day.date)).toEqual(last14UtcDates(Date.now()));

  expect((await keyed.post("/api/traces", { key: "production", json: newTrace({ costUsd: 0.0123 }) })).status).toBe(201);
  const after = (await (await request.get("/api/summary")).json()) as Summary;

  // Rounded to 6 decimals on both reads, so the sum may differ in the last place.
  expect(after.totals.knownCostUsd).toBeCloseTo(before.totals.knownCostUsd + 0.0123, 5);
  expect(after.episodes[0]?.knownCostUsd).toBeCloseTo((before.episodes[0]?.knownCostUsd ?? 0) + 0.0123, 5);
  expect(after.totals).toEqual({
    ...before.totals,
    traceCount: before.totals.traceCount + 1,
    inputTokens: before.totals.inputTokens + 120,
    outputTokens: before.totals.outputTokens + 30,
    knownCostUsd: after.totals.knownCostUsd,
    avgDurationMs: averageAfter({ before: before.totals.avgDurationMs, count: before.totals.traceCount, added: 1, min: 450, max: 450, decimals: 0, after: after.totals.avgDurationMs }),
  });
});

test("C15: recent lists production traces only, in order, at most 50", { tag: ["@C15"] }, async ({ keyed, request }) => {
  const startedAt = new Date().toISOString();
  const [lowId, highId] = [crypto.randomUUID(), crypto.randomUUID()].sort();
  const low = newTrace({ id: lowId, startedAt, runId: crypto.randomUUID(), costUsd: 0.002 });
  const high = newTrace({ id: highId, startedAt, status: "error" });
  const preview = newTrace({ startedAt });
  expect((await keyed.post("/api/traces", { key: "production", json: low })).status).toBe(201);
  expect((await keyed.post("/api/traces", { key: "production", json: high })).status).toBe(201);
  expect((await keyed.post("/api/traces", { key: "preview", json: preview })).status).toBe(201);

  const response = await request.get("/api/traces/recent");
  expect(response.status()).toBe(200);
  const { traces, ...rest } = (await response.json()) as { traces: RecentTrace[] };
  expect(rest).toEqual({});
  expect(traces.length).toBeLessThanOrEqual(50);
  expect(outOfOrder(traces)).toEqual([]);
  expect(traces.find((trace) => trace.id === low.id)).toEqual(asRecent(low));
  expect(traces.find((trace) => trace.id === high.id)).toEqual(asRecent(high));
  expect(traces.findIndex((trace) => trace.id === low.id)).toBe(traces.findIndex((trace) => trace.id === high.id) + 1);
  expect(traces.find((trace) => trace.id === preview.id)).toBeUndefined();
});
