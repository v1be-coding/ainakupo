import { asRecent, newTrace, type RecentTrace } from "../helpers/ainakupo.js";
import { expect, test } from "../helpers/fixtures.js";
import { jsonOfBytes } from "../helpers/keyed.js";
import { randomKey } from "../helpers/keys.js";

// Spec #4: POST /api/traces. Each title starts with the test contract lines (in
// the spec issue) that it checks. Keyed requests go through `keyed`, never
// `request`, so no key reaches a Playwright trace.

const INVALID_KEY = { error: "invalid_key", message: "Missing or unknown ingest key" };
const invalidTrace = (field: string) => ({ error: "invalid_trace", field, message: `Invalid trace field: ${field}` });
const stored = (id: unknown, hasText = false, textTruncated = false) => ({ id, hasText, textTruncated });
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

test("C1: invalid keys get the same 401 on POST /api/traces, before the body is checked", { tag: ["@C1"] }, async ({ keyed }) => {
  const body = newTrace();

  const noHeader = await keyed.post("/api/traces", { json: body });
  expect(noHeader.status).toBe(401);
  expect(noHeader.body).toEqual(INVALID_KEY);

  const noBearer = await keyed.post("/api/traces", { key: "production", withoutBearer: true, json: body });
  expect(noBearer.status).toBe(401);
  expect(noBearer.body).toEqual(INVALID_KEY);

  const malformed = await keyed.post("/api/traces", { authorization: "Bearer aik_prod_short", json: body });
  expect(malformed.status).toBe(401);
  expect(malformed.body).toEqual(INVALID_KEY);

  const notAKey = await keyed.post("/api/traces", { authorization: `Bearer ${crypto.randomUUID()}`, json: body });
  expect(notAKey.status).toBe(401);
  expect(notAKey.body).toEqual(INVALID_KEY);

  const unknown = await keyed.post("/api/traces", { authorization: `Bearer ${randomKey("prod")}`, json: body });
  expect(unknown.status).toBe(401);
  expect(unknown.body).toEqual(INVALID_KEY);

  const otherPrefix = await keyed.post("/api/traces", { key: "preview-under-production-prefix", json: body });
  expect(otherPrefix.status).toBe(401);
  expect(otherPrefix.body).toEqual(INVALID_KEY);

  const unknownWithBadBody = await keyed.post("/api/traces", { authorization: `Bearer ${randomKey("prev")}`, raw: "not json" });
  expect(unknownWithBadBody.status).toBe(401);
  expect(unknownWithBadBody.body).toEqual(INVALID_KEY);
});

test("C2, C15: a new trace from the production key is stored without its text and reads back", { tag: ["@C2", "@C15"] }, async ({ keyed, request }) => {
  // The seconds form, without milliseconds, reads back in the millisecond form.
  const body = newTrace({ startedAt: `${new Date().toISOString().slice(0, 19)}Z`, prompt: "a visitor's message", response: "the reply" });

  const sent = await keyed.post("/api/traces", { key: "production", json: body });
  expect(sent.status).toBe(201);
  expect(sent.body).toEqual(stored(body.id));

  const recent = (await (await request.get("/api/traces/recent")).json()) as { traces: RecentTrace[] };
  expect(recent.traces.find((trace) => trace.id === body.id)).toEqual(asRecent(body));
});

test("C3, C15: resending an id with the same key replaces every field", { tag: ["@C3", "@C15"] }, async ({ keyed, request }) => {
  const first = newTrace({ runId: crypto.randomUUID(), costUsd: 0.5 });
  const second = {
    id: first.id,
    runId: null,
    provider: "openai",
    model: "gpt-test",
    feature: `t-${crypto.randomUUID()}`,
    inputTokens: 7,
    outputTokens: 8,
    startedAt: new Date(Date.now() - 1000).toISOString(),
    durationMs: 9,
    costUsd: null,
    status: "error",
  };

  const created = await keyed.post("/api/traces", { key: "production", json: first });
  expect(created.status).toBe(201);
  expect(created.body).toEqual(stored(first.id));

  const replaced = await keyed.post("/api/traces", { key: "production", json: second });
  expect(replaced.status).toBe(200);
  expect(replaced.body).toEqual(stored(first.id));

  const recent = (await (await request.get("/api/traces/recent")).json()) as { traces: RecentTrace[] };
  expect(recent.traces.find((trace) => trace.id === first.id)).toEqual(asRecent(second));
});

