import { json, type ApiResult } from "../json.js";

// What a route answers until its ticket fills it in.
export function notImplemented(): Promise<ApiResult> {
  return Promise.resolve(json(501, { error: "not_implemented", message: "Not implemented yet" }));
}
