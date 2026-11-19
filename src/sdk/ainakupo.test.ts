import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createAInakupo, fromAnthropicUsage, type TraceInput } from "./ainakupo";

const KEY = "aik_prev_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample0";
const ID = "0b6f3c1e-4a8d-4f2b-9c1d-2e3f4a5b6c7d";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Received = {
  method?: string;
  url?: string;
  headers: IncomingMessage["headers"];
  body: string;
};
type Handler = (req: IncomingMessage, res: ServerResponse, received: Received) => void;

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

// A local HTTP server that records each request and answers with `handler`.
async function serve(handler: Handler): Promise<{ endpoint: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body };
      received.push(entry);
      handler(req, res, entry);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${port}`, received };
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function trace(overrides: Partial<TraceInput> = {}): TraceInput {
  return {
    id: ID,
    provider: "anthropic",
    model: "claude-haiku-5-5",
    feature: "summary",
    inputTokens: 120,
    outputTokens: 30,
    startedAt: "2026-11-19T10:00:00.000Z",
    durationMs: 850,
    status: "ok",
    ...overrides,
  };
}

describe("send", () => {
  it("POSTs the trace to /api/traces with the key as a Bearer token and reports a stored trace", async () => {
    const { endpoint, received } = await serve((_req, res) =>
      json(res, 201, { id: ID, hasText: true, textTruncated: false }),
    );
    const client = createAInakupo({ endpoint: `${endpoint}/`, ingestKey: KEY });

    const result = await client.send(trace({ prompt: "hi" }));

    expect(result).toEqual({ ok: true, id: ID, status: 201, hasText: true, textTruncated: false });
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe("POST");
    expect(received[0].url).toBe("/api/traces");
    expect(received[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(received[0].headers["content-type"]).toBe("application/json");
    expect(JSON.parse(received[0].body)).toEqual({
      id: ID,
      provider: "anthropic",
      model: "claude-haiku-5-5",
      feature: "summary",
      inputTokens: 120,
      outputTokens: 30,
      startedAt: "2026-11-19T10:00:00.000Z",
      durationMs: 850,
      status: "ok",
      prompt: "hi",
    });
  });

  it("makes a UUID id when none is given, sends a Date startedAt as its ISO string, and sends only TraceInput fields", async () => {
    const { endpoint, received } = await serve((_req, res) =>
      json(res, 200, { id: "x", hasText: false, textTruncated: false }),
    );
    const client = createAInakupo({ endpoint, ingestKey: KEY });
    const withoutId = trace({
      id: undefined,
      startedAt: new Date(Date.UTC(2026, 10, 19, 10, 0, 0, 5)),
      runId: null,
      costUsd: null,
    });

    const result = await client.send({ ...withoutId, apiKey: "sk-elsewhere" } as TraceInput);

    expect(result).toEqual({
      ok: true,
      id: expect.stringMatching(UUID),
      status: 200,
      hasText: false,
      textTruncated: false,
    });
    const sent = JSON.parse(received[0].body) as Record<string, unknown>;
    expect(sent.id).toBe(result.id);
    expect(sent.startedAt).toBe("2026-11-19T10:00:00.005Z");
    expect(sent.runId).toBeNull();
    expect(sent.costUsd).toBeNull();
    expect(sent).not.toHaveProperty("apiKey");
  });

  it.each([
    [
      400,
      { error: "invalid_trace", field: "feature", message: "Invalid trace field: feature" },
      { reason: "invalid_trace", status: 400, field: "feature" },
    ],
    [
      401,
      { error: "invalid_key", message: "Missing or unknown ingest key" },
      { reason: "invalid_key", status: 401 },
    ],
    [
      409,
      { error: "trace_conflict", message: "Trace id belongs to another ingest key" },
      { reason: "trace_conflict", status: 409 },
    ],
    [
      429,
      { error: "daily_cap", message: "Daily cap", retryAfterSeconds: 5 },
      { reason: "unexpected_response", status: 429 },
    ],
    [404, { error: "Not found" }, { reason: "unexpected_response", status: 404 }],
    [201, { id: ID }, { reason: "unexpected_response", status: 201 }],
  ])("reports a %i answer as the stated failure", async (status, body, expected) => {
    const { endpoint } = await serve((_req, res) => json(res, status, body));

    expect(await createAInakupo({ endpoint, ingestKey: KEY }).send(trace())).toEqual({
      ok: false,
      id: ID,
      ...expected,
    });
  });

  it("reports a body that isn't JSON as an unexpected response", async () => {
    const { endpoint } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    });

    expect(await createAInakupo({ endpoint, ingestKey: KEY }).send(trace())).toEqual({
      ok: false,
      id: ID,
      reason: "unexpected_response",
      status: 200,
    });
  });

  it.each(["key_rate_limited", "rate_limited"])(
    "reports a 429 %s with the seconds from retry-after",
    async (error) => {
      const { endpoint } = await serve((_req, res) =>
        json(
          res,
          429,
          { error, message: "Too many", retryAfterSeconds: 42 },
          { "retry-after": "17" },
        ),
      );

      expect(await createAInakupo({ endpoint, ingestKey: KEY }).send(trace())).toEqual({
        ok: false,
        id: ID,
        reason: error,
        status: 429,
        retryAfterSeconds: 17,
      });
    },
  );

  it.each([500, 502, 503])("reports a %i as a server error, whatever its body", async (status) => {
    const { endpoint } = await serve((_req, res) => {
      res.writeHead(status, { "content-type": "text/plain" });
      res.end("Bad gateway");
    });

    expect(await createAInakupo({ endpoint, ingestKey: KEY }).send(trace())).toEqual({
      ok: false,
      id: ID,
      reason: "server_error",
      status,
    });
  });

  it.each([301, 302, 307, 308])(
    "refuses a %i redirect as a network failure, without following it",
    async (status) => {
      const { endpoint, received } = await serve((req, res) => {
        if (req.url === "/elsewhere")
          return json(res, 201, { id: ID, hasText: false, textTruncated: false });
        res.writeHead(status, { location: "/elsewhere" });
        res.end();
      });

      expect(await createAInakupo({ endpoint, ingestKey: KEY }).send(trace())).toEqual({
        ok: false,
        id: ID,
        reason: "network",
      });
      expect(received.map((request) => request.url)).toEqual(["/api/traces"]);
    },
  );

  it("times out when the answer doesn't start in time", async () => {
    const { endpoint } = await serve((_req, res) => {
      setTimeout(() => json(res, 201, { id: ID, hasText: false, textTruncated: false }), 1_000);
    });
    const started = Date.now();

    expect(
      await createAInakupo({ endpoint, ingestKey: KEY, timeoutMs: 100 }).send(trace()),
    ).toEqual({ ok: false, id: ID, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("times out when the body doesn't finish in time", async () => {
    const { endpoint } = await serve((_req, res) => {
      res.writeHead(201, { "content-type": "application/json" });
      res.write('{"id":');
    });

    expect(
      await createAInakupo({ endpoint, ingestKey: KEY, timeoutMs: 100 }).send(trace()),
    ).toEqual({ ok: false, id: ID, reason: "timeout" });
  });

  it("reports a refused connection as a network failure", async () => {
    const { endpoint } = await serve(() => undefined);
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
    );

    expect(await createAInakupo({ endpoint, ingestKey: KEY }).send(trace())).toEqual({
      ok: false,
      id: ID,
      reason: "network",
    });
  });

  it("resolves rather than rejects when the trace can't be encoded", async () => {
    const { endpoint, received } = await serve((_req, res) =>
      json(res, 201, { id: ID, hasText: false, textTruncated: false }),
    );
    const client = createAInakupo({ endpoint, ingestKey: KEY });

    expect(await client.send(trace({ inputTokens: 1n as unknown as number }))).toEqual({
      ok: false,
      id: ID,
      reason: "invalid_trace",
    });
    expect(await client.send(null as unknown as TraceInput)).toEqual({
      ok: false,
      id: expect.stringMatching(UUID),
      reason: "invalid_trace",
    });
    expect(received).toHaveLength(0);
  });
});

describe("config", () => {
  it.each([
    ["an endpoint that isn't an absolute URL", { endpoint: "ainakupo.example" }],
    ["http: for a host other than localhost", { endpoint: "http://ainakupo.example" }],
    ["http: for a non-loopback IP", { endpoint: "http://10.0.0.1" }],
    ["another scheme", { endpoint: "ftp://ainakupo.example" }],
    ["a username and password", { endpoint: "https://user:pass@ainakupo.example" }],
    ["a username alone", { endpoint: "https://user@ainakupo.example" }],
    ["a short key", { ingestKey: "aik_prod_short" }],
    ["another service's key", { ingestKey: "sk-ant-not-an-ingest-key" }],
    ["a key with an unknown environment", { ingestKey: KEY.replace("aik_prev_", "aik_test_") }],
    ["a timeout under 100 ms", { timeoutMs: 99 }],
    ["a timeout over 10,000 ms", { timeoutMs: 10_001 }],
    ["a timeout that isn't an integer", { timeoutMs: 1_500.5 }],
    ["a timeout that isn't a number", { timeoutMs: "2000" as unknown as number }],
  ])("gives invalid_config for %s, without a request", async (_name, override) => {
    const { endpoint, received } = await serve((_req, res) =>
      json(res, 201, { id: ID, hasText: false, textTruncated: false }),
    );
    const client = createAInakupo({ endpoint, ingestKey: KEY, ...override });

    expect(await client.send(trace())).toEqual({ ok: false, id: ID, reason: "invalid_config" });
    expect(received).toHaveLength(0);
  });

  it("gives invalid_config for options that aren't an object, without throwing", async () => {
    const client = createAInakupo(undefined as unknown as { endpoint: string; ingestKey: string });

    expect(await client.send(trace())).toEqual({ ok: false, id: ID, reason: "invalid_config" });
  });

  it.each(["localhost", "[::1]"])("allows http: for %s", async (host) => {
    const { endpoint } = await serve((_req, res) =>
      json(res, 201, { id: ID, hasText: false, textTruncated: false }),
    );
    const port = new URL(endpoint).port;
    const client = createAInakupo({
      endpoint: `http://${host}:${port}`,
      ingestKey: KEY,
      timeoutMs: 10_000,
    });

    // The server listens on 127.0.0.1 only, so [::1] can't connect: what matters is that a request is tried.
    expect(await client.send(trace())).not.toMatchObject({ reason: "invalid_config" });
  });
});

