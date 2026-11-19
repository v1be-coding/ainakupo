// Shapes and checks for spec #4's routes that need a branch, so the tests stay
// one straight line (frozen/README.md).
import { randomUUID } from "node:crypto";
import type { KeyedResponse } from "./keyed.ts";

// The test-episode's name (spec #4, Test contract inputs › Data).
export const TEST_EPISODE = "test-episode";

// Now, to the whole second, as the millisecond form the API reads back.
export function nowToTheSecond(): string {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
}

// A valid trace body, its fields in the table's order, with a unique id and
// feature. `overrides` set to undefined drop a field.
export function newTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    provider: "anthropic",
    model: "claude-haiku-5-5",
    feature: `t-${randomUUID()}`,
    inputTokens: 120,
    outputTokens: 30,
    startedAt: new Date().toISOString(),
    durationMs: 450,
    status: "ok",
    ...overrides,
  };
}

// How /api/traces/recent lists a production trace sent as `body`.
export function asRecent(body: Record<string, unknown>): RecentTrace {
  return {
    id: String(body.id),
    runId: (body.runId as string | null | undefined) ?? null,
    episode: TEST_EPISODE,
    feature: String(body.feature),
    provider: String(body.provider),
    model: String(body.model),
    inputTokens: Number(body.inputTokens),
    outputTokens: Number(body.outputTokens),
    durationMs: Number(body.durationMs),
    costUsd: (body.costUsd as number | null | undefined) ?? null,
    status: body.status as "ok" | "error",
    startedAt: new Date(body.startedAt as string | Date).toISOString(),
  };
}

