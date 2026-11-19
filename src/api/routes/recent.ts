import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { listRecentTraces } from "../../db/ingest.js";
import { json, type ApiResult } from "../json.js";

// GET /api/traces/recent: the router calls this only for GET. Production traces only,
// newest first; no text, hasText or key fields.
export async function getRecentTraces(event: APIGatewayProxyEventV2): Promise<ApiResult> {
  void event;
  const rows = await listRecentTraces();
  const traces = rows.map((row) => ({ ...row, startedAt: row.startedAt.toISOString() }));
  return json(200, { traces });
}
