import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { findTrace } from "../../db/evaluations.js";
import { getTraceText, KEEP_MS, traceTextTable } from "../../db/trace-text.js";
import { store } from "../../limits/store.js";
import { judgeTrace } from "../judge.js";
import { json, type ApiResult } from "../json.js";
import { authenticate } from "../keys.js";
import { bodyText, UUID } from "../request.js";

type Criterion = { criterion: string; description: string };

const CRITERION = /^[a-z-]{1,50}$/;
const DESCRIPTION_MAX = 1000;

const invalidCriterion = () =>
  json(400, {
    error: "invalid_criterion",
    message:
      "Criterion must be 1 to 50 lowercase letters or hyphens, and description 1 to 1000 characters",
  });
const traceNotFound = () => json(404, { error: "trace_not_found", message: "Trace not found" });
const noText = () => json(422, { error: "no_text", message: "Trace has no text to judge" });

// The body exactly as the spec allows it, or null.
function parseCriterion(text: string): Criterion | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;

  const fields = Object.keys(body);
  if (fields.length !== 2 || !fields.includes("criterion") || !fields.includes("description")) {
    return null;
  }
  const { criterion, description } = body as Record<string, unknown>;
  if (typeof criterion !== "string" || !CRITERION.test(criterion)) return null;
  if (typeof description !== "string") return null;
  if (description.length < 1 || description.length > DESCRIPTION_MAX) return null;
  return { criterion, description };
}

// POST /api/traces/{id}/evaluations: the router calls this only for POST, and passes the
// raw path segment as `traceId`; this function checks it is a UUID.
export async function postEvaluation(
  event: APIGatewayProxyEventV2,
  traceId: string,
): Promise<ApiResult> {
  const check = await authenticate(event);
  if (!check.ok) return check.response;

  const body = parseCriterion(bodyText(event));
  if (!body) return invalidCriterion();

  if (!UUID.test(traceId)) return traceNotFound();
  const trace = await findTrace(traceId);
  // Either key of the owning episode may judge; any other episode is told nothing.
  if (!trace || trace.episode !== check.key.episode) return traceNotFound();

  const now = Date.now();
  if (!trace.hasText || now > trace.startedAt.getTime() + KEEP_MS) return noText();
  // Read by the row's id (Postgres's lowercase form), not the path's, whose case may
  // differ: the text must be stored under the lowercase id too.
  const text = await getTraceText(store(), traceTextTable(), trace.id, now);
  if (!text || (text.prompt === null && text.response === null)) return noText();

  return judgeTrace({ trace, pathId: traceId, text, ...body, key: check.key });
}