export type Totals = {
  traceCount: number;
  inputTokens: number;
  outputTokens: number;
  knownCostUsd: number;
  unknownCostCount: number;
  avgDurationMs: number | null;
  evaluationCount: number;
  avgScore: number | null;
};
export type EpisodeRow = Totals & { episode: string };
export type Day = { date: string; traceCount: number };
export type Summary = { totals: Totals; episodes: EpisodeRow[]; daily: Day[] };
export type RecentTrace = {
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
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MILLISECOND_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Where a test compares the server's clock with the runner's (spec #4's test
// contract allows 1 second either way).
export const CLOCK_SKEW_MS = 1_000;

// Pairs of neighbours in /api/traces/recent that break its order: startedAt
// descending, then id descending. Empty when the list is in order.
export function outOfOrder(traces: readonly RecentTrace[]): string[] {
  const problems: string[] = [];
  for (let i = 1; i < traces.length; i++) {
    const a = traces[i - 1] as RecentTrace;
    const b = traces[i] as RecentTrace;
    const inOrder = a.startedAt > b.startedAt || (a.startedAt === b.startedAt && a.id.toLowerCase() > b.id.toLowerCase());
    if (!inOrder) problems.push(`${a.startedAt} ${a.id} before ${b.startedAt} ${b.id}`);
  }
  return problems;
}

// What an average rounded to `decimals` may be after `added` new values, each
// between `min` and `max`, join `count` values whose rounded average was
// `before`. Gives `after` back when it fits, so a test can use it in toEqual,
// or a description of the bounds it broke.
export function averageAfter(options: {
  before: number | null;
  count: number;
  added: number;
  min: number;
  max: number;
  decimals: number;
  after: number | null;
}): number | null | string {
  const { before, count, added, min, max, decimals, after } = options;
  if (added === 0) return before;
  const half = 0.5 / 10 ** decimals;
  const total = count + added;
  const low = before === null || count === 0 ? min : ((before - half) * count + min * added) / total;
  const high = before === null || count === 0 ? max : ((before + half) * count + max * added) / total;
  const scale = 10 ** decimals;
  const lowest = Math.floor(low * scale + 1e-9) / scale;
  const highest = Math.ceil(high * scale - 1e-9) / scale;
  const fits = typeof after === "number" && after >= lowest - 1e-9 && after <= highest + 1e-9 && Math.abs(after * scale - Math.round(after * scale)) < 1e-6;
  return fits ? after : `an average from ${lowest} to ${highest} with ${decimals} decimals, not ${String(after)}`;
}

export const JUDGE_MODEL = "claude-haiku-5-5";
const URL_MARKS = ["http://", "https://", "www.", "]("];
// Control characters, and the bidirectional embedding, override and isolate marks.
const FORBIDDEN_CHARACTERS = /[\p{Cc}‪-‮⁦-⁩]/u;

export type JudgeExpectation = {
  // What the whole body must equal.
  expected: unknown;
  // Rules the body breaks that toEqual can't show. Empty when none.
  problems: string[];
  // Evaluations this answer added: 1 for a 201, else 0.
  added: number;
};

// The outcomes a judge test accepts (spec #4, How the frozen tests must send
// keyed requests): a 201 checked by shape and limits, never by score, or the
// judge_failed, judge_unavailable or daily_cap answer.
export function judgeExpectation(
  answer: KeyedResponse,
  request: { traceId: string; criterion: string; sentAt: number; answeredAt: number },
): JudgeExpectation {
  const problems: string[] = [];
  if (!answer.contentType?.includes("application/json")) problems.push(`content-type ${String(answer.contentType)}, not application/json`);
  const body = (answer.body ?? {}) as Record<string, unknown>;

  if (answer.status === 201) {
    const { id, score, explanation, createdAt } = body;
    if (typeof id !== "string" || !UUID.test(id)) problems.push(`id ${JSON.stringify(id)} isn't a UUID`);
    if (typeof id === "string" && id.toLowerCase() === request.traceId.toLowerCase()) problems.push("id is the trace's id");
    if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) problems.push(`score ${JSON.stringify(score)} isn't an integer from 1 to 5`);
    problems.push(...explanationProblems(explanation));
    const created = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
    if (typeof createdAt !== "string" || !MILLISECOND_TIME.test(createdAt)) problems.push(`createdAt ${JSON.stringify(createdAt)} isn't YYYY-MM-DDTHH:MM:SS.sssZ`);
    if (!(created >= request.sentAt - CLOCK_SKEW_MS && created <= request.answeredAt + CLOCK_SKEW_MS)) {
      problems.push(`createdAt ${JSON.stringify(createdAt)} isn't within the request`);
    }
    return {
      expected: { id, traceId: request.traceId, criterion: request.criterion, score, explanation, model: JUDGE_MODEL, createdAt },
      problems,
      added: 1,
    };
  }
  if (answer.status === 502) {
    return { expected: { error: "judge_failed", message: "The judge did not return a score" }, problems, added: 0 };
  }
  if (answer.status === 503) {
    return { expected: { error: "judge_unavailable", message: "The judge is busy. Try again shortly" }, problems, added: 0 };
  }
  if (answer.status === 429) {
    return {
      expected: { error: "daily_cap", message: "The AI feature is paused until tomorrow", retryAfterSeconds: Number(answer.retryAfter) },
      problems,
      added: 0,
    };
  }
  problems.push(`status ${answer.status} isn't one the judge test accepts (201, 502, 503 or 429)`);
  return { expected: { acceptedStatuses: [201, 502, 503, 429] }, problems, added: 0 };
}

function explanationProblems(explanation: unknown): string[] {
  if (typeof explanation !== "string") return [`explanation ${JSON.stringify(explanation)} isn't a string`];
  const problems: string[] = [];
  const codePoints = [...explanation].length;
  if (codePoints < 1 || codePoints > 500) problems.push(`explanation is ${codePoints} code points, not 1 to 500`);
  const lower = explanation.toLowerCase();
  for (const mark of URL_MARKS) {
    if (lower.includes(mark)) problems.push(`explanation holds a URL mark: ${mark}`);
  }
  if (FORBIDDEN_CHARACTERS.test(explanation)) problems.push("explanation holds a control or bidirectional-override character");
  return problems;
}