describe("the ingest key", () => {
  it("is never on the client object or in a result", async () => {
    const { endpoint } = await serve((_req, res) =>
      json(res, 401, { error: "invalid_key", message: "Missing or unknown ingest key" }),
    );
    const client = createAInakupo({ endpoint, ingestKey: KEY });
    const results = [
      await client.send(trace()),
      await createAInakupo({ endpoint: "http://ainakupo.example", ingestKey: KEY }).send(trace()),
    ];

    const shown = [
      inspect(client, { showHidden: true, depth: null }),
      JSON.stringify(client),
      ...results.map((result) => JSON.stringify(result)),
    ];
    for (const text of shown) expect(text).not.toContain(KEY.slice(9));
    expect(Object.keys(client)).toEqual(["send"]);
  });
});

describe("the file senders download", () => {
  it("runs once its types are stripped, importing only node: builtins", async () => {
    const source = readFileSync(fileURLToPath(new URL("./ainakupo.ts", import.meta.url)), "utf8");
    const imports = [...source.matchAll(/^import\s.*?from\s+"([^"]+)"/gms)].map(
      (match) => match[1],
    );
    expect(imports.every((specifier) => specifier.startsWith("node:"))).toBe(true);

    const file = join(tmpdir(), `ainakupo-sdk-${randomUUID()}.mjs`);
    writeFileSync(file, stripTypeScriptTypes(source));
    const sdk = (await import(
      /* @vite-ignore */ pathToFileURL(file).href
    )) as typeof import("./ainakupo");
    rmSync(file);

    expect(sdk.fromAnthropicUsage({ input_tokens: 1, output_tokens: 2 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
    });
    expect(Object.keys(sdk).sort()).toEqual(["createAInakupo", "fromAnthropicUsage"]);
  });
});

describe("fromAnthropicUsage", () => {
  it("counts cached input tokens as input tokens", () => {
    expect(
      fromAnthropicUsage({
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 7,
      }),
    ).toEqual({
      inputTokens: 112,
      outputTokens: 20,
    });
  });

  it("treats missing or null cache counts as zero", () => {
    expect(
      fromAnthropicUsage({
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: null,
      }),
    ).toEqual({ inputTokens: 100, outputTokens: 20 });
  });
});
