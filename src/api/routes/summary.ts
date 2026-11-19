import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { loadSummaryRows, type SummaryRows } from "../../db/summary-queries.js";
import { json, type ApiResult } from "../json.js";

type Figures = {
  traceCount: number;
  inputTokens: number;
  outputTokens: number;
  knownCostUsd: number;
  unknownCostCount: number;
  avgDurationMs: number | null;
  evaluationCount: number;
  avgScore: number | null;
};

type Summary = {
  totals: Figures;
  episodes: ({ episode: string } & Figures)[];
  daily: { date: string; traceCount: number }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 14;

type Sums = {
  traceCount: number;
  inputTokens: number;
  outputTokens: number;
  knownCostUsd: number;
  unknownCostCount: number;
  durationMsSum: number;
  evaluationCount: number;
  scoreSum: number;
};

const zero = (): Sums => ({
  traceCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  knownCostUsd: 0,
  unknownCostCount: 0,
  durationMsSum: 0,
  evaluationCount: 0,
  scoreSum: 0,
});

const add = (into: Sums, from: Sums): void => {
  for (const key of Object.keys(into) as (keyof Sums)[]) into[key] += from[key];
};

const round = (value: number, decimals: number) => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

// Rounding happens only here, so totals come from the sums rather than rounded rows.
const figures = (sums: Sums): Figures => ({
  traceCount: sums.traceCount,
  inputTokens: sums.inputTokens,
  outputTokens: sums.outputTokens,
  knownCostUsd: round(sums.knownCostUsd, 6),
  unknownCostCount: sums.unknownCostCount,
  avgDurationMs: sums.traceCount > 0 ? Math.round(sums.durationMsSum / sums.traceCount) : null,
  evaluationCount: sums.evaluationCount,
  avgScore: sums.evaluationCount > 0 ? round(sums.scoreSum / sums.evaluationCount, 1) : null,
});

const todayNumber = (now: Date) => Math.floor(now.getTime() / DAY_MS);

function buildSummary(rows: SummaryRows, now: Date): Summary {
  const byEpisode = new Map<string, Sums>();
  for (const row of rows.traces) {
    if (row.environment !== "production") continue;
    const sums = byEpisode.get(row.episode) ?? zero();
    sums.traceCount += row.traceCount;
    sums.inputTokens += row.inputTokens;
    sums.outputTokens += row.outputTokens;
    sums.knownCostUsd += row.knownCostUsd;
    sums.unknownCostCount += row.unknownCostCount;
    sums.durationMsSum += row.durationMsSum;
    byEpisode.set(row.episode, sums);
  }
  // Only episodes with a production trace are listed, so other evaluations are dropped.
  for (const row of rows.evaluations) {
    const sums = byEpisode.get(row.episode);
    if (!sums) continue;
    sums.evaluationCount += row.evaluationCount;
    sums.scoreSum += row.scoreSum;
  }

  const listed = [...byEpisode]
    .filter(([, sums]) => sums.traceCount > 0)
    .sort(([a, x], [b, y]) => y.traceCount - x.traceCount || (a < b ? -1 : a > b ? 1 : 0));

  const total = zero();
  for (const [, sums] of listed) add(total, sums);

  const countByDay = new Map(rows.days.map((row) => [row.day, row.traceCount]));
  const today = todayNumber(now);
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const day = today - (DAYS - 1) + i;
    return {
      date: new Date(day * DAY_MS).toISOString().slice(0, 10),
      traceCount: countByDay.get(day) ?? 0,
    };
  });

  return {
    totals: figures(total),
    episodes: listed.map(([episode, sums]) => ({ episode, ...figures(sums) })),
    daily,
  };
}

// GET /api/summary: the router calls this only for GET.
export async function getSummary(event: APIGatewayProxyEventV2): Promise<ApiResult> {
  void event;
  const now = new Date();
  const today = todayNumber(now);
  try {
    const rows = await loadSummaryRows(today - (DAYS - 1), today + 1);
    return json(200, buildSummary(rows, now));
  } catch (error) {
    console.error("summary failed", error instanceof Error ? error.message : String(error));
    return json(500, { error: "internal", message: "Internal error" });
  }
}
