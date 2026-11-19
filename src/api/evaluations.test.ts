import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findTrace, type JudgedTrace } from "../db/evaluations.js";
import { findIngestKey, type StoredKey } from "../db/ingest.js";
import { getTraceText, type TraceText } from "../db/trace-text.js";
import { handler } from "./handler.js";
import { judgeTrace } from "./judge.js";
import { hashKey } from "./keys.js";

vi.mock("../limits/guard.js", () => ({ guardRequest: vi.fn() }));
vi.mock("../db/ingest.js", () => ({ findIngestKey: vi.fn() }));
vi.mock("../db/evaluations.js", () => ({ findTrace: vi.fn() }));
vi.mock("../db/trace-text.js", () => ({ getTraceText: vi.fn(), traceTextTable: () => "text" }));
vi.mock("./judge.js", () => ({ judgeTrace: vi.fn() }));

// Made-up keys in the key format, seeded nowhere but this fake database.
const key = (prefix: "prod" | "prev", fill: string) => `aik_${prefix}_${fill.repeat(43)}`;
const TEST_PROD = key("prod", "A");
const TEST_PREV = key("prev", "B");
const OTHER_PREV = key("prev", "C");

const DAY_MS = 24 * 60 * 60 * 1000;
const INVALID_KEY = { error: "invalid_key", message: "Missing or unknown ingest key" };
const INVALID_CRITERION = {
  error: "invalid_criterion",
  message:
    "Criterion must be 1 to 50 lowercase letters or hyphens, and description 1 to 1000 characters",
};
const TRACE_NOT_FOUND = { error: "trace_not_found", message: "Trace not found" };
const NO_TEXT = { error: "no_text", message: "Trace has no text to judge" };
const JUDGED = { statusCode: 201, headers: { "content-type": "application/json" }, body: "{}" };

const criterion = { criterion: "helpful", description: "Does the response help?" };

// In-memory stand-ins for the database and the text store, behaving as the real reads do.
function fakeStores() {
  const keys = new Map<string, StoredKey>();
  const traces = new Map<string, JudgedTrace>();
  const texts = new Map<string, TraceText>();
  const addKey = (plain: string, episode: string, environment: StoredKey["environment"]) =>
    keys.set(hashKey(plain), {
      hash: hashKey(plain),
      episode,
      environment,
      textAllowed: environment === "preview",
    });
  addKey(TEST_PROD, "test-episode", "production");
  addKey(TEST_PREV, "test-episode", "preview");
  addKey(OTHER_PREV, "other-episode", "preview");

  vi.mocked(findIngestKey).mockImplementation((hash) => Promise.resolve(keys.get(hash) ?? null));
  vi.mocked(findTrace).mockImplementation((id) =>
    Promise.resolve(traces.get(id.toLowerCase()) ?? null),
  );
  vi.mocked(getTraceText).mockImplementation((_db, _table, id) =>
    Promise.resolve(texts.get(id) ?? null),
  );
  vi.mocked(judgeTrace).mockResolvedValue(JUDGED);

  // A trace with text, started `ageMs` ago. The fake store keeps text whatever its
  // age, so the route's own age check is what's tested.
  const addTrace = (episode: string, ageMs = 0, text: TraceText | null = TEXT) => {
    const id = crypto.randomUUID();
    traces.set(id, { id, episode, startedAt: new Date(Date.now() - ageMs), hasText: !!text });
    if (text) texts.set(id, text);
    return id;
  };
  return { addTrace };
}

const TEXT: TraceText = { prompt: "What is 2 + 2?", response: "4" };

const post = (traceId: string, body: unknown, authorization?: string) =>
  handler({
    rawPath: `/api/traces/${traceId}/evaluations`,
    headers: authorization === undefined ? {} : { authorization },
    body: typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { http: { method: "POST" } },
  } as unknown as APIGatewayProxyEventV2);

const bodyOf = (response: unknown) => JSON.parse((response as { body: string }).body) as unknown;
const statusOf = (response: unknown) => (response as { statusCode: number }).statusCode;

