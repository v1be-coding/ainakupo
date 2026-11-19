import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { saveTrace } from "../../db/ingest.js";
import { json, type ApiResult } from "../json.js";
import { authenticate, type IngestKey } from "../keys.js";

// A trace as the sender wrote it.
type TraceInput = {
  id: string;
  runId: string | null;
  provider: string;
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  startedAt: string;
  durationMs: number;
  costUsd: number | null;
  status: "ok" | "error";
  prompt?: string;
  response?: string;
};

type Parsed = { ok: true; trace: TraceInput } | { ok: false; field: string };

const invalidTrace = (field: string) =>
  json(400, { error: "invalid_trace", field, message: `Invalid trace field: ${field}` });

function bodyText(event: APIGatewayProxyEventV2): string {
  const raw = event.body ?? "";
  return event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
}

// Turns the body into a trace, or names the field that breaks its rule. Only the body's
// shape is checked: a well-formed body's fields are taken as they are.
function parseTrace(text: string): Parsed {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, field: "body" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, field: "body" };
  }
  const trace = body as TraceInput;
  return {
    ok: true,
    trace: { ...trace, runId: trace.runId ?? null, costUsd: trace.costUsd ?? null },
  };
}

// POST /api/traces: the router calls this only for POST.
export async function postTrace(event: APIGatewayProxyEventV2): Promise<ApiResult> {
  const check = await authenticate(event);
  if (!check.ok) return check.response;

  const parsed = parseTrace(bodyText(event));
  if (!parsed.ok) return invalidTrace(parsed.field);

  return storeTrace(check.key, parsed.trace);
}

async function storeTrace(key: IngestKey, trace: TraceInput): Promise<ApiResult> {
  // No text is stored: production keys' text is always dropped, and this route keeps
  // no preview text either.
  const hasText = false;
  const textTruncated = false;

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
    startedAt: new Date(trace.startedAt),
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

  return json(outcome === "created" ? 201 : 200, { id: trace.id, hasText, textTruncated });
}