test("C4, C15: an id sent with one test key gets a 409 from the other, and stays as it was", { tag: ["@C4", "@C15"] }, async ({ keyed, request }) => {
  const conflict = { error: "trace_conflict", message: "Trace id belongs to another ingest key" };
  const original = newTrace({ costUsd: 0.25 });
  const fromProduction = await keyed.post("/api/traces", { key: "production", json: original });
  expect(fromProduction.status).toBe(201);

  const fromPreview = await keyed.post("/api/traces", { key: "preview", json: newTrace({ id: original.id, inputTokens: 1, feature: "other" }) });
  expect(fromPreview.status).toBe(409);
  expect(fromPreview.body).toEqual(conflict);

  const recent = (await (await request.get("/api/traces/recent")).json()) as { traces: RecentTrace[] };
  expect(recent.traces.find((trace) => trace.id === original.id)).toEqual(asRecent(original));

  const previewFirst = newTrace({ prompt: "preview text" });
  const createdByPreview = await keyed.post("/api/traces", { key: "preview", json: previewFirst });
  expect(createdByPreview.status).toBe(201);

  const thenProduction = await keyed.post("/api/traces", { key: "production", json: previewFirst });
  expect(thenProduction.status).toBe(409);
  expect(thenProduction.body).toEqual(conflict);
});

test("C5: a body that isn't a JSON object, or is over the size limit, gets the 400 for body", { tag: ["@C5"] }, async ({ keyed }) => {
  const badBodies = ["not json", "[]", "null", '"a string"', "{", jsonOfBytes(newTrace({ prompt: "x".repeat(60_000) }), 65_537)];
  for (const raw of badBodies) {
    const answer = await keyed.post("/api/traces", { key: "production", raw });
    expect(answer.status, `body starting ${raw.slice(0, 20)}`).toBe(400);
    expect(answer.body, `body starting ${raw.slice(0, 20)}`).toEqual(invalidTrace("body"));
  }

  const atTheLimit = newTrace({ prompt: "x".repeat(60_000) });
  const exact = await keyed.post("/api/traces", { key: "production", raw: jsonOfBytes(atTheLimit, 65_536) });
  expect(exact.status).toBe(201);
  expect(exact.body).toEqual(stored(atTheLimit.id));
});

test("C6: a breach of the id, runId, provider, model or feature rule names that field", { tag: ["@C6"] }, async ({ keyed }) => {
  const breaches: [string, Record<string, unknown>][] = [
    ["id", { id: undefined }],
    ["id", { id: "not-a-uuid" }],
    ["id", { id: "11111111-1111-1111-1111-11111111111" }],
    ["id", { id: 5 }],
    ["runId", { runId: "not-a-uuid" }],
    ["runId", { runId: 5 }],
    ["provider", { provider: undefined }],
    ["provider", { provider: "" }],
    ["provider", { provider: "Anthropic" }],
    ["provider", { provider: "a".repeat(51) }],
    ["model", { model: "" }],
    ["model", { model: "m".repeat(101) }],
    ["model", { model: "bad\u0007model" }],
    ["model", { model: 5 }],
    ["feature", { feature: undefined }],
    ["feature", { feature: "has space" }],
    ["feature", { feature: "f".repeat(51) }],
  ];
  for (const [field, overrides] of breaches) {
    const answer = await keyed.post("/api/traces", { key: "production", json: newTrace(overrides) });
    expect(answer.status, `${field} set to ${JSON.stringify(overrides[field])}`).toBe(400);
    expect(answer.body, `${field} set to ${JSON.stringify(overrides[field])}`).toEqual(invalidTrace(field));
  }
});

