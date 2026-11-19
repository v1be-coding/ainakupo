import { asRecent, newTrace, UUID, type RecentTrace } from "../helpers/ainakupo.js";
import { expect, test } from "../helpers/fixtures.js";
import { randomKey } from "../helpers/keys.js";
import type { TraceInput } from "../helpers/sdk.js";

// Spec #4: the SDK served at /sdk/ainakupo.ts, downloaded from the target and
// run against it. Each title starts with the test contract lines (in the spec
// issue) that it checks.

const sdkTrace = (overrides: Partial<TraceInput> = {}) => newTrace(overrides) as unknown as TraceInput & { id: string };

test("C16: the site serves the SDK, which exports its two functions", { tag: ["@C16"] }, async ({ keyed, request }) => {
  const served = await request.get("/sdk/ainakupo.ts");
  expect(served.status()).toBe(200);

  const sdk = await keyed.sdk();
  expect(typeof sdk.createAInakupo).toBe("function");
  expect(typeof sdk.fromAnthropicUsage).toBe("function");
  expect(sdk.fromAnthropicUsage({ input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 })).toEqual({
    inputTokens: 112,
    outputTokens: 20,
  });
  expect(sdk.fromAnthropicUsage({ input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null })).toEqual({
    inputTokens: 100,
    outputTokens: 20,
  });
  expect(sdk.fromAnthropicUsage({ input_tokens: 3, output_tokens: 4 })).toEqual({ inputTokens: 3, outputTokens: 4 });
});

test("C17: send stores a trace, replaces it on a resend, and sends only the trace's fields", { tag: ["@C17"] }, async ({ keyed, request }) => {
  const client = await keyed.client("production");
  const startedAt = new Date(Date.now() - 2_000);
  // A field outside TraceInput, which the SDK must leave out.
  const trace = { ...sdkTrace({ startedAt, runId: crypto.randomUUID(), costUsd: 0.004 }), apiKey: "sk-not-a-real-key" };

  expect(await keyed.send(client, "production", trace)).toEqual({ ok: true, id: trace.id, status: 201, hasText: false, textTruncated: false });
  const resent = { ...trace, outputTokens: 31 };
  expect(await keyed.send(client, "production", resent)).toEqual({ ok: true, id: trace.id, status: 200, hasText: false, textTruncated: false });

  const recent = (await (await request.get("/api/traces/recent")).json()) as { traces: RecentTrace[] };
  const { apiKey: _apiKey, ...sentFields } = resent;
  expect(recent.traces.find((item) => item.id === trace.id)).toEqual(asRecent({ ...sentFields, startedAt: startedAt.toISOString() }));
});

test("C17: send makes an id when none is given, and reports text from the preview key", { tag: ["@C17"] }, async ({ keyed, request }) => {
  const production = await keyed.client("production");
  const { id: _id, ...withoutId } = sdkTrace();

  const made = await keyed.send(production, "production", withoutId);
  expect(UUID.test(made.id)).toBe(true);
  expect(made).toEqual({ ok: true, id: made.id, status: 201, hasText: false, textTruncated: false });
  const recent = (await (await request.get("/api/traces/recent")).json()) as { traces: RecentTrace[] };
  expect(recent.traces.find((item) => item.id === made.id)).toEqual(asRecent({ ...withoutId, id: made.id }));

  const preview = await keyed.client("preview");
  const withText = sdkTrace({ prompt: "a CI prompt", response: "r".repeat(8_193) });
  expect(await keyed.send(preview, "preview", withText)).toEqual({ ok: true, id: withText.id, status: 201, hasText: true, textTruncated: true });
});

test("C17: send reports an invalid field, an unknown key and a conflicting id", { tag: ["@C17"] }, async ({ keyed, request }) => {
  const production = await keyed.client("production");
  const preview = await keyed.client("preview");
  const stranger = await keyed.client({ ingestKey: randomKey("prod") });

  const badFeature = sdkTrace({ feature: "Not Valid" });
  expect(await keyed.send(production, "production", badFeature)).toEqual({ ok: false, id: badFeature.id, reason: "invalid_trace", status: 400, field: "feature" });

  const unknownKey = sdkTrace();
  expect(await keyed.send(stranger, null, unknownKey)).toEqual({ ok: false, id: unknownKey.id, reason: "invalid_key", status: 401 });

  const original = sdkTrace();
  expect(await keyed.send(production, "production", original)).toEqual({ ok: true, id: original.id, status: 201, hasText: false, textTruncated: false });
  expect(await keyed.send(preview, "preview", { ...original, feature: "conflict" })).toEqual({ ok: false, id: original.id, reason: "trace_conflict", status: 409 });

  const recent = (await (await request.get("/api/traces/recent")).json()) as { traces: RecentTrace[] };
  expect(recent.traces.find((item) => item.id === original.id)).toEqual(asRecent(original));
  expect(recent.traces.find((item) => item.id === badFeature.id)).toBeUndefined();
});

test("C18: an invalid config gives invalid_config, and nothing is stored", { tag: ["@C18"] }, async ({ keyed, request, baseURL }) => {
  const configs = [
    await keyed.client("production", { endpoint: "ainakupo.example" }),
    await keyed.client("production", { endpoint: `http://${new URL(baseURL ?? "").host}` }),
    await keyed.client("production", { endpoint: `https://user:pass@${new URL(baseURL ?? "").host}` }),
    await keyed.client({ ingestKey: "aik_prod_short" }),
    await keyed.client({ ingestKey: "sk-ant-not-an-ingest-key" }),
    await keyed.client("production", { timeoutMs: 99 }),
    await keyed.client("production", { timeoutMs: 10_001 }),
    await keyed.client("production", { timeoutMs: 1_500.5 }),
  ];
  const ids: string[] = [];
  for (const client of configs) {
    const trace = sdkTrace();
    ids.push(trace.id);
    expect(await keyed.send(client, null, trace)).toEqual({ ok: false, id: trace.id, reason: "invalid_config" });
  }

  const recent = (await (await request.get("/api/traces/recent")).json()) as { traces: RecentTrace[] };
  expect(recent.traces.filter((item) => ids.includes(item.id))).toEqual([]);
});
