import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { ApiResult } from "../json.js";
import { notImplemented } from "./not-implemented.js";

// GET /api/summary: the router calls this only for GET.
export function getSummary(event: APIGatewayProxyEventV2): Promise<ApiResult> {
  void event;
  return notImplemented();
}