test("C6: a breach of a token, time, duration, cost, status or text rule names that field", { tag: ["@C6"] }, async ({ keyed }) => {
  const now = Date.now();
  const breaches: [string, Record<string, unknown>][] = [
    ["inputTokens", { inputTokens: undefined }],
    ["inputTokens", { inputTokens: -1 }],
    ["inputTokens", { inputTokens: 1.5 }],
    ["inputTokens", { inputTokens: "10" }],
    ["inputTokens", { inputTokens: 10_000_001 }],
    ["outputTokens", { outputTokens: -1 }],
    ["outputTokens", { outputTokens: 10_000_001 }],
    ["startedAt", { startedAt: undefined }],
    ["startedAt", { startedAt: new Date(now).toISOString().slice(0, 10) }],
    ["startedAt", { startedAt: `${new Date(now).toISOString().slice(0, 19)}+00:00` }],
    ["startedAt", { startedAt: now }],
    ["startedAt", { startedAt: new Date(now - 7 * DAY_MS - MINUTE_MS).toISOString() }],
    ["startedAt", { startedAt: new Date(now + 6 * MINUTE_MS).toISOString() }],
    ["durationMs", { durationMs: -1 }],
    ["durationMs", { durationMs: 1.5 }],
    ["durationMs", { durationMs: 3_600_001 }],
    ["costUsd", { costUsd: -0.01 }],
    ["costUsd", { costUsd: 1000.01 }],
    ["costUsd", { costUsd: "1" }],
    ["status", { status: "OK" }],
    ["status", { status: undefined }],
    ["prompt", { prompt: 5 }],
    ["response", { response: { text: "x" } }],
  ];
  for (const [field, overrides] of breaches) {
    const answer = await keyed.post("/api/traces", { key: "preview", json: newTrace(overrides) });
    expect(answer.status, `${field} set to ${JSON.stringify(overrides[field])}`).toBe(400);
    expect(answer.body, `${field} set to ${JSON.stringify(overrides[field])}`).toEqual(invalidTrace(field));
  }
});

test("C6: with two breaches, the field first in the table's order is named, and unknown fields come last, in body order", { tag: ["@C6"] }, async ({ keyed }) => {
  const { id: _id, status: _status, ...rest } = newTrace();
  const statusWrittenFirst = JSON.stringify({ status: "OK", ...rest, id: "not-a-uuid" });
  const statusFirst = await keyed.post("/api/traces", { key: "production", raw: statusWrittenFirst });
  expect(statusFirst.status).toBe(400);
  expect(statusFirst.body).toEqual(invalidTrace("id"));

  const providerAndStatus = await keyed.post("/api/traces", { key: "production", json: newTrace({ provider: undefined, status: "OK" }) });
  expect(providerAndStatus.status).toBe(400);
  expect(providerAndStatus.body).toEqual(invalidTrace("provider"));

  const unknownWrittenFirst = JSON.stringify({ apiKey: "sk-not-a-real-key", ...newTrace({ status: "OK" }) });
  const unknownBeforeStatus = await keyed.post("/api/traces", { key: "production", raw: unknownWrittenFirst });
  expect(unknownBeforeStatus.status).toBe(400);
  expect(unknownBeforeStatus.body).toEqual(invalidTrace("status"));

  const oneUnknown = await keyed.post("/api/traces", { key: "production", json: newTrace({ apiKey: "sk-not-a-real-key" }) });
  expect(oneUnknown.status).toBe(400);
  expect(oneUnknown.body).toEqual(invalidTrace("apiKey"));

  const twoUnknown = await keyed.post("/api/traces", { key: "production", json: newTrace({ zeta: 1, alpha: 2 }) });
  expect(twoUnknown.status).toBe(400);
  expect(twoUnknown.body).toEqual(invalidTrace("zeta"));
});

test("C6: values at each rule's edges are stored", { tag: ["@C6"] }, async ({ keyed }) => {
  const now = Date.now();
  const lowEdges = newTrace({
    id: crypto.randomUUID().toUpperCase(),
    runId: null,
    provider: `p-${"0".repeat(48)}`,
    model: "é".repeat(100),
    feature: `f-${"z".repeat(48)}`,
    inputTokens: 0,
    outputTokens: 10_000_000,
    startedAt: new Date(now - 7 * DAY_MS + MINUTE_MS).toISOString(),
    durationMs: 0,
    costUsd: 0,
  });
  const highEdges = newTrace({
    runId: crypto.randomUUID(),
    provider: "a",
    model: "m",
    feature: "f",
    inputTokens: 10_000_000,
    outputTokens: 0,
    startedAt: new Date(now + 4 * MINUTE_MS).toISOString(),
    durationMs: 3_600_000,
    costUsd: 1000,
    status: "error",
  });
  const otherForms = newTrace({ startedAt: `${new Date(now).toISOString().slice(0, 19)}Z`, costUsd: null, prompt: "", response: "" });

  for (const body of [lowEdges, highEdges, otherForms]) {
    const answer = await keyed.post("/api/traces", { key: "preview", json: body });
    expect(answer.status, `trace ${String(body.id)}`).toBe(201);
    expect(answer.body, `trace ${String(body.id)}`).toEqual(stored(body.id));
  }
});

