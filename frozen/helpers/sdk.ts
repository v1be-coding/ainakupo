import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { nodeFetch } from "./keyed.ts";

// The SDK's exports, as spec #4 (Test contract inputs › SDK) fixes them.
export type TraceInput = {
  id?: string;
  runId?: string | null;
  provider: string;
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  startedAt: Date | string;
  durationMs: number;
  costUsd?: number | null;
  status: "ok" | "error";
  prompt?: string;
  response?: string;
};
export type SendResult =
  | { ok: true; id: string; status: 200 | 201; hasText: boolean; textTruncated: boolean }
  | { ok: false; id: string; reason: string; status?: number; field?: string; retryAfterSeconds?: number };
export type Client = { send(trace: TraceInput): Promise<SendResult> };
export type SdkModule = {
  createAInakupo(options: { endpoint: string; ingestKey: string; timeoutMs?: number }): Client;
  fromAnthropicUsage(usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }): { inputTokens: number; outputTokens: number };
};

// Strips the types with the TypeScript frozen/ already has. The SDK is
// strippable TypeScript with `node:` imports only, so the output runs as is.
export function stripTypes(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
  }).outputText;
}

const loaded = new Map<string, Promise<SdkModule>>();

// Downloads /sdk/ainakupo.ts from the target, refuses anything but a 200, and
// imports it from a temporary .mjs file (docs/research/sdk-served-from-site.md).
// Once per target and worker.
export function loadSdk(baseURL: string): Promise<SdkModule> {
  const url = new URL("/sdk/ainakupo.ts", baseURL).href;
  let sdk = loaded.get(url);
  if (!sdk) {
    sdk = download(url);
    loaded.set(url, sdk);
    // A failed download isn't kept, so a retry downloads again.
    sdk.catch(() => loaded.delete(url));
  }
  return sdk;
}

async function download(url: string): Promise<SdkModule> {
  const response = await nodeFetch(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`GET /sdk/ainakupo.ts answered ${response.status}, not 200, so there's no SDK to test.`);
  }
  const file = join(tmpdir(), `ainakupo-sdk-${randomUUID()}.mjs`);
  writeFileSync(file, stripTypes(await response.text()));
  return (await import(pathToFileURL(file).href)) as SdkModule;
}
