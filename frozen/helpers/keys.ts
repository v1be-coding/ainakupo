import { randomBytes } from "node:crypto";

// The test-episode's ingest keys (spec #4, Test contract inputs › Data). They
// live only in GitHub Actions secrets, so no key may reach a test title, an
// assertion message, a report or a Playwright trace: tests name a key, and the
// keyed helpers read it here.
export type KeyName = "production" | "preview";

const ENV_NAMES: Record<KeyName, string> = {
  production: "TEST_PRODUCTION_KEY",
  preview: "TEST_PREVIEW_KEY",
};

// Read when a test sends a keyed request, never at import, because the smoke
// tests import the fixtures on production too, where no key is passed.
export function testKey(name: KeyName, env: NodeJS.ProcessEnv = process.env): string {
  const variable = ENV_NAMES[name];
  const key = env[variable];
  if (!key) {
    throw new Error(`${variable} is not set. The keyed frozen tests need test-episode's ${name} key (spec #4, Test contract inputs › Data).`);
  }
  return key;
}

// The same random part under the other environment's prefix. Its hash is
// unknown, so it must get the same 401 as any other invalid key.
export function swapPrefix(key: string): string {
  return key.startsWith("aik_prev_") ? `aik_prod_${key.slice(9)}` : `aik_prev_${key.slice(9)}`;
}

// A well-formed key that no sending episode has.
export function randomKey(environment: "prod" | "prev"): string {
  return `aik_${environment}_${randomBytes(32).toString("base64url")}`;
}

// The server allows 60 requests per key per fixed window on UTC minute
// boundaries. The helpers send at most 59 per window (spec #4, How the frozen
// tests must send keyed requests › Per-key pacing), and start a new window a
// little late, so a runner clock that runs ahead can't land a call in the
// server's previous window.
export const KEY_PACE = { calls: 59, windowMs: 60_000, marginMs: 1_000 };

export function windowStart(now: number): number {
  return Math.floor(now / KEY_PACE.windowMs) * KEY_PACE.windowMs;
}

// How long until the next window starts, plus the margin.
export function untilNextWindow(now: number): number {
  return windowStart(now) + KEY_PACE.windowMs + KEY_PACE.marginMs - now;
}

// Calls that may count in the server's current window. No call is sent in the
// margin after a boundary, but one sent in the margin before it may count in the
// server's new window if the runner's clock runs behind, so those count too.
function inWindow(sent: readonly number[], now: number): number {
  const from = windowStart(now) - KEY_PACE.marginMs;
  return sent.filter((time) => time >= from).length;
}

// How long one more call must wait so the key stays under KEY_PACE.
export function keyCallWait(sent: readonly number[], now: number): number {
  return keyRoomWait(sent, now, 1);
}

// How long a test must wait before it starts so `budget` calls fit in the
// current window, as helpers/pace.ts does for the per-IP pace.
export function keyReservationWait(sent: readonly number[], now: number, budget: number): number {
  return keyRoomWait(sent, now, budget);
}

function keyRoomWait(sent: readonly number[], now: number, needed: number): number {
  // Inside the margin after a boundary, the server may still be in the old window.
  if (now - windowStart(now) < KEY_PACE.marginMs) return windowStart(now) + KEY_PACE.marginMs - now;
  if (inWindow(sent, now) + needed <= KEY_PACE.calls) return 0;
  return untilNextWindow(now);
}
