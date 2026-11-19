import { sql } from "drizzle-orm";
import type { KeyEnvironment } from "./schema.js";
import { apiDb } from "./api-db.js";

// Sums, not averages, so the summary can total episodes from the underlying data.
export type TraceGroupRow = {
  episode: string;
  environment: KeyEnvironment;
  traceCount: number;
  inputTokens: number;
  outputTokens: number;
  knownCostUsd: number;
  unknownCostCount: number;
  durationMsSum: number;
};

type EvaluationGroupRow = { episode: string; evaluationCount: number; scoreSum: number };

// `day` is whole UTC days since the epoch.
type DayRow = { day: number; traceCount: number };

export type SummaryRows = {
  traces: TraceGroupRow[];
  evaluations: EvaluationGroupRow[];
  days: DayRow[];
};

// A day number is epoch milliseconds divided by this, floored: the UTC day.
export const DAY_MS = 24 * 60 * 60 * 1000;

// pg hands back bigint and numeric results as strings.
const num = (value: unknown): number => (value === null ? 0 : Number(value));

// Production traces whose startedAt falls on days [fromDay, toDay), counted per UTC day.
export async function loadSummaryRows(fromDay: number, toDay: number): Promise<SummaryRows> {
  const db = apiDb();
  const from = new Date(fromDay * DAY_MS).toISOString();
  const to = new Date(toDay * DAY_MS).toISOString();

  const traces = await db.execute(sql`
    SELECT episode, environment,
      count(*) AS trace_count,
      sum(input_tokens) AS input_tokens,
      sum(output_tokens) AS output_tokens,
      sum(cost_usd) AS known_cost_usd,
      sum(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_cost_count,
      sum(duration_ms) AS duration_ms_sum
    FROM traces
    GROUP BY episode, environment`);

  const evaluations = await db.execute(sql`
    SELECT episode, count(*) AS evaluation_count, sum(score) AS score_sum
    FROM evaluations
    GROUP BY episode`);

  const days = await db.execute(sql`
    SELECT floor(extract(epoch FROM started_at) / 86400)::int AS day, count(*) AS trace_count
    FROM traces
    WHERE environment = 'production'
      AND started_at >= ${from}::timestamptz
      AND started_at < ${to}::timestamptz
    GROUP BY floor(extract(epoch FROM started_at) / 86400)::int`);

  return {
    traces: traces.rows.map((row) => ({
      episode: String(row.episode),
      environment: row.environment as KeyEnvironment,
      traceCount: num(row.trace_count),
      inputTokens: num(row.input_tokens),
      outputTokens: num(row.output_tokens),
      knownCostUsd: num(row.known_cost_usd),
      unknownCostCount: num(row.unknown_cost_count),
      durationMsSum: num(row.duration_ms_sum),
    })),
    evaluations: evaluations.rows.map((row) => ({
      episode: String(row.episode),
      evaluationCount: num(row.evaluation_count),
      scoreSum: num(row.score_sum),
    })),
    days: days.rows.map((row) => ({ day: num(row.day), traceCount: num(row.trace_count) })),
  };
}
