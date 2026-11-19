import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findIngestKey, saveTrace, type StoredKey, type TraceRow } from "../db/ingest.js";
import { deleteTraceText, putTraceText, type TraceText } from "../db/trace-text.js";
import { handler } from "./handler.js";
import { hashKey } from "./keys.js";

vi.mock("../limits/guard.js", () => ({ guardRequest: vi.fn() }));
vi.mock("../limits/store.js", () => ({ store: () => ({}) }));
vi.mock("../db/ingest.js", () => ({
  findIngestKey: vi.fn(),
  saveTrace: vi.fn(),
  listRecentTraces: vi.fn(),
}));
vi.mock("../db/trace-text.js", () => ({
  traceTextTable: () => "trace-text",
  putTraceText: vi.fn(),
  deleteTraceText: vi.fn(),
  getTraceText: vi.fn(),
}));

// Made-up keys in the key format, seeded nowhere but this fake database.
const PROD = `aik_prod_${"A".repeat(43)}`;
const PREV = `aik_prev_${"B".repeat(43)}`;

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function fakeStores() {
  const keys = new Map<string, StoredKey>();
  for (const [plain, environment] of [
    [PROD, "production"],
    [PREV, "preview"],
  ] as const) {
    keys.set(hashKey(plain), {
      hash: hashKey(plain),
      episode: "test-episode",
      environment,
      textAllowed: environment === "preview",
    });
  }
  const rows = new Map<string, TraceRow>();
  const texts = new Map<string, TraceText>();

  vi.mocked(findIngestKey).mockImplementation((hash) => Promise.resolve(keys.get(hash) ?? null));
  vi.mocked(saveTrace).mockImplementation((row) => {
    const existing = rows.get(row.id.toLowerCase());
    if (existing && existing.keyHash !== row.keyHash) return Promise.resolve("conflict");
    rows.set(row.id.toLowerCase(), row);
    return Promise.resolve(existing ? "replaced" : "created");
  });
  vi.mocked(putTraceText).mockImplementation((_db, _table, id, _startedAt, text) => {
    texts.set(id, text);
    return Promise.resolve();
  });
  vi.mocked(deleteTraceText).mockImplementation((_db, _table, id) => {
    texts.delete(id);
    return Promise.resolve();
  });
  return { rows, texts };
}

const newTrace = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: crypto.randomUUID(),
  provider: "anthropic",
  model: "claude-haiku-5-5",
  feature: "chat",
  inputTokens: 120,
  outputTokens: 30,
  startedAt: new Date(NOW).toISOString(),
  durationMs: 450,
  status: "ok",
  ...overrides,
});

