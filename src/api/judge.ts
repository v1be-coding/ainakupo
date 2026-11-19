import type { JudgedTrace } from "../db/evaluations.js";
import type { TraceText } from "../db/trace-text.js";
import type { ApiResult } from "./json.js";
import type { IngestKey } from "./keys.js";
import { notImplemented } from "./routes/not-implemented.js";

// A request that passed every check of POST /api/traces/{id}/evaluations: the key is
// valid and its episode owns the trace, the criterion is valid, and the text is present.
export type JudgeRequest = {
  trace: JudgedTrace;
  text: TraceText;
  criterion: string;
  description: string;
  key: IngestKey;
};

// The spend cap, the judge call and storing the evaluation (spec steps 6–7).
export function judgeTrace(request: JudgeRequest): Promise<ApiResult> {
  void request;
  return notImplemented();
}
