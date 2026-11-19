import { CLOCK_SKEW_MS } from "../helpers/ainakupo.js";
import { expect, test } from "../helpers/fixtures.js";

// Spec #4: the per-key limit. Its own project, after every other test, because
// it uses up the preview key's minute on purpose. `freshKeyWindow` waits for the
// next UTC minute boundary first, so the whole burst lands in one server window.
test.use({ allow429: true, apiBudget: 70, keyBudget: 0 });

const KEY_LIMITED = { error: "key_rate_limited", message: "Too many requests for this ingest key" };
const INVALID_CRITERION = {
  error: "invalid_criterion",
  message: "Criterion must be 1 to 50 lowercase letters or hyphens, and description 1 to 1000 characters",
};
const invalidTraceBody = { error: "invalid_trace", field: "id", message: "Invalid trace field: id" };

test("C8: the 61st request in a minute with one key, on either POST route, gets the per-key 429", { tag: ["@C8"] }, async ({ keyed, freshKeyWindow }) => {
  const evaluations = `/api/traces/${crypto.randomUUID()}/evaluations`;
  const unpaced = { key: "preview", perKeyPacing: false } as const;

  // 60 requests that count, whatever their outcome: 30 on each route.
  const traceAnswers: unknown[] = [];
  for (let i = 0; i < 30; i++) {
    const answer = await keyed.post("/api/traces", { ...unpaced, json: {} });
    traceAnswers.push({ status: answer.status, body: answer.body });
  }
  const evaluationAnswers: unknown[] = [];
  for (let i = 0; i < 30; i++) {
    const answer = await keyed.post(evaluations, { ...unpaced, json: {} });
    evaluationAnswers.push({ status: answer.status, body: answer.body });
  }
  expect(traceAnswers).toEqual(Array.from({ length: 30 }, () => ({ status: 400, body: invalidTraceBody })));
  expect(evaluationAnswers).toEqual(Array.from({ length: 30 }, () => ({ status: 400, body: INVALID_CRITERION })));

  const sentAt = Date.now();
  const onTraces = await keyed.post("/api/traces", { ...unpaced, json: {} });
  const onEvaluations = await keyed.post(evaluations, { ...unpaced, json: {} });
  expect(Date.now(), "the burst ran past its minute, so it proves nothing").toBeLessThan(freshKeyWindow.windowEnd);

  // retryAfterSeconds is server-made: proved by matching the header and by
  // bounds, 1 to the seconds left in the minute.
  const secondsLeft = Math.ceil((freshKeyWindow.windowEnd - sentAt + CLOCK_SKEW_MS) / 1000);
  expect(onTraces.status).toBe(429);
  expect(onTraces.contentType).toContain("application/json");
  const n = Number(onTraces.retryAfter);
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(secondsLeft);
  expect(onTraces.body).toEqual({ ...KEY_LIMITED, retryAfterSeconds: n });

  expect(onEvaluations.status).toBe(429);
  const m = Number(onEvaluations.retryAfter);
  expect(m).toBeGreaterThanOrEqual(1);
  expect(m).toBeLessThanOrEqual(secondsLeft);
  expect(onEvaluations.body).toEqual({ ...KEY_LIMITED, retryAfterSeconds: m });
});
