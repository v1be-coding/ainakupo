import { DeleteItemCommand, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { describe, expect, it, vi } from "vitest";
import type { Store } from "../limits/store.js";
import { deleteTraceText, getTraceText, putTraceText, traceTextTable } from "./trace-text.js";

type Item = Record<string, AttributeValue>;

// An in-memory table that answers the three commands the store sends.
function fakeTable() {
  const tables = new Map<string, Map<string, Item>>();
  const rows = (name: string | undefined) => {
    const key = name ?? "";
    if (!tables.has(key)) tables.set(key, new Map());
    return tables.get(key) as Map<string, Item>;
  };
  const id = (key: Item | undefined) => key?.traceId?.S ?? "";
  const sent: unknown[] = [];

  const send = (command: unknown) => {
    sent.push(command);
    if (command instanceof PutItemCommand) {
      const item = command.input.Item ?? {};
      rows(command.input.TableName).set(id(item), item);
      return Promise.resolve({});
    }
    if (command instanceof GetItemCommand) {
      return Promise.resolve({ Item: rows(command.input.TableName).get(id(command.input.Key)) });
    }
    if (command instanceof DeleteItemCommand) {
      rows(command.input.TableName).delete(id(command.input.Key));
      return Promise.resolve({});
    }
    return Promise.reject(new Error("unexpected command"));
  };

  return { db: { send } as unknown as Store, sent, rows };
}

const traceId = "5f0c9a52-3c1e-4c64-9d0e-0d6f2b7a1e11";
const startedAt = new Date("2026-11-01T10:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

describe("trace text store", () => {
  it("gives back the text it was given", async () => {
    const { db } = fakeTable();

    await putTraceText(db, "text", traceId, startedAt, { prompt: "Hi", response: "Hello" });

    expect(await getTraceText(db, "text", traceId, startedAt.getTime())).toEqual({
      prompt: "Hi",
      response: "Hello",
    });
  });

  it("keeps a missing half missing", async () => {
    const { db } = fakeTable();

    await putTraceText(db, "text", traceId, startedAt, { prompt: null, response: "Only this" });

    expect(await getTraceText(db, "text", traceId, startedAt.getTime())).toEqual({
      prompt: null,
      response: "Only this",
    });
  });

  it("has nothing for a trace it never stored", async () => {
    const { db } = fakeTable();

    expect(await getTraceText(db, "text", traceId)).toBeNull();
  });

  it("replaces the text when a trace is sent again", async () => {
    const { db } = fakeTable();

    await putTraceText(db, "text", traceId, startedAt, { prompt: "Old", response: "Old" });
    await putTraceText(db, "text", traceId, startedAt, { prompt: "New", response: null });

    expect(await getTraceText(db, "text", traceId, startedAt.getTime())).toEqual({
      prompt: "New",
      response: null,
    });
  });

  it("forgets text once deleted, and a repeated delete is harmless", async () => {
    const { db } = fakeTable();
    await putTraceText(db, "text", traceId, startedAt, { prompt: "Hi", response: null });

    await deleteTraceText(db, "text", traceId);
    await deleteTraceText(db, "text", traceId);

    expect(await getTraceText(db, "text", traceId, startedAt.getTime())).toBeNull();
  });

  it("asks DynamoDB to expire the text 30 days after the trace started (ADR-0001)", async () => {
    const { db, rows } = fakeTable();

    await putTraceText(db, "text", traceId, startedAt, { prompt: "Hi", response: null });

    // 2026-12-01T10:00:00Z in epoch seconds.
    expect(rows("text").get(traceId)?.expires).toEqual({ N: "1796119200" });
  });

  it("counts text as absent once its trace started over 30 days ago, before DynamoDB removes it", async () => {
    const { db } = fakeTable();
    await putTraceText(db, "text", traceId, startedAt, { prompt: "Hi", response: null });

    const lastMoment = startedAt.getTime() + 30 * day;
    expect(await getTraceText(db, "text", traceId, lastMoment)).not.toBeNull();
    expect(await getTraceText(db, "text", traceId, lastMoment + 1)).toBeNull();
  });

  it("reads strongly, so the judge sees text stored a moment ago", async () => {
    const { db, sent } = fakeTable();

    await getTraceText(db, "text", traceId);

    const get = sent.find((c) => c instanceof GetItemCommand);
    expect(get?.input).toMatchObject({ TableName: "text", ConsistentRead: true });
  });

  it("takes its table's name from the Lambda's settings", () => {
    vi.stubEnv("TRACE_TEXT_TABLE", "v1be-ainakupo-trace-text-pr-1");

    expect(traceTextTable()).toBe("v1be-ainakupo-trace-text-pr-1");
    vi.unstubAllEnvs();
  });
});
