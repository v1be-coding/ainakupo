import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { ApiResult } from "../json.js";
import { notImplemented } from "./not-implemented.js";

// POST /api/traces: the router calls this only for POST.
export function postTrace(event: APIGatewayProxyEventV2): Promise<ApiResult> {
  void event;
  return notImplemented();
}