describe("POST /api/traces/{id}/evaluations checks", () => {
  let stores: ReturnType<typeof fakeStores>;

  beforeEach(() => {
    vi.resetAllMocks();
    stores = fakeStores();
  });

  it("answers an invalid key with the 401, before the body", async () => {
    const response = await post(
      crypto.randomUUID(),
      { criterion: "BAD" },
      `Bearer ${key("prod", "Z")}`,
    );

    expect(statusOf(response)).toBe(401);
    expect(bodyOf(response)).toEqual(INVALID_KEY);
    expect(findTrace).not.toHaveBeenCalled();
  });

  it.each([
    ["an extra field", JSON.stringify({ ...criterion, score: 5 })],
    ["no description", JSON.stringify({ criterion: "helpful" })],
    ["no criterion", JSON.stringify({ description: "Is it helpful?" })],
    ["an uppercase criterion", JSON.stringify({ ...criterion, criterion: "Helpful" })],
    ["a digit in the criterion", JSON.stringify({ ...criterion, criterion: "helpful1" })],
    ["an empty criterion", JSON.stringify({ ...criterion, criterion: "" })],
    ["a 51-letter criterion", JSON.stringify({ ...criterion, criterion: "a".repeat(51) })],
    ["a criterion that isn't a string", JSON.stringify({ ...criterion, criterion: 5 })],
    ["an empty description", JSON.stringify({ ...criterion, description: "" })],
    [
      "a 1,001-character description",
      JSON.stringify({ ...criterion, description: "d".repeat(1001) }),
    ],
    ["a description that isn't a string", JSON.stringify({ ...criterion, description: 5 })],
    ["a body that isn't JSON", "not json"],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
  ])("answers %s with the 400, even for an unknown trace", async (_name, raw) => {
    const response = await post("not-a-uuid", raw, `Bearer ${TEST_PREV}`);

    expect(response).toMatchObject({
      statusCode: 400,
      headers: { "content-type": "application/json" },
    });
    expect(bodyOf(response)).toEqual(INVALID_CRITERION);
    expect(findTrace).not.toHaveBeenCalled();
  });

  it("reads a base64-encoded body", async () => {
    const id = stores.addTrace("test-episode");
    const response = await handler({
      rawPath: `/api/traces/${id}/evaluations`,
      headers: { authorization: `Bearer ${TEST_PREV}` },
      body: Buffer.from(JSON.stringify(criterion)).toString("base64"),
      isBase64Encoded: true,
      requestContext: { http: { method: "POST" } },
    } as unknown as APIGatewayProxyEventV2);

    expect(statusOf(response)).toBe(201);
  });

  it("lets a criterion and description at their longest through to the 404", async () => {
    const longest = {
      criterion: `${"a".repeat(25)}-${"b".repeat(24)}`,
      description: "d".repeat(1000),
    };

    const response = await post(crypto.randomUUID(), longest, `Bearer ${TEST_PREV}`);

    expect(statusOf(response)).toBe(404);
    expect(bodyOf(response)).toEqual(TRACE_NOT_FOUND);
  });

  it("answers an id that isn't a UUID with the 404, without a lookup", async () => {
    const response = await post("not-a-uuid", criterion, `Bearer ${TEST_PREV}`);

    expect(statusOf(response)).toBe(404);
    expect(bodyOf(response)).toEqual(TRACE_NOT_FOUND);
    expect(findTrace).not.toHaveBeenCalled();
  });

  it("answers an unknown trace with the 404", async () => {
    const response = await post(crypto.randomUUID(), criterion, `Bearer ${TEST_PROD}`);

    expect(statusOf(response)).toBe(404);
    expect(bodyOf(response)).toEqual(TRACE_NOT_FOUND);
  });

  it("answers another episode's trace with the 404, and reads none of its text", async () => {
    const id = stores.addTrace("test-episode");

    const response = await post(id, criterion, `Bearer ${OTHER_PREV}`);

    expect(statusOf(response)).toBe(404);
    expect(bodyOf(response)).toEqual(TRACE_NOT_FOUND);
    expect(getTraceText).not.toHaveBeenCalled();
    expect(judgeTrace).not.toHaveBeenCalled();
  });

  it("lets either key of the owning episode judge, and an uppercase id finds the trace", async () => {
    const id = stores.addTrace("test-episode");

    expect(statusOf(await post(id, criterion, `Bearer ${TEST_PREV}`))).toBe(201);
    expect(statusOf(await post(id.toUpperCase(), criterion, `Bearer ${TEST_PROD}`))).toBe(201);
    expect(judgeTrace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        trace: expect.objectContaining({ id }) as unknown,
        text: TEXT,
        ...criterion,
        key: expect.objectContaining({
          episode: "test-episode",
          environment: "production",
        }) as unknown,
      }),
    );
  });

  it("answers the 422 for text whose trace started over 30 days ago", async () => {
    const id = stores.addTrace("test-episode", 30 * DAY_MS + 60_000);

    const response = await post(id, criterion, `Bearer ${TEST_PREV}`);

    expect(response).toMatchObject({
      statusCode: 422,
      headers: { "content-type": "application/json" },
    });
    expect(bodyOf(response)).toEqual(NO_TEXT);
    expect(judgeTrace).not.toHaveBeenCalled();
  });

  it("still judges text whose trace started just under 30 days ago", async () => {
    const id = stores.addTrace("test-episode", 30 * DAY_MS - 60_000);

    expect(statusOf(await post(id, criterion, `Bearer ${TEST_PREV}`))).toBe(201);
  });

  it("answers the 422 for a trace with no stored text", async () => {
    const id = stores.addTrace("test-episode", 0, null);

    const response = await post(id, criterion, `Bearer ${TEST_PROD}`);

    expect(statusOf(response)).toBe(422);
    expect(bodyOf(response)).toEqual(NO_TEXT);
    expect(judgeTrace).not.toHaveBeenCalled();
  });
});
