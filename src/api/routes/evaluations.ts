import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { ApiResult } from "../json.js";
import { notImplemented } from "./not-implemented.js";

// POST /api/traces/{id}/evaluations: the router calls this only for POST. `traceId` is the
// raw path segment, not checked to be a UUID.
export function postEvaluation(event: APIGatewayProxyEventV2, traceId: string): Promise<ApiResult> {
  void event;
  void traceId;
  return notImplemented();
}
