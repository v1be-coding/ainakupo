import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { saveTrace } from "../../db/ingest.js";
import {
  deleteTraceText,
  putTraceText,
  traceTextTable,
  type TraceText,
} from "../../db/trace-text.js";
import { store } from "../../limits/store.js";
import { json, type ApiResult } from "../json.js";
import { authenticate, type IngestKey } from "../keys.js";
import { bodyBytes, UUID } from "../request.js";

// A trace as the sender wrote it, once every field has passed its rule.
type TraceInput = {
  id: string;
  runId: string | null;
  provider: string;
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  startedAt: Date;
  durationMs: number;
  costUsd: number | null;
  status: "ok" | "error";
  prompt: string | undefined;
  response: string | undefined;
};

type Parsed = { ok: true; trace: TraceInput } | { ok: false; field: string };

const MAX_BODY_BYTES = 65_536;
const MAX_TEXT_CHARS = 8_192;
const MAX_TOKENS = 10_000_000;
const MAX_DURATION_MS = 3_600_000;
const MAX_COST_USD = 1_000;
const PAST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_WINDOW_MS = 5 * 60 * 1000;

const SLUG = /^[a-z0-9-]{1,50}$/;
// \p{Cc} is C0 (U+0000–U+001F), DEL and C1 (U+0080–U+009F).
const CONTROL = /\p{Cc}/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const isUuid = (value: unknown) => typeof value === "string" && UUID.test(value);
const isSlug = (value: unknown) => typeof value === "string" && SLUG.test(value);
const isIntegerIn = (value: unknown, max: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
const isModel = (value: unknown) =>
  typeof value === "string" && value.length >= 1 && value.length <= 100 && !CONTROL.test(value);
const isOptionalString = (value: unknown) => value === undefined || typeof value === "string";

// A real date in one of the two forms, inside the window around now.
function isStartedAt(value: unknown, now: number): boolean {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  // Date.parse rolls 2026-02-30 over to March, so the date must read back unchanged.
  if (new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return false;
  return ms >= now - PAST_WINDOW_MS && ms <= now + FUTURE_WINDOW_MS;
}

// The table's fields, in the order they're checked. Absent optional fields arrive
// as undefined.
const RULES: [string, (value: unknown, now: number) => boolean][] = [
  ["id", isUuid],
  ["runId", (value) => value === undefined || value === null || isUuid(value)],
  ["provider", isSlug],
  ["model", isModel],
  ["feature", isSlug],
  ["inputTokens", (value) => isIntegerIn(value, MAX_TOKENS)],
  ["outputTokens", (value) => isIntegerIn(value, MAX_TOKENS)],
  ["startedAt", isStartedAt],
  ["durationMs", (value) => isIntegerIn(value, MAX_DURATION_MS)],
  [
    "costUsd",
    (value) =>
      value === undefined ||
      value === null ||
      (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_COST_USD),
  ],
  ["status", (value) => value === "ok" || value === "error"],
  ["prompt", isOptionalString],
  ["response", isOptionalString],
];
const KNOWN_FIELDS = new Set(RULES.map(([field]) => field));

const invalidTrace = (field: string) =>
  json(400, { error: "invalid_trace", field, message: `Invalid trace field: ${field}` });

// Turns the body into a trace, or names the first field that breaks its rule.
function parseTrace(bytes: Buffer, now: number): Parsed {
  if (bytes.length > MAX_BODY_BYTES) return { ok: false, field: "body" };

  let body: unknown;
  try {
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, field: "body" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, field: "body" };
  }

  const fields = body as Record<string, unknown>;
  for (const [field, rule] of RULES) {
    if (!rule(fields[field], now)) return { ok: false, field };
  }
  // Object.keys keeps the body's order, except that integer-like names ("5") come first.
  const unknown = Object.keys(fields).find((field) => !KNOWN_FIELDS.has(field));
  if (unknown !== undefined) return { ok: false, field: unknown };

  return {
    ok: true,
    trace: {
      id: fields.id as string,
      runId: (fields.runId as string | null | undefined) ?? null,
      provider: fields.provider as string,
      model: fields.model as string,
      feature: fields.feature as string,
      inputTokens: fields.inputTokens as number,
      outputTokens: fields.outputTokens as number,
      startedAt: new Date(fields.startedAt as string),
      durationMs: fields.durationMs as number,
      costUsd: (fields.costUsd as number | null | undefined) ?? null,
      status: fields.status as "ok" | "error",
      prompt: fields.prompt as string | undefined,
      response: fields.response as string | undefined,
    },
  };
}

// POST /api/traces: the router calls this only for POST.
export async function postTrace(event: APIGatewayProxyEventV2): Promise<ApiResult> {
  const check = await authenticate(event);
  if (!check.ok) return check.response;

  const parsed = parseTrace(bodyBytes(event), Date.now());
  if (!parsed.ok) return invalidTrace(parsed.field);

  return storeTrace(check.key, parsed.trace);
}

type KeptText = { text: TraceText | null; truncated: boolean };

// What a key keeps of the text: nothing for a production key; for a preview key each
// non-empty half, cut to its first MAX_TEXT_CHARS UTF-16 code units.
function keptText(key: IngestKey, trace: TraceInput): KeptText {
  if (key.environment !== "preview") return { text: null, truncated: false };

  let truncated = false;
  const keep = (value: string | undefined): string | null => {
    if (value === undefined || value === "") return null;
    if (value.length > MAX_TEXT_CHARS) truncated = true;
    return value.slice(0, MAX_TEXT_CHARS);
  };
  const prompt = keep(trace.prompt);
  const response = keep(trace.response);
  if (prompt === null && response === null) return { text: null, truncated: false };
  return { text: { prompt, response }, truncated };
}

// The row goes first: its save is what refuses another key's id, so the text is never
// touched on a conflict. A text write that fails after the save fails the request, and
// the sender's retry replaces the row (200) and writes the text again.
async function storeTrace(key: IngestKey, trace: TraceInput): Promise<ApiResult> {
  const { text, truncated } = keptText(key, trace);
  const hasText = text !== null;

  const outcome = await saveTrace({
    id: trace.id,
    keyHash: key.hash,
    episode: key.episode,
    environment: key.environment,
    runId: trace.runId,
    provider: trace.provider,
    model: trace.model,
    feature: trace.feature,
    inputTokens: trace.inputTokens,
    outputTokens: trace.outputTokens,
    startedAt: trace.startedAt,
    durationMs: trace.durationMs,
    costUsd: trace.costUsd,
    status: trace.status,
    hasText,
  });
  if (outcome === "conflict") {
    return json(409, {
      error: "trace_conflict",
      message: "Trace id belongs to another ingest key",
    });
  }

  // Keyed by the id as the database's uuid column reads it back, so the judge finds it.
  const textId = trace.id.toLowerCase();
  if (text) {
    await putTraceText(store(), traceTextTable(), textId, trace.startedAt, text);
  } else if (outcome === "replaced" && key.environment === "preview") {
    // A trace id belongs to one key, so only a preview key's trace can have text to remove.
    await deleteTraceText(store(), traceTextTable(), textId);
  }

  return json(outcome === "created" ? 201 : 200, {
    id: trace.id,
    hasText,
    textTruncated: truncated,
  });
}
