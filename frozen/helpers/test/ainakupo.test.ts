import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { averageAfter, judgeExpectation, outOfOrder, type RecentTrace } from "../ainakupo.ts";
import { jsonOfBytes, parseBody } from "../keyed.ts";
import { stripTypes } from "../sdk.ts";

const trace = (startedAt: string, id: string) => ({ startedAt, id }) as RecentTrace;

describe("outOfOrder", () => {
  it("accepts startedAt descending, then id descending", () => {
    assert.deepEqual(outOfOrder([trace("2026-11-19T10:00:00.000Z", "b"), trace("2026-11-19T10:00:00.000Z", "a"), trace("2026-11-18T10:00:00.000Z", "z")]), []);
  });

  it("names a pair out of order", () => {
    assert.equal(outOfOrder([trace("2026-11-18T10:00:00.000Z", "a"), trace("2026-11-19T10:00:00.000Z", "b")]).length, 1);
    assert.equal(outOfOrder([trace("2026-11-19T10:00:00.000Z", "a"), trace("2026-11-19T10:00:00.000Z", "b")]).length, 1);
  });
});

describe("averageAfter", () => {
  const duration = { min: 300, max: 300, decimals: 0, added: 1 };

  it("is the one value when there was nothing before", () => {
    assert.equal(averageAfter({ ...duration, before: null, count: 0, after: 300 }), 300);
    assert.equal(typeof averageAfter({ ...duration, before: null, count: 0, after: 301 }), "string");
  });

  it("allows for the rounding of the earlier average", () => {
    // 3 values averaging 100 (99.5 to 100.5), then 300: 149.6 to 150.4.
    assert.equal(averageAfter({ ...duration, before: 100, count: 3, after: 150 }), 150);
    assert.equal(typeof averageAfter({ ...duration, before: 100, count: 3, after: 152 }), "string");
    assert.equal(typeof averageAfter({ ...duration, before: 100, count: 3, after: null }), "string");
  });

  it("keeps the earlier average when nothing was added", () => {
    assert.equal(averageAfter({ ...duration, added: 0, before: null, count: 0, after: 5 }), null);
    assert.equal(averageAfter({ ...duration, added: 0, before: 4.2, count: 3, after: 4.2 }), 4.2);
  });

  it("bounds scores from 1 to 5 with 1 decimal", () => {
    const score = { min: 1, max: 5, decimals: 1, added: 1 };
    assert.equal(averageAfter({ ...score, before: null, count: 0, after: 4 }), 4);
    assert.equal(averageAfter({ ...score, before: 3, count: 1, after: 2.5 }), 2.5);
    assert.equal(typeof averageAfter({ ...score, before: 3, count: 1, after: 4.5 }), "string");
    assert.equal(typeof averageAfter({ ...score, before: null, count: 0, after: 4.25 }), "string");
  });
});

describe("judgeExpectation", () => {
  const traceId = "11111111-1111-4111-8111-111111111111";
  const request = { traceId, criterion: "helpful", sentAt: 1_000_000, answeredAt: 1_005_000 };
  const json = "application/json";
  const good = {
    id: "22222222-2222-4222-8222-222222222222",
    traceId,
    criterion: "helpful",
    score: 4,
    explanation: "Clear and correct.",
    model: "claude-haiku-5-5",
    createdAt: new Date(1_002_000).toISOString(),
  };
  const answer = (status: number, body: unknown, retryAfter: string | null = null) => ({ status, contentType: json, retryAfter, body });

  it("accepts a good 201 and counts one evaluation", () => {
    const result = judgeExpectation(answer(201, good), request);
    assert.deepEqual(result, { expected: good, problems: [], added: 1 });
  });

  it("names each rule a 201 breaks", () => {
    const bad = { ...good, id: traceId, score: 4.5, explanation: "See https://x.test\n", createdAt: "2026-11-19T00:00:00Z" };
    const { problems } = judgeExpectation(answer(201, bad), request);
    assert.equal(problems.length, 6);
  });

  it("limits explanations to 500 code points", () => {
    assert.equal(judgeExpectation(answer(201, { ...good, explanation: "😀".repeat(500) }), request).problems.length, 0);
    assert.equal(judgeExpectation(answer(201, { ...good, explanation: "a".repeat(501) }), request).problems.length, 1);
    assert.equal(judgeExpectation(answer(201, { ...good, explanation: "" }), request).problems.length, 1);
    assert.equal(judgeExpectation(answer(201, { ...good, explanation: "a‮b" }), request).problems.length, 1);
  });

  it("expects the exact body of each failure it accepts", () => {
    assert.deepEqual(judgeExpectation(answer(502, {}), request).expected, { error: "judge_failed", message: "The judge did not return a score" });
    assert.deepEqual(judgeExpectation(answer(503, {}), request).expected, { error: "judge_unavailable", message: "The judge is busy. Try again shortly" });
    assert.deepEqual(judgeExpectation(answer(429, {}, "3600"), request), {
      expected: { error: "daily_cap", message: "The AI feature is paused until tomorrow", retryAfterSeconds: 3600 },
      problems: [],
      added: 0,
    });
  });

  it("refuses any other status, and a body that isn't JSON", () => {
    assert.equal(judgeExpectation(answer(500, {}), request).problems.length, 1);
    assert.equal(judgeExpectation({ status: 502, contentType: "text/html", retryAfter: null, body: {} }, request).problems.length, 1);
  });
});

describe("keyed request helpers", () => {
  it("pads a JSON object to an exact size in bytes", () => {
    const text = jsonOfBytes({ a: "é" }, 100);
    assert.equal(Buffer.byteLength(text), 100);
    assert.deepEqual(JSON.parse(text), { a: "é" });
    assert.throws(() => jsonOfBytes({ a: "x".repeat(200) }, 100));
  });

  it("keeps a body that isn't JSON readable", () => {
    assert.deepEqual(parseBody('{"a":1}'), { a: 1 });
    assert.deepEqual(parseBody("<html>"), { notJson: "<html>" });
  });

  it("strips types from strippable TypeScript", () => {
    const js = stripTypes("export type A = { a: string };\nexport function f(x: number): number { return x + 1; }\n");
    assert.match(js, /export function f\(x\) \{/);
    assert.doesNotMatch(js, /type A/);
  });
});
