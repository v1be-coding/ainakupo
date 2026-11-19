import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findIngestKey,
  listRecentTraces,
  saveTrace,
  type StoredKey,
  type TraceRow,
} from "../db/ingest.js";
import { guardRequest } from "../limits/guard.js";
import { handler } from "./handler.js";
import { hashKey } from "./keys.js";

vi.mock("../limits/guard.js", () => ({ guardRequest: vi.fn() }));
// The per-key counter, always under its limit here (key-limit.test.ts covers it).
vi.mock("../limits/store.js", () => ({
  store: () => ({ send: () => Promise.resolve({ Attributes: { count: { N: "1" } } }) }),
}));
vi.mock("../db/trace-text.js", () => ({
  traceTextTable: () => "trace-text",
  putTraceText: vi.fn(),
  deleteTraceText: vi.fn(),
  getTraceText: vi.fn(),
}));
vi.mock("../db/ingest.js", () => ({
  findIngestKey: vi.fn(),
  saveTrace: vi.fn(),
  listRecentTraces: vi.fn(),
}));

// Made-up keys in the key format, seeded nowhere but this fake database.
const key = (prefix: "prod" | "prev", fill: string) => `aik_${prefix}_${fill.repeat(43)}`;
const TEST_PROD = key("prod", "A");
const TEST_PREV = key("prev", "B");
const OTHER_PROD = key("prod", "C");
// Stored as a preview key, so its production prefix doesn't match.
const MISMATCHED = key("prod", "D");
const VECTOR = "aik_prev_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample0";
const VECTOR_HASH = "eade39548ad6c9999ac39db313a03db05948d43e368d0b748aefd3c54a7fa8ab";

const INVALID_KEY = { error: "invalid_key", message: "Missing or unknown ingest key" };
const CONFLICT = { error: "trace_conflict", message: "Trace id belongs to another ingest key" };

// An in-memory stand-in for the database, behaving as the real queries do.
function fakeDatabase() {
  const keys = new Map<string, StoredKey>();
  const rows = new Map<string, TraceRow>();
  const addKey = (plain: string, episode: string, environment: StoredKey["environment"]) =>
    keys.set(hashKey(plain), {
      hash: hashKey(plain),
      episode,
      environment,
      textAllowed: environment === "preview",
    });

  addKey(TEST_PROD, "test-episode", "production");
  addKey(TEST_PREV, "test-episode", "preview");
  addKey(OTHER_PROD, "other-episode", "production");
  addKey(MISMATCHED, "other-episode", "preview");
  keys.set(VECTOR_HASH, {
    hash: VECTOR_HASH,
    episode: "vector-episode",
    environment: "preview",
    textAllowed: true,
  });

  vi.mocked(findIngestKey).mockImplementation((hash) => Promise.resolve(keys.get(hash) ?? null));
  vi.mocked(saveTrace).mockImplementation((row) => {
    const existing = rows.get(row.id.toLowerCase());
    if (existing && existing.keyHash !== row.keyHash) return Promise.resolve("conflict");
    rows.set(row.id.toLowerCase(), row);
    return Promise.resolve(existing ? "replaced" : "created");
  });
  vi.mocked(listRecentTraces).mockImplementation(() =>
    Promise.resolve(
      [...rows.values()]
        .filter((row) => row.environment === "production")
        .map((row) => ({
          id: row.id,
          runId: row.runId ?? null,
          episode: row.episode,
          feature: row.feature,
          provider: row.provider,
          model: row.model,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          durationMs: row.durationMs,
          costUsd: row.costUsd ?? null,
          status: row.status,
          startedAt: row.startedAt,
        })),
    ),
  );

  return { rows };
}

const newTrace = (overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  provider: "anthropic",
  model: "claude-haiku-5-5",
  feature: "chat",
  inputTokens: 120,
  outputTokens: 30,
  startedAt: new Date().toISOString(),
  durationMs: 450,
  status: "ok",
  ...overrides,
});

const post = (body: unknown, authorization?: string) =>
  handler({
    rawPath: "/api/traces",
    headers: authorization === undefined ? {} : { authorization },
    body: typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { http: { method: "POST" } },
  } as unknown as APIGatewayProxyEventV2);

const recent = async () => {
  const response = await handler({
    rawPath: "/api/traces/recent",
    headers: {},
    requestContext: { http: { method: "GET" } },
  } as unknown as APIGatewayProxyEventV2);
  return bodyOf(response) as { traces: Record<string, unknown>[] };
};

const bodyOf = (response: unknown) => JSON.parse((response as { body: string }).body) as unknown;
const statusOf = (response: unknown) => (response as { statusCode: number }).statusCode;

describe("hashKey", () => {
  it("is lowercase hex SHA-256 of the key's UTF-8 bytes (the spec's test vector)", () => {
    expect(hashKey(VECTOR)).toBe(VECTOR_HASH);
  });
});

