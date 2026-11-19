import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSummaryRows, type TraceGroupRow } from "../../db/summary-queries.js";
import { handler } from "../handler.js";

vi.mock("../../limits/guard.js", () => ({ guardRequest: vi.fn() }));
vi.mock("../../db/summary-queries.js", () => ({ loadSummaryRows: vi.fn() }));

const NOW = new Date("2026-11-19T00:30:00.000Z");
// 2026-11-19 as whole UTC days since the epoch.
const TODAY = 20776;

const get = async () => {
  const event = {
    rawPath: "/api/summary",
    requestContext: { http: { method: "GET" } },
  } as unknown as APIGatewayProxyEventV2;
  const response = (await handler(event)) as { statusCode: number; headers: object; body: string };
  return { ...response, json: JSON.parse(response.body) as Record<string, unknown> };
};

const group = (row: Partial<TraceGroupRow> & Pick<TraceGroupRow, "episode">): TraceGroupRow => ({
  environment: "production",
  traceCount: 1,
  inputTokens: 0,
  outputTokens: 0,
  knownCostUsd: 0,
  unknownCostCount: 0,
  durationMsSum: 0,
  ...row,
});

const emptyFigures = {
  traceCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  knownCostUsd: 0,
  unknownCostCount: 0,
  avgDurationMs: null,
  evaluationCount: 0,
  avgScore: null,
};

describe("GET /api/summary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for the 14 UTC days ending today", async () => {
    vi.mocked(loadSummaryRows).mockResolvedValue({ traces: [], evaluations: [], days: [] });

    await get();

    expect(loadSummaryRows).toHaveBeenCalledWith(TODAY - 13, TODAY + 1);
  });

  it("answers with empty totals, no episodes and 14 zero days when nothing is stored", async () => {
    vi.mocked(loadSummaryRows).mockResolvedValue({ traces: [], evaluations: [], days: [] });

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.headers).toEqual({ "content-type": "application/json" });
    expect(response.json.totals).toEqual(emptyFigures);
    expect(response.json.episodes).toEqual([]);
    const daily = response.json.daily as { date: string; traceCount: number }[];
    expect(daily).toHaveLength(14);
    expect(daily[0]).toEqual({ date: "2026-11-06", traceCount: 0 });
    expect(daily[13]).toEqual({ date: "2026-11-19", traceCount: 0 });
    expect(daily.every((day) => day.traceCount === 0)).toBe(true);
  });

  it("sorts episodes by trace count, then name, and leaves out preview-only episodes", async () => {
    vi.mocked(loadSummaryRows).mockResolvedValue({
      traces: [
        group({ episode: "zeta", traceCount: 2 }),
        group({ episode: "beta", traceCount: 1 }),
        group({ episode: "alpha", traceCount: 1 }),
        group({ episode: "alpha", environment: "preview", traceCount: 9 }),
        group({ episode: "preview-only", environment: "preview", traceCount: 50 }),
      ],
      evaluations: [{ episode: "preview-only", evaluationCount: 3, scoreSum: 12 }],
      days: [],
    });

    const response = await get();

    const episodes = response.json.episodes as { episode: string; traceCount: number }[];
    expect(episodes.map((row) => [row.episode, row.traceCount])).toEqual([
      ["zeta", 2],
      ["alpha", 1],
      ["beta", 1],
    ]);
    expect(response.json.totals).toMatchObject({
      traceCount: 4,
      evaluationCount: 0,
      avgScore: null,
    });
  });

  it("counts production traces only, rounds each row, and totals from the sums", async () => {
    vi.mocked(loadSummaryRows).mockResolvedValue({
      traces: [
        group({
          episode: "test-episode",
          traceCount: 3,
          inputTokens: 300,
          outputTokens: 30,
          knownCostUsd: 0.1234564,
          unknownCostCount: 1,
          durationMsSum: 1000,
        }),
        group({
          episode: "test-episode",
          environment: "preview",
          traceCount: 5,
          inputTokens: 99_999,
          knownCostUsd: 5,
          durationMsSum: 99_999,
        }),
        group({
          episode: "other",
          traceCount: 1,
          inputTokens: 10,
          outputTokens: 1,
          knownCostUsd: 0.0000004,
          durationMsSum: 501,
        }),
      ],
      evaluations: [
        { episode: "test-episode", evaluationCount: 4, scoreSum: 13 },
        { episode: "other", evaluationCount: 2, scoreSum: 3 },
      ],
      days: [],
    });

    const response = await get();

    expect(response.json.episodes).toEqual([
      {
        episode: "test-episode",
        traceCount: 3,
        inputTokens: 300,
        outputTokens: 30,
        knownCostUsd: 0.123456,
        unknownCostCount: 1,
        avgDurationMs: 333,
        evaluationCount: 4,
        avgScore: 3.3,
      },
      {
        episode: "other",
        traceCount: 1,
        inputTokens: 10,
        outputTokens: 1,
        knownCostUsd: 0,
        unknownCostCount: 0,
        avgDurationMs: 501,
        evaluationCount: 2,
        avgScore: 1.5,
      },
    ]);
    // From the sums: 0.1234568 rounds up although the rows' rounded costs add to 0.123456.
    expect(response.json.totals).toEqual({
      traceCount: 4,
      inputTokens: 310,
      outputTokens: 31,
      knownCostUsd: 0.123457,
      unknownCostCount: 1,
      avgDurationMs: 375,
      evaluationCount: 6,
      avgScore: 2.7,
    });
  });

  it("fills days without production traces with 0, oldest first", async () => {
    vi.mocked(loadSummaryRows).mockResolvedValue({
      traces: [group({ episode: "test-episode", traceCount: 7 })],
      evaluations: [],
      days: [
        { day: TODAY, traceCount: 4 },
        { day: TODAY - 13, traceCount: 2 },
        { day: TODAY - 2, traceCount: 1 },
      ],
    });

    const response = await get();

    const daily = response.json.daily as { date: string; traceCount: number }[];
    expect(daily.map((day) => day.date)).toEqual([
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
    ]);
    expect(daily.map((day) => day.traceCount)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 4]);
  });

  it("answers 500 internal when the database fails", async () => {
    vi.mocked(loadSummaryRows).mockRejectedValue(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await get();

    expect(response.statusCode).toBe(500);
    expect(response.headers).toEqual({ "content-type": "application/json" });
    expect(response.json).toEqual({ error: "internal", message: "Internal error" });
  });
});
