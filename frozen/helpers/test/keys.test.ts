import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KEY_PACE, keyCallWait, keyReservationWait, randomKey, swapPrefix, testKey, untilNextWindow, windowStart } from "../keys.ts";

const KEY_FORMAT = /^aik_(prod|prev)_[A-Za-z0-9_-]{43}$/;
// 20 seconds into a UTC minute.
const now = 1_800_000_000_000 - (1_800_000_000_000 % 60_000) + 20_000;

describe("testKey", () => {
  it("reads a key from its variable", () => {
    assert.equal(testKey("preview", { TEST_PREVIEW_KEY: "aik_prev_x" }), "aik_prev_x");
  });

  it("names the missing variable and never a value", () => {
    assert.throws(() => testKey("production", {}), /TEST_PRODUCTION_KEY is not set/);
  });
});

describe("keys a test makes", () => {
  it("makes well-formed random keys", () => {
    assert.match(randomKey("prod"), KEY_FORMAT);
    assert.match(randomKey("prev"), KEY_FORMAT);
    assert.notEqual(randomKey("prod"), randomKey("prod"));
  });

  it("swaps a key's prefix and keeps its random part", () => {
    const key = randomKey("prev");
    assert.equal(swapPrefix(key), `aik_prod_${key.slice(9)}`);
    assert.equal(swapPrefix(swapPrefix(key)), key);
  });
});

describe("the per-key pace", () => {
  const start = windowStart(now);
  const callsThisWindow = (count: number) => Array.from({ length: count }, (_, i) => start + 2_000 + i * 100);

  it("aligns windows on UTC minute boundaries", () => {
    assert.equal(start % 60_000, 0);
    assert.equal(untilNextWindow(now), 40_000 + KEY_PACE.marginMs);
  });

  it("lets a call through while the window has room", () => {
    assert.equal(keyCallWait(callsThisWindow(KEY_PACE.calls - 1), now), 0);
  });

  it("holds the 60th call until the next window, plus the margin", () => {
    assert.equal(keyCallWait(callsThisWindow(KEY_PACE.calls), now), untilNextWindow(now));
  });

  it("forgets calls from earlier windows, apart from the margin before this one", () => {
    const old = Array.from({ length: 59 }, (_, i) => start - 30_000 + i);
    assert.equal(keyCallWait(old, now), 0);
    const late = Array.from({ length: 59 }, (_, i) => start - 500 + i);
    assert.equal(keyCallWait(late, now), untilNextWindow(now));
  });

  it("sends nothing in the margin just after a boundary", () => {
    assert.equal(keyCallWait([], start + 200), KEY_PACE.marginMs - 200);
  });

  it("reserves a test's whole key budget before it starts", () => {
    assert.equal(keyReservationWait(callsThisWindow(39), now, 20), 0);
    assert.equal(keyReservationWait(callsThisWindow(40), now, 20), untilNextWindow(now));
  });
});
