import type { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findIngestKey } from "../db/ingest.js";
import { guardRequest } from "../limits/guard.js";
import { store, type Store } from "../limits/store.js";
import { handler } from "./handler.js";
import { authenticate, hashKey } from "./keys.js";

vi.mock("../limits/guard.js", () => ({ guardRequest: vi.fn() }));
vi.mock("../limits/store.js", () => ({ store: vi.fn() }));
vi.mock("../db/ingest.js", () => ({
  findIngestKey: vi.fn(),
  saveTrace: vi.fn(),
  listRecentTraces: vi.fn(),
}));

// A made-up preview key in the key format, known only to this fake database.
const KEY = `aik_prev_${"B".repeat(43)}`;
const UNKNOWN = `aik_prev_${"Z".repeat(43)}`;

const event = (key: string, rawPath = "/api/traces") =>
  ({
    rawPath,
    headers: { authorization: `Bearer ${key}` },
    requestContext: { http: { method: "POST" } },
    body: "{}",
  }) as unknown as APIGatewayProxyEventV2;

// A DynamoDB stand-in that counts like the real ADD does, per partition key.
function countingStore() {
  const counts = new Map<string, number>();
  const send = vi.fn((command: UpdateItemCommand) => {
    const pk = command.input.Key?.pk?.S ?? "";
    const count = (counts.get(pk) ?? 0) + 1;
    counts.set(pk, count);
    return Promise.resolve({ Attributes: { count: { N: String(count) } } });
  });
  return { db: { send } as unknown as Store, send };
}

describe("the per-key limit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("LIMITS_TABLE", "limits");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(findIngestKey).mockImplementation((hash) =>
      Promise.resolve(
        hash === hashKey(KEY)
          ? { hash, episode: "test-episode", environment: "preview", textAllowed: true }
          : null,
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("counts on the key hash, in a window starting on the UTC minute", async () => {
    vi.setSystemTime(new Date("2026-11-19T12:34:56.789Z"));
    const { db, send } = countingStore();

    await authenticate(event(KEY), db);

    const command = send.mock.calls[0]?.[0];
    const windowStart = Date.UTC(2026, 10, 19, 12, 34, 0) / 1000;
    expect(windowStart % 60).toBe(0);
    expect(command.input).toMatchObject({
      TableName: "limits",
      Key: { pk: { S: `key#${hashKey(KEY)}#${windowStart}` } },
    });
  });

  it("allows 60 requests in a minute and answers the 61st with the 429", async () => {
    vi.setSystemTime(new Date("2026-11-19T12:00:01Z"));
    const { db } = countingStore();

    for (let i = 0; i < 60; i++) {
      expect(await authenticate(event(KEY), db)).toMatchObject({ ok: true });
    }
    vi.setSystemTime(new Date("2026-11-19T12:00:15.500Z"));
    const check = await authenticate(event(KEY), db);

    expect(check).toEqual({
      ok: false,
      response: {
        statusCode: 429,
        headers: { "retry-after": "45", "content-type": "application/json" },
        body: JSON.stringify({
          error: "key_rate_limited",
          message: "Too many requests for this ingest key",
          retryAfterSeconds: 45,
        }),
      },
    });
  });

  it("starts again in the next minute", async () => {
    vi.setSystemTime(new Date("2026-11-19T12:00:30Z"));
    const { db } = countingStore();
    for (let i = 0; i < 61; i++) await authenticate(event(KEY), db);

    vi.setSystemTime(new Date("2026-11-19T12:01:00Z"));
    expect(await authenticate(event(KEY), db)).toMatchObject({ ok: true });
  });

  it("asks for between 1 and 60 seconds", async () => {
    const { db, send } = countingStore();
    send.mockResolvedValue({ Attributes: { count: { N: "61" } } });

    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    const first = await authenticate(event(KEY), db);
    vi.setSystemTime(new Date("2026-11-19T12:00:59.999Z"));
    const last = await authenticate(event(KEY), db);

    expect(first).toMatchObject({ ok: false, response: { headers: { "retry-after": "60" } } });
    expect(last).toMatchObject({ ok: false, response: { headers: { "retry-after": "1" } } });
  });

  it("doesn't count a request with an invalid key", async () => {
    const { db, send } = countingStore();

    const check = await authenticate(event(UNKNOWN), db);

    expect(check).toMatchObject({ ok: false, response: { statusCode: 401 } });
    expect(send).not.toHaveBeenCalled();
  });

  it("lets the request through if the counter fails, like the per-IP limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, send } = countingStore();
    send.mockRejectedValue(new Error("throttled"));

    expect(await authenticate(event(KEY), db)).toMatchObject({ ok: true });
  });

  it("runs after the per-IP limit, which answers without counting the key", async () => {
    const { db, send } = countingStore();
    vi.mocked(store).mockReturnValue(db);
    vi.mocked(guardRequest).mockResolvedValue({ statusCode: 429, body: "{}" });

    const response = await handler(event(KEY));

    expect(response).toMatchObject({ statusCode: 429 });
    expect(findIngestKey).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