describe("POST /api/traces key check", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fakeDatabase();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("looks a key up by its SHA-256 hash", async () => {
    const response = await post(newTrace(), `Bearer ${VECTOR}`);

    expect(statusOf(response)).toBe(201);
    expect(findIngestKey).toHaveBeenCalledWith(VECTOR_HASH);
  });

  it.each([
    ["no header", undefined],
    ["no Bearer", TEST_PROD],
    ["lowercase bearer", `bearer ${TEST_PROD}`],
    ["a malformed key", "Bearer aik_prod_short"],
    ["a UUID", `Bearer ${crypto.randomUUID()}`],
    ["an unknown key", `Bearer ${key("prod", "Z")}`],
    ["the preview key's random part under the production prefix", `Bearer ${key("prod", "B")}`],
    ["the production key's random part under the preview prefix", `Bearer ${key("prev", "A")}`],
    ["a stored key whose prefix isn't its environment's", `Bearer ${MISMATCHED}`],
  ])("answers %s with the 401, before reading the body", async (_name, authorization) => {
    const response = await post("not json", authorization);

    expect(response).toMatchObject({
      statusCode: 401,
      headers: { "content-type": "application/json" },
    });
    expect(bodyOf(response)).toEqual(INVALID_KEY);
    expect(saveTrace).not.toHaveBeenCalled();
  });

  it("refuses test-episode's keys under TARGET=production", async () => {
    vi.stubEnv("TARGET", "production");

    for (const plain of [TEST_PROD, TEST_PREV]) {
      const response = await post(newTrace(), `Bearer ${plain}`);
      expect(statusOf(response)).toBe(401);
      expect(bodyOf(response)).toEqual(INVALID_KEY);
    }
    expect(saveTrace).not.toHaveBeenCalled();

    expect(statusOf(await post(newTrace(), `Bearer ${OTHER_PROD}`))).toBe(201);
  });

  it("accepts test-episode's keys on a branch", async () => {
    vi.stubEnv("TARGET", "pr-12");

    expect(statusOf(await post(newTrace(), `Bearer ${TEST_PROD}`))).toBe(201);
    expect(statusOf(await post(newTrace(), `Bearer ${TEST_PREV}`))).toBe(201);
  });

  it("never returns the key", async () => {
    const response = await post(newTrace(), `Bearer ${TEST_PROD}`);

    expect(JSON.stringify(response)).not.toContain(TEST_PROD);
  });
});

describe("POST /api/traces storing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fakeDatabase();
  });

  it("answers the 400 for body when the body isn't a JSON object", async () => {
    for (const raw of ["not json", "[]", "null", '"a string"']) {
      const response = await post(raw, `Bearer ${TEST_PROD}`);
      expect(statusOf(response)).toBe(400);
      expect(bodyOf(response)).toEqual({
        error: "invalid_trace",
        field: "body",
        message: "Invalid trace field: body",
      });
    }
  });

  it("stores a new trace with 201 and drops a production key's text", async () => {
    const trace = newTrace({ prompt: "a message", response: "a reply" });

    const response = await post(trace, `Bearer ${TEST_PROD}`);

    expect(statusOf(response)).toBe(201);
    expect(bodyOf(response)).toEqual({ id: trace.id, hasText: false, textTruncated: false });
    expect(saveTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        id: trace.id,
        keyHash: hashKey(TEST_PROD),
        episode: "test-episode",
        environment: "production",
        hasText: false,
      }),
    );
  });

  it("replaces every field with 200 when the same key resends an id", async () => {
    const first = newTrace({ runId: crypto.randomUUID(), costUsd: 0.5 });
    const second = {
      id: first.id,
      runId: null,
      provider: "openai",
      model: "gpt-test",
      feature: "other",
      inputTokens: 7,
      outputTokens: 8,
      startedAt: new Date(Date.now() - 1000).toISOString(),
      durationMs: 9,
      costUsd: null,
      status: "error",
    };

    expect(statusOf(await post(first, `Bearer ${TEST_PROD}`))).toBe(201);
    const replaced = await post(second, `Bearer ${TEST_PROD}`);

    expect(statusOf(replaced)).toBe(200);
    expect(bodyOf(replaced)).toEqual({ id: first.id, hasText: false, textTruncated: false });
    const { traces } = await recent();
    expect(traces.find((t) => t.id === first.id)).toEqual({ ...second, episode: "test-episode" });
  });

  it.each([
    ["the same episode's other key", TEST_PREV],
    ["another episode's key", OTHER_PROD],
  ])("answers the 409 for an id sent with %s, and keeps the trace", async (_name, other) => {
    const original = newTrace({ costUsd: 0.25 });
    expect(statusOf(await post(original, `Bearer ${TEST_PROD}`))).toBe(201);

    const response = await post(
      newTrace({ id: original.id, inputTokens: 1, feature: "changed" }),
      `Bearer ${other}`,
    );

    expect(statusOf(response)).toBe(409);
    expect(bodyOf(response)).toEqual(CONFLICT);
    const { traces } = await recent();
    expect(traces.find((t) => t.id === original.id)).toEqual(
      expect.objectContaining({ inputTokens: 120, feature: "chat", costUsd: 0.25 }),
    );
  });
});

describe("GET /api/traces/recent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fakeDatabase();
  });

  it("lists exactly the listed fields, startedAt in the millisecond form, nulls for omitted ones", async () => {
    const trace = newTrace({ startedAt: "2026-11-19T10:20:30Z" });
    await post(trace, `Bearer ${TEST_PROD}`);

    const { traces } = await recent();

    expect(traces).toEqual([
      {
        id: trace.id,
        runId: null,
        episode: "test-episode",
        feature: "chat",
        provider: "anthropic",
        model: "claude-haiku-5-5",
        inputTokens: 120,
        outputTokens: 30,
        durationMs: 450,
        costUsd: null,
        status: "ok",
        startedAt: "2026-11-19T10:20:30.000Z",
      },
    ]);
  });

  it("leaves out preview traces", async () => {
    const preview = newTrace();
    await post(preview, `Bearer ${TEST_PREV}`);

    const { traces } = await recent();

    expect(traces).toEqual([]);
  });
});

it("runs no key check on the guard's refusal", async () => {
  vi.resetAllMocks();
  fakeDatabase();
  vi.mocked(guardRequest).mockResolvedValue({ statusCode: 429, body: "{}" });

  const response = await post(newTrace(), `Bearer ${TEST_PROD}`);

  expect(statusOf(response)).toBe(429);
  expect(findIngestKey).not.toHaveBeenCalled();
});
