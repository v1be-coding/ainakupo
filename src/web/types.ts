// The shapes of GET /api/summary and GET /api/traces/recent (spec #4, Routes).

interface Totals {
  traceCount: number;
  inputTokens: number;
  outputTokens: number;
  knownCostUsd: number;
  unknownCostCount: number;
  avgDurationMs: number | null;
  evaluationCount: number;
  avgScore: number | null;
}

interface EpisodeRow extends Totals {
  episode: string;
}

interface DailyCount {
  date: string;
  traceCount: number;
}

export interface Summary {
  totals: Totals;
  episodes: EpisodeRow[];
  daily: DailyCount[];
}

export interface RecentTrace {
  id: string;
  runId: string | null;
  episode: string;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number | null;
  status: "ok" | "error";
  startedAt: string;
}

// Exactly one of these shows below the header.
export type PageState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "data"; summary: Summary; traces: RecentTrace[] };
