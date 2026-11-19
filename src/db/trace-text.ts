import { DeleteItemCommand, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import type { Store } from "../limits/store.js";

// A trace's prompt and response. Null means that half wasn't stored.
export type TraceText = { prompt: string | null; response: string | null };

// ADR-0001: text is gone 30 days after its trace started.
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

// The table's name, which Terraform gives the Lambda. Read on each call, so tests can set it.
export function traceTextTable(): string {
  return process.env.TRACE_TEXT_TABLE ?? "";
}

type Item = Record<string, AttributeValue>;

// Replaces any text already stored for the trace, so a retry lands on the same item.
export async function putTraceText(
  db: Store,
  table: string,
  traceId: string,
  startedAt: Date,
  text: TraceText,
): Promise<void> {
  const startedMs = startedAt.getTime();
  if (!Number.isFinite(startedMs)) throw new Error("startedAt is not a valid date");

  const item: Item = {
    traceId: { S: traceId },
    startedAt: { N: String(startedMs) },
    // DynamoDB's TTL wants epoch seconds.
    expires: { N: String(Math.ceil((startedMs + KEEP_MS) / 1000)) },
  };
  if (text.prompt !== null) item.prompt = { S: text.prompt };
  if (text.response !== null) item.response = { S: text.response };

  await db.send(new PutItemCommand({ TableName: table, Item: item }));
}

// Null when nothing is stored, or when the trace started over 30 days before `now`:
// DynamoDB removes expired items days late, so the read checks the age itself.
export async function getTraceText(
  db: Store,
  table: string,
  traceId: string,
  now: number = Date.now(),
): Promise<TraceText | null> {
  const { Item: item } = await db.send(
    new GetItemCommand({
      TableName: table,
      Key: { traceId: { S: traceId } },
      ConsistentRead: true,
    }),
  );
  if (!item) return null;

  const startedMs = Number(item.startedAt?.N);
  if (!Number.isFinite(startedMs) || now > startedMs + KEEP_MS) return null;

  return { prompt: item.prompt?.S ?? null, response: item.response?.S ?? null };
}

export async function deleteTraceText(db: Store, table: string, traceId: string): Promise<void> {
  await db.send(new DeleteItemCommand({ TableName: table, Key: { traceId: { S: traceId } } }));
}
