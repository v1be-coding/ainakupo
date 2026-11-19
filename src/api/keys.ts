import { createHash } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { findIngestKey, type StoredKey } from "../db/ingest.js";
import type { KeyEnvironment } from "../db/schema.js";
import { json, type ApiResult } from "./json.js";

export type IngestKey = StoredKey;

// `response` is whatever the route must answer instead of running.
export type KeyCheck = { ok: true; key: IngestKey } | { ok: false; response: ApiResult };

const KEY_FORMAT = /^aik_(prod|prev)_[A-Za-z0-9_-]{43}$/;
const PREFIX_ENVIRONMENT: Record<string, KeyEnvironment> = { prod: "production", prev: "preview" };

// The frozen tests' sending episode. Its keys are public test keys, so production
// treats them as unknown even if a row for them got there.
const TEST_EPISODE = "test-episode";

// How a key is stored: only this hash, never the key (ADR-0002, ADR-0003).
export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

const invalidKey = (): KeyCheck => ({
  ok: false,
  response: json(401, { error: "invalid_key", message: "Missing or unknown ingest key" }),
});

// The one key step both POST routes take, before they read the body. Never logs or
// returns the key itself.
export async function authenticate(event: APIGatewayProxyEventV2): Promise<KeyCheck> {
  const header = event.headers?.authorization;
  if (!header?.startsWith("Bearer ")) return invalidKey();

  const key = header.slice("Bearer ".length);
  const format = KEY_FORMAT.exec(key);
  if (!format) return invalidKey();

  const stored = await findIngestKey(hashKey(key));
  if (!stored) return invalidKey();
  if (stored.environment !== PREFIX_ENVIRONMENT[format[1] ?? ""]) return invalidKey();
  if (process.env.TARGET === "production" && stored.episode === TEST_EPISODE) return invalidKey();

  return { ok: true, key: stored };
}