test("C7: text from the preview key is stored, cut at its limit and flagged", { tag: ["@C7"] }, async ({ keyed }) => {
  const cases: [Record<string, unknown>, boolean, boolean][] = [
    [{ prompt: "only a prompt" }, true, false],
    [{ response: "only a response" }, true, false],
    [{ prompt: "", response: "" }, false, false],
    [{ prompt: "p".repeat(8_192), response: "" }, true, false],
    [{ prompt: "short", response: "r".repeat(8_193) }, true, true],
  ];
  for (const [text, hasText, textTruncated] of cases) {
    const body = newTrace(text);
    const answer = await keyed.post("/api/traces", { key: "preview", json: body });
    expect(answer.status, `text ${JSON.stringify(text).slice(0, 60)}`).toBe(201);
    expect(answer.body, `text ${JSON.stringify(text).slice(0, 60)}`).toEqual(stored(body.id, hasText, textTruncated));
  }
});

test("C19: methods a route doesn't list get the 405, with no key", { tag: ["@C19"] }, async ({ request }) => {
  const notAllowed = { error: "method_not_allowed", message: "Method not allowed" };
  const evaluations = `/api/traces/${crypto.randomUUID()}/evaluations`;
  const calls: [string, string][] = [
    ["GET", "/api/traces"],
    ["PUT", "/api/traces"],
    ["PATCH", "/api/traces"],
    ["DELETE", "/api/traces"],
    ["GET", evaluations],
    ["PUT", evaluations],
    ["DELETE", evaluations],
    ["POST", "/api/summary"],
    ["PUT", "/api/summary"],
    ["DELETE", "/api/summary"],
    ["POST", "/api/traces/recent"],
    ["PUT", "/api/traces/recent"],
    ["DELETE", "/api/traces/recent"],
  ];
  for (const [method, path] of calls) {
    const response = await request.fetch(path, { method });
    expect(response.status(), `${method} ${path}`).toBe(405);
    expect(await response.json(), `${method} ${path}`).toEqual(notAllowed);
  }
});

test("C20: the removed notes routes get the template's 404", { tag: ["@C20"] }, async ({ request }) => {
  const notFound = { error: "Not found" };
  const id = crypto.randomUUID();

  const count = await request.get("/api/notes/count");
  expect(count.status()).toBe(404);
  expect(await count.json()).toEqual(notFound);

  const read = await request.get(`/api/notes/${id}`);
  expect(read.status()).toBe(404);
  expect(await read.json()).toEqual(notFound);

  const write = await request.put(`/api/notes/${id}`, { data: { text: "removed" } });
  expect(write.status()).toBe(404);
  expect(await write.json()).toEqual(notFound);
});

test("C21: JSON answers carry the JSON content type", { tag: ["@C21"] }, async ({ request, keyed }) => {
  const json = "application/json";

  expect((await request.get("/api/summary")).headers()["content-type"]).toContain(json);
  expect((await request.get("/api/traces/recent")).headers()["content-type"]).toContain(json);
  expect((await request.get("/api/traces")).headers()["content-type"]).toContain(json);
  expect((await request.get("/api/notes/count")).headers()["content-type"]).toContain(json);

  expect((await keyed.post("/api/traces", { key: "production", json: newTrace() })).contentType).toContain(json);
  expect((await keyed.post("/api/traces", { key: "production", raw: "[]" })).contentType).toContain(json);
  expect((await keyed.post("/api/traces", { json: newTrace() })).contentType).toContain(json);
  expect((await keyed.post(`/api/traces/${crypto.randomUUID()}/evaluations`, { key: "preview", json: {} })).contentType).toContain(json);
  expect((await keyed.post(`/api/traces/${crypto.randomUUID()}/evaluations`, { key: "preview", json: { criterion: "helpful", description: "Is it helpful?" } })).contentType).toContain(json);
});