const post = (body: unknown, key = PROD, isBase64Encoded = false) =>
  handler({
    rawPath: "/api/traces",
    headers: { authorization: `Bearer ${key}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded,
    requestContext: { http: { method: "POST" } },
  } as unknown as APIGatewayProxyEventV2);

const bodyOf = (response: unknown) => JSON.parse((response as { body: string }).body) as unknown;
const statusOf = (response: unknown) => (response as { statusCode: number }).statusCode;
const invalid = (field: string) => ({
  error: "invalid_trace",
  field,
  message: `Invalid trace field: ${field}`,
});

// A trace's JSON padded through its prompt to exactly `bytes` UTF-8 bytes.
function bodyOfBytes(bytes: number, pad = "x"): { raw: string; id: unknown } {
  const trace = newTrace({ prompt: "" });
  const base = Buffer.byteLength(JSON.stringify(trace));
  const padBytes = Buffer.byteLength(pad);
  const fill = bytes - base;
  if (fill % padBytes !== 0) throw new Error("padding doesn't divide evenly");
  return { raw: JSON.stringify({ ...trace, prompt: pad.repeat(fill / padBytes) }), id: trace.id };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/traces body", () => {
  it.each(["not json", "[]", "null", '"a string"', "{", "", "5", "true"])(
    "answers the 400 for body when the body is %j",
    async (raw) => {
      fakeStores();
      const response = await post(raw);

      expect(statusOf(response)).toBe(400);
      expect(bodyOf(response)).toEqual(invalid("body"));
      expect(saveTrace).not.toHaveBeenCalled();
    },
  );

  it("stores a body of exactly 65,536 bytes and refuses one byte more", async () => {
    fakeStores();
    const exact = bodyOfBytes(65_536);
    expect(statusOf(await post(exact.raw))).toBe(201);

    const over = bodyOfBytes(65_537);
    const response = await post(over.raw);
    expect(statusOf(response)).toBe(400);
    expect(bodyOf(response)).toEqual(invalid("body"));
  });

  it("counts UTF-8 bytes, not characters", async () => {
    fakeStores();
    // "é" is 2 bytes: the string is shorter than 65,537 characters but over in bytes.
    const over = bodyOfBytes(65_538, "é");
    expect(over.raw.length).toBeLessThan(65_536);

    expect(bodyOf(await post(over.raw))).toEqual(invalid("body"));
  });

  it("decodes a base64 body before checking it, and measures the decoded bytes", async () => {
    fakeStores();
    const exact = bodyOfBytes(65_536);
    const encoded = Buffer.from(exact.raw).toString("base64");
    expect(statusOf(await post(encoded, PROD, true))).toBe(201);

    const over = Buffer.from(bodyOfBytes(65_537).raw).toString("base64");
    expect(bodyOf(await post(over, PROD, true))).toEqual(invalid("body"));
  });
});

describe("POST /api/traces field rules", () => {
  const breaches: [string, Record<string, unknown>][] = [
    ["id", { id: undefined }],
    ["id", { id: "not-a-uuid" }],
    ["id", { id: "11111111-1111-1111-1111-11111111111" }],
    ["id", { id: "11111111-1111-1111-1111-1111111111111" }],
    ["id", { id: "g1111111-1111-1111-1111-111111111111" }],
    ["id", { id: "111111111111-1111-1111-1111-11111111" }],
    ["id", { id: 5 }],
    ["id", { id: null }],
    ["runId", { runId: "not-a-uuid" }],
    ["runId", { runId: 5 }],
    ["runId", { runId: "" }],
    ["provider", { provider: undefined }],
    ["provider", { provider: "" }],
    ["provider", { provider: "Anthropic" }],
    ["provider", { provider: "a_b" }],
    ["provider", { provider: "a".repeat(51) }],
    ["provider", { provider: 5 }],
    ["model", { model: undefined }],
    ["model", { model: "" }],
    ["model", { model: "m".repeat(101) }],
    ["model", { model: "bad\u0007model" }],
    ["model", { model: "bad\u0000model" }],
    ["model", { model: "tab\tmodel" }],
    ["model", { model: "line\nmodel" }],
    ["model", { model: "del\u007fmodel" }],
    ["model", { model: "c1\u0085model" }],
    ["model", { model: "c1\u009fmodel" }],
    ["model", { model: 5 }],
    ["feature", { feature: undefined }],
    ["feature", { feature: "has space" }],
    ["feature", { feature: "f".repeat(51) }],
    ["inputTokens", { inputTokens: undefined }],
    ["inputTokens", { inputTokens: -1 }],
    ["inputTokens", { inputTokens: 1.5 }],
    ["inputTokens", { inputTokens: "10" }],
    ["inputTokens", { inputTokens: true }],
    ["inputTokens", { inputTokens: null }],
    ["inputTokens", { inputTokens: 10_000_001 }],
    ["outputTokens", { outputTokens: undefined }],
    ["outputTokens", { outputTokens: -1 }],
    ["outputTokens", { outputTokens: 10_000_001 }],
    ["startedAt", { startedAt: undefined }],
    ["startedAt", { startedAt: "2026-11-19" }],
    ["startedAt", { startedAt: "2026-11-19T12:00:00+00:00" }],
    ["startedAt", { startedAt: "2026-11-19T12:00:00" }],
    ["startedAt", { startedAt: "2026-11-19T12:00:00.0Z" }],
    ["startedAt", { startedAt: "2026-11-19T12:00:00.0000Z" }],
    ["startedAt", { startedAt: "2026-11-19 12:00:00Z" }],
    ["startedAt", { startedAt: "2026-11-19t12:00:00z" }],
    ["startedAt", { startedAt: "2026-11-19T25:00:00Z" }],
    ["startedAt", { startedAt: NOW }],
    ["startedAt", { startedAt: new Date(NOW - 7 * DAY - MINUTE).toISOString() }],
    ["startedAt", { startedAt: new Date(NOW - 7 * DAY - 1).toISOString() }],
    ["startedAt", { startedAt: new Date(NOW + 6 * MINUTE).toISOString() }],
    ["startedAt", { startedAt: new Date(NOW + 5 * MINUTE + 1).toISOString() }],
    ["durationMs", { durationMs: undefined }],
    ["durationMs", { durationMs: -1 }],
    ["durationMs", { durationMs: 1.5 }],
    ["durationMs", { durationMs: 3_600_001 }],
    ["costUsd", { costUsd: -0.01 }],
    ["costUsd", { costUsd: 1000.01 }],
    ["costUsd", { costUsd: "1" }],
    ["costUsd", { costUsd: false }],
    ["status", { status: "OK" }],
    ["status", { status: undefined }],
    ["status", { status: null }],
    ["prompt", { prompt: 5 }],
    ["prompt", { prompt: null }],
    ["response", { response: { text: "x" } }],
    ["response", { response: ["x"] }],
  ];

  it.each(breaches)("names %s for %j", async (field, overrides) => {
    fakeStores();
    const response = await post(newTrace(overrides), PREV);

    expect(statusOf(response)).toBe(400);
    expect(bodyOf(response)).toEqual(invalid(field));
    expect(saveTrace).not.toHaveBeenCalled();
    expect(putTraceText).not.toHaveBeenCalled();
  });

  it("refuses a startedAt that isn't a real date, even inside the window", async () => {
    fakeStores();
    vi.setSystemTime(Date.parse("2026-03-01T12:00:00.000Z"));

    const response = await post(newTrace({ startedAt: "2026-02-29T12:00:00Z" }));

    expect(bodyOf(response)).toEqual(invalid("startedAt"));
  });

  it("names the field first in the table, whatever the body's order", async () => {
    fakeStores();
    const rest = Object.fromEntries(
      Object.entries(newTrace()).filter(([field]) => field !== "id" && field !== "status"),
    );
    const raw = JSON.stringify({ status: "OK", ...rest, id: "not-a-uuid" });

    expect(bodyOf(await post(raw))).toEqual(invalid("id"));
    expect(bodyOf(await post(newTrace({ provider: undefined, status: "OK" })))).toEqual(
      invalid("provider"),
    );
    expect(bodyOf(await post(newTrace({ costUsd: "x", prompt: 5 })))).toEqual(invalid("costUsd"));
  });

  it("names unknown fields after every table field, in body order", async () => {
    fakeStores();
    const unknownFirst = JSON.stringify({
      apiKey: "sk-not-a-real-key",
      ...newTrace({ status: "OK" }),
    });

    expect(bodyOf(await post(unknownFirst))).toEqual(invalid("status"));
    expect(bodyOf(await post(newTrace({ apiKey: "x" })))).toEqual(invalid("apiKey"));
    expect(bodyOf(await post(newTrace({ zeta: 1, alpha: 2 })))).toEqual(invalid("zeta"));
    expect(bodyOf(await post(newTrace({ hasText: true })))).toEqual(invalid("hasText"));
  });

  it("stores values at each rule's edges", async () => {
    const { rows } = fakeStores();
    const edges = [
      newTrace({
        id: crypto.randomUUID().toUpperCase(),
        runId: null,
        provider: `p-${"0".repeat(48)}`,
        model: "é".repeat(100),
        feature: `f-${"z".repeat(48)}`,
        inputTokens: 0,
        outputTokens: 10_000_000,
        startedAt: new Date(NOW - 7 * DAY).toISOString(),
        durationMs: 0,
        costUsd: 0,
      }),
      newTrace({
        runId: crypto.randomUUID(),
        provider: "a",
        model: "m",
        feature: "f",
        inputTokens: 10_000_000,
        outputTokens: 0,
        startedAt: new Date(NOW + 5 * MINUTE).toISOString(),
        durationMs: 3_600_000,
        costUsd: 1000,
        status: "error",
      }),
      newTrace({ startedAt: "2026-11-19T12:00:00Z", costUsd: null, prompt: "", response: "" }),
      newTrace({ startedAt: new Date(NOW - 7 * DAY + MINUTE).toISOString(), model: "a b/c:1.0" }),
      newTrace({ startedAt: new Date(NOW + 4 * MINUTE).toISOString(), inputTokens: 1e3 }),
    ];

    for (const body of edges) {
      const response = await post(body, PREV);
      expect(statusOf(response)).toBe(201);
      expect(bodyOf(response)).toEqual({ id: body.id, hasText: false, textTruncated: false });
    }
    const third = rows.get(String(edges[2]?.id));
    expect(third).toMatchObject({
      runId: null,
      costUsd: null,
      startedAt: new Date("2026-11-19T12:00:00.000Z"),
    });
  });
});

describe("POST /api/traces text", () => {
  it("drops a production key's text", async () => {
    fakeStores();
    const response = await post(newTrace({ prompt: "p", response: "r".repeat(9_000) }), PROD);

    expect(bodyOf(response)).toMatchObject({ hasText: false, textTruncated: false });
    expect(saveTrace).toHaveBeenCalledWith(expect.objectContaining({ hasText: false }));
    expect(putTraceText).not.toHaveBeenCalled();
    expect(deleteTraceText).not.toHaveBeenCalled();
  });

  it.each([
    [{ prompt: "only a prompt" }, true, false, { prompt: "only a prompt", response: null }],
    [{ response: "only a response" }, true, false, { prompt: null, response: "only a response" }],
    [{ prompt: "", response: "" }, false, false, null],
    [{}, false, false, null],
    [
      { prompt: "p".repeat(8_192), response: "" },
      true,
      false,
      { prompt: "p".repeat(8_192), response: null },
    ],
    [
      { prompt: "short", response: "r".repeat(8_193) },
      true,
      true,
      { prompt: "short", response: "r".repeat(8_192) },
    ],
    [{ prompt: "p".repeat(8_193) }, true, true, { prompt: "p".repeat(8_192), response: null }],
  ])("stores a preview key's text %#", async (text, hasText, textTruncated, storedText) => {
    const { texts, rows } = fakeStores();
    const body = newTrace(text);

    const response = await post(body, PREV);

    expect(statusOf(response)).toBe(201);
    expect(bodyOf(response)).toEqual({ id: body.id, hasText, textTruncated });
    expect(rows.get(String(body.id))?.hasText).toBe(hasText);
    expect(texts.get(String(body.id)) ?? null).toEqual(storedText);
  });

  it("cuts at 8,192 UTF-16 code units", async () => {
    const { texts } = fakeStores();
    const body = newTrace({ prompt: "😀".repeat(4_097) });

    const response = await post(body, PREV);

    expect(bodyOf(response)).toMatchObject({ hasText: true, textTruncated: true });
    expect(texts.get(String(body.id))?.prompt).toBe("😀".repeat(4_096));
  });

  it("keys the text by the lowercase id the database reads back", async () => {
    const { texts } = fakeStores();
    const id = crypto.randomUUID();

    await post(newTrace({ id: id.toUpperCase(), prompt: "hi" }), PREV);

    expect(texts.get(id)).toEqual({ prompt: "hi", response: null });
  });

  it("writes the text after the trace is saved, with the trace's start", async () => {
    fakeStores();
    const order: string[] = [];
    vi.mocked(saveTrace).mockImplementation(() => {
      order.push("save");
      return Promise.resolve("created");
    });
    vi.mocked(putTraceText).mockImplementation(() => {
      order.push("text");
      return Promise.resolve();
    });

    const body = newTrace({ prompt: "hi" });
    await post(body, PREV);

    expect(order).toEqual(["save", "text"]);
    expect(putTraceText).toHaveBeenCalledWith(
      expect.anything(),
      "trace-text",
      body.id,
      new Date(NOW),
      { prompt: "hi", response: null },
    );
  });

  it("replaces the text on a resend, and removes it when the resend has none", async () => {
    const { texts } = fakeStores();
    const body = newTrace({ prompt: "first", response: "reply" });

    await post(body, PREV);
    const replaced = await post({ ...body, prompt: "second", response: undefined }, PREV);
    expect(statusOf(replaced)).toBe(200);
    expect(texts.get(String(body.id))).toEqual({ prompt: "second", response: null });

    const emptied = await post({ ...body, prompt: "", response: undefined }, PREV);
    expect(statusOf(emptied)).toBe(200);
    expect(bodyOf(emptied)).toEqual({ id: body.id, hasText: false, textTruncated: false });
    expect(texts.has(String(body.id))).toBe(false);
  });

  it("leaves the text alone on a conflict", async () => {
    const { texts } = fakeStores();
    const body = newTrace({ prompt: "mine" });
    await post(body, PREV);

    const response = await post({ ...body, prompt: "theirs" }, PROD);

    expect(statusOf(response)).toBe(409);
    expect(texts.get(String(body.id))).toEqual({ prompt: "mine", response: null });
    expect(deleteTraceText).not.toHaveBeenCalled();
  });

  it("fails the request when the text write fails, and a retry stores it", async () => {
    const { texts } = fakeStores();
    vi.mocked(putTraceText).mockRejectedValueOnce(new Error("DynamoDB unavailable"));
    const body = newTrace({ prompt: "hi" });

    await expect(post(body, PREV)).rejects.toThrow("DynamoDB unavailable");
    expect(texts.size).toBe(0);

    vi.mocked(putTraceText).mockImplementation((_db, _table, id, _startedAt, text) => {
      texts.set(id, text);
      return Promise.resolve();
    });
    const retry = await post(body, PREV);
    expect(statusOf(retry)).toBe(200);
    expect(bodyOf(retry)).toEqual({ id: body.id, hasText: true, textTruncated: false });
    expect(texts.get(String(body.id))).toEqual({ prompt: "hi", response: null });
  });

  it("never logs the text", async () => {
    fakeStores();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );

    await post(newTrace({ prompt: "secret prompt", response: "secret reply" }), PREV);
    await post(newTrace({ prompt: 5 }), PREV);

    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
      spy.mockRestore();
    }
  });
});
