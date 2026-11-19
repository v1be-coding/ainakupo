# AInakupo SDK design (for the spec)

Researched 2026-11-19 against primary sources: Node, AWS, npm and WHATWG docs, vendor docs, and source and
issues on the owning GitHub repos. Two claims rest on **local experiments** in this container (Node
v24.22.2, undici 7.30.1, npm 11.19.1), and they're labelled as such. Where a source didn't answer, this note
says **not confirmed**. The vendor flush patterns in
[`llm-observability-prior-art.md`](./llm-observability-prior-art.md) §6 aren't repeated here.

---

## 1. Summary

- **Keep the draft's shape:** a factory, `createAInakupo({ endpoint, ingestKey })`, returning `{ send }`.
  `send` resolves a discriminated result and never rejects. The closure also keeps the key off any object,
  so `console.log(client)` can't print it.
- **Await per call. Don't batch.** On Node 24, Lambda "no longer waits for unresolved promises to complete
  after your handler returns or the response stream ends"
  ([AWS streaming doc](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-write-functions.html)).
  Callback handlers are gone on Node 24
  ([AWS handler doc](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html)), so the old
  `callbackWaitsForEmptyEventLoop` escape hatch no longer applies. Without a batch there's no `flush()`.
- **Default timeout 2 s, not 3 s.** Lambda's default function timeout is 3 s
  ([AWS](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html)). A 3 s trace timeout can
  kill a host on default settings. Make it configurable with `timeoutMs`, and cover the whole request,
  body included, with one `AbortSignal.timeout`.
- **No retries on 429, 5xx or timeouts.** A retry adds latency to the host, and the 429 window is 60 s.
  At most, retry **once** on a network error raised before any response arrived, such as a stale
  keep-alive socket after a freeze. The idempotent id makes that retry safe.
- **The SDK generates `id` when it's omitted**, and returns it in the result. Use UUIDv7 when
  `crypto.randomUUIDv7` exists (Node ≥ 24.16, [nodejs/node#62553](https://github.com/nodejs/node/pull/62553)),
  else `randomUUID()`. The server should accept any RFC 9562 UUID. The SDK accepts `startedAt` as a `Date`
  or an ISO string, but **doesn't default it**, because it can't know when the call started.
- **Validation and truncation stay on the server.** The SDK checks only its own config (HTTPS endpoint,
  key present and well-formed), sends an **allowlist** of fields so a spread object can't leak secrets, and
  passes the server's `invalid_trace` + `field` through.
- **`npm install github:…#path:<subdir>` doesn't work.** npm documents no subdirectory install. Its
  maintainers said "If npm installs a git repo, it assumes that the git repo is the package"
  ([npm/npm#2974](https://github.com/npm/npm/issues/2974)). pacote has had a `gitSubdir` feature since
  Feb 2026 ([npm/pacote#442](https://github.com/npm/pacote/pull/442)), but in a local test on npm 11.19.1
  `#path:` installed the **repo root's** files under the subdirectory's name (§7).
- **Packaging recommendation:** `npm pack` the SDK into a `.tgz`, attach it to a GitHub release, and have
  senders run `npm install https://github.com/v1be-coding/ainakupo/releases/download/sdk-v1.0.0/ainakupo-sdk-1.0.0.tgz`.
  npm documents tarball URLs as a dependency form
  ([npm install](https://docs.npmjs.com/cli/v11/commands/npm-install)). The fallback is vendoring the
  single source file.
- **Ship ESM only**, with `.d.ts` files, zero runtime dependencies, `exports` with `types` first, and a
  `tsconfig` set to `module: nodenext`. The app keeps `bundler`. Senders bundle with esbuild, and Node can
  `require()` ESM unflagged since v22.12
  ([Node modules](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require)).
- **Security:** `redirect: "error"`, `https:` only, with `http://localhost` and `127.0.0.1` allowed for
  tests. The key is never put in a result, log or error. An optional prefix check stops, for example, an
  Anthropic key being sent as an ingest key.
- **Frozen tests can check the full outcome table against the branch environment:** ok, idempotent
  replace, `invalid_key`, `invalid_trace` + field, text flags, network failure and an invalid config. They
  should leave out 429 bursts and exact timings.

---

## 2. API shape (Q1)

**How comparable SDKs shape init, send and flush:**

| SDK | Init | Send | Flush or shutdown | Provider wrapper |
|---|---|---|---|---|
| Langfuse JS | `LangfuseSpanProcessor` registered with OTel `NodeSDK` ([SDK](https://langfuse.com/docs/observability/sdk/overview)) | spans or observations | "Shutdown flushes events and is required for short-lived applications" (same page) | `@langfuse/openai` (same page). Anthropic: not on that page |
| LangSmith JS | `new Client()` plus `traceable` ([serverless](https://docs.langchain.com/langsmith/serverless-environments)) | background batches | `await client.awaitPendingTraceBatches()`, or `flush()` with `manualFlushMode` (same page) | not checked |
| Braintrust | `initLogger({ projectName, apiKey?, asyncFlush })` factory ([TS install](https://docs.braintrust.dev/sdks/typescript/install-and-instrument.md)) | spans | `asyncFlush: false` plus `await logger.flush()` in `finally` (same page) | `wrapOpenAI` (same page) |
| Helicone async | no SDK on the docs page. Raw `POST …/custom/v1/log` with `Authorization: Bearer` ([manual logger](https://docs.helicone.ai/getting-started/integration-method/manual-logger-curl.md)) | one HTTP call | n/a | n/a |
| PostHog Node | `new PostHog(apiKey, { host })` ([Node docs](https://posthog.com/docs/libraries/node)) | queued; `captureImmediate` returns a Promise | `flush()` per request, raced against the remaining invocation time "and keep 100 ms to return"; `shutdown()` before exit (same page) | `captureAiImmediate` for serverless (same page) |
| Sentry Lambda | layer or `wrapHandler` | background queue | `shutdownTimeout` (2000 ms default). The layer extension "keeps running across Lambda's freeze/thaw boundary" ([options](https://docs.sentry.io/platforms/javascript/guides/aws-lambda/configuration/options/)) | n/a |
| OTel JS | `NodeSDK` plus processors. Docs recommend batching ([exporters](https://opentelemetry.io/docs/languages/js/exporters/)) | export | `forceFlush` and `shutdown`: not covered on that page (**not confirmed**) | instrumentations |

**Takeaways:**
- Every SDK that batches has to explain flushing, and PostHog's own advice races the flush against the
  invocation deadline. Senders here make a handful of calls per request, so batching buys nothing.
- PostHog's "immediate" variant (`captureImmediate`) is the closest match to the draft's `send`.

**Factory, class or function:**
- A plain `send(endpoint, key, trace)` makes every call site repeat the secret.
- A class stores the key on `this`, where `console.log`, `JSON.stringify` and error reporters will find it.
- A factory closure keeps the key private and validates config once. **Keep the factory.**

**Result object, throw or callback.** "Never throw into the host app" rules out throwing. A result object
is easy to log and assert in tests.
- `send()` must never reject, so callers don't need `try`.
- Make the result discriminated, and carry the server's fields, so tests and logs can see what happened
  (see §9).
- A config error found at init shouldn't throw either. Throwing at module scope would fail the Lambda's
  Init phase. Return a client whose `send` resolves `{ ok: false, reason: "invalid_config" }`.

**Anthropic helper.** A wrapper that holds the Anthropic client would break the rule that the SDK never
sees provider credentials, so **don't wrap the client.** A *pure* mapper is different. It's worth
considering because Anthropic's `usage.input_tokens` **excludes** cached tokens:
`total = cache_read_input_tokens + cache_creation_input_tokens + input_tokens`
([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). OTel's
`input_tokens` includes them (prior-art note §9.2). So each sender would otherwise get this sum wrong in
its own way.

**Recommendation:**
- v1 ships no wrapper.
- The spec pins `inputTokens` as the total including cache.
- Optionally, add `fromAnthropicUsage(usage) → { inputTokens, outputTokens }`, which is about 5 lines and
  needs no client or key. Leave it out of the frozen surface unless the spec wants it tested.

---

## 3. Lambda (Q2)

**What happens to work after the handler returns:**

- **The environment freezes.** "Lambda freezes the execution environment when the runtime and each
  extension have completed." Background work "that did not complete when the function ended resume[s] if
  Lambda reuses the execution environment. Make sure that any background processes or callbacks in your
  code are complete before the code exits"
  ([lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)). A
  fire-and-forget fetch therefore either sends late, on the next warm invocation, or is lost if the
  environment is recycled.
- **The Shutdown phase gives no grace time.** It lasts 0 ms for a function with no extensions (same page),
  so there's no `beforeExit`-style chance to flush.
- **Node 24 stops waiting for pending work.** "Starting with Node.js 24, Lambda no longer waits for
  unresolved promises to complete after your handler returns or the response stream ends … you should
  `await` them in your handler"
  ([streaming](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-write-functions.html)). Callback
  handlers are "only supported up to Node.js 22"
  ([handler](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html)).
- **Vendor SDKs all work around this,** with `shutdown`, `awaitPendingTraceBatches`, `flush` in `finally`,
  or a Lambda extension (Sentry, and Braintrust in the prior-art note).

**Per-call await, fire-and-forget or batch:**

| Pattern | Data loss on Lambda | Latency added | Complexity |
|---|---|---|---|
| Fire-and-forget | Yes (freeze or recycle) | none | low, but wrong |
| Batch plus `flush()` | Only if the caller forgets `flush` | one request per flush | needs a queue, `flush`, and docs |
| **Await each `send`** | No, unless the send times out | one HTTPS round trip per trace | lowest |
| Collect promises, then `await Promise.all` before returning | No | one round trip in total, run in parallel | the caller's choice, and needs no SDK feature |

**Latency cost:**
- One HTTPS POST. On a cold socket that includes DNS, TCP and TLS. undici's `connectTimeout` defaults to
  10 s and `keepAliveTimeout` to 4 s
  ([undici Client](https://raw.githubusercontent.com/nodejs/undici/main/docs/docs/api/Client.md)), so a
  low-traffic Lambda usually pays a fresh handshake.
- The ingest route is itself a Lambda, and cold starts run "from under 100 ms to over 1 second"
  ([lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)).
- Typical figures for this stack: **not confirmed**. Measure them in the branch environment.
- Document the pattern of calling `send` right after the model call and awaiting it, or collecting the
  promises and awaiting them together at the end of the handler.

**Response streaming.** It doesn't help: per the quote above, Node 24 doesn't keep pending work alive after
the stream ends either. A streaming sender should `await send()` before it ends the handler. Sending
before `responseStream.end()` costs the user latency. Sending after `end()` but still inside the handler
doesn't (**not confirmed**).

**Recommendation:** an awaited single send, with no batch API and therefore no `flush`. The README should
say "await it before your handler returns". Offer `timeoutMs`, so a caller can cap it at
`context.getRemainingTimeInMillis()` minus a margin, which is PostHog's pattern.

---

## 4. Timeouts, fetch and retries (Q3)

**What Node 24's fetch throws.** Local probe on Node v24.22.2 / undici 7.30.1, in the scratchpad:

| Case | Rejection |
|---|---|
| Connection refused | `TypeError: fetch failed`, with a `cause` |
| DNS failure | `TypeError: fetch failed`, with `cause.code = ENOTFOUND` |
| `AbortSignal.timeout(300)` before headers | `DOMException`, `name: "TimeoutError"`, after about 304 ms |
| The same timeout while reading the body | `DOMException`, `TimeoutError`. **The signal covers the body too** |
| `redirect: "error"` and a 307 response | `TypeError: fetch failed` |
| Invalid URL | `TypeError: Failed to parse URL …`, with `cause.code = ERR_INVALID_URL` |

These match the specs. The DOM spec aborts with "a new "TimeoutError" DOMException"
([DOM](https://dom.spec.whatwg.org/#dom-abortsignal-timeout)). Redirect mode `error` returns "a network
error when a request is met with a redirect" ([Fetch](https://fetch.spec.whatwg.org/)). Node's fetch is
undici-based and has been stable since v21 ([globals](https://nodejs.org/api/globals.html)).
`AbortSignal.any` (v20.3+) can combine a caller's signal with the timeout (same page).

**Implications for the SDK:**
- Map `TimeoutError` to `"timeout"`, and any other rejection to `"network"`.
- Read the body inside the same `try` as the fetch, under the same signal.
- Never surface `err.message` verbatim if it could hold the URL. Ingest URLs aren't secret, but keep the
  result small anyway.
- **Keep-alive:** undici pools connections by default (the `keepAliveTimeout` above). AWS warns that
  "Lambda purges idle connections over time. Attempting to reuse an idle connection … will result in a
  connection error" ([handler](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html)). That
  is the one failure a retry cheaply fixes.

**Retries:**
- OTLP retries 429/502/503/504 with backoff and `Retry-After`, never 400, all bounded by the whole export
  timeout ([OTLP](https://opentelemetry.io/docs/specs/otlp/),
  [exporter](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)). OTLP exporters run in the
  background, though. Here every retry adds to a user request's latency.
- `key_rate_limited` covers a 60 s window, so waiting for `retry-after` is never acceptable in-request.
- **Recommendation:** no retry on any HTTP response. At most one immediate retry on a `TypeError` network
  failure, with the same id and body, inside the **same overall deadline**. That's safe because the same
  id from the same key is an idempotent replace.
- If the spec wants zero retries for simplicity, that's defensible, and the frozen tests are unaffected.

**Timeout value:** **2000 ms by default**, configurable with `timeoutMs`, clamped to roughly
100–10,000 ms. Reasons:
- It leaves 1 s of Lambda's default 3 s timeout for the host's own work.
- The OTel default of 10 s ([exporter spec](https://opentelemetry.io/docs/specs/otel/protocol/exporter/))
  is for background exporters.
- The timeout covers the whole request, retries included.

---

## 5. IDs and `startedAt` (Q4)

**What the sources say:**
- LangSmith: "We recommend using **UUID v7** for run IDs", because it "preserves correct time-ordering"
  ([trace with API](https://docs.langchain.com/langsmith/trace-with-api)).
- RFC 9562: time-ordered UUIDs "benefit from greater database-index locality", and implementations "SHOULD
  NOT assume that UUIDs are hard to guess" ([RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html)).
  So id ownership must come from the key: the server's `trace_conflict` rule.
- `crypto.randomUUIDv7()` was added in Node 26.1.0 and backported to **24.16.0 LTS**
  ([nodejs/node#62553](https://github.com/nodejs/node/pull/62553)). It exists in this container's Node
  24.22.2 (local probe). Which Node 24 minor Lambda's `nodejs24.x` runtime ships: **not confirmed**.

**Recommendation:**
- The SDK generates `id` when it's omitted, using `randomUUIDv7` if it's a function, else `randomUUID`.
  Always return the id in the result, even on failure, so callers can log it or retry it themselves.
- Server: accept any RFC 9562 UUID. Don't require v7.
- `startedAt`: accept a `Date` or an ISO string, and serialise it with `toISOString()`. **Don't default
  it.** Only the caller knows when the model call started. "Now" at send time would be wrong by the
  duration of the call.

---

## 6. Validation and types (Q5)

- **The server is the source of truth.** It already returns `invalid_trace` + `field`. Duplicating its
  rules client-side means two places to change and a frozen test that can't tell which layer answered.
- **The SDK validates only its own config:**
  - `endpoint` parses, and is `https:` or loopback `http:`;
  - `ingestKey` is a non-empty string matching the key format, if the spec fixes a prefix;
  - `timeoutMs` is finite.
- **Allowlist the body.** Build it from the known fields only, and never spread the input. Then a caller who
  passes a whole provider request object (headers, keys) can't leak it, which serves Setup rule 3.
- **Truncation:**
  - Leave it to the server, so `textTruncated` in the response stays truthful.
  - The spec must define "8192 chars" exactly. JS `.length` counts UTF-16 code units, not code points or
    bytes (prior-art note §9.6). The SDK forwards strings unchanged.
  - Optionally, cap text at a large safety ceiling (e.g. 64 KiB) to avoid huge bodies. Exact limits on
    the ingest route's request size: **not confirmed**.
- **Types:**

```ts
export type TraceStatus = "ok" | "error";
export interface TraceInput {
  id?: string;                 // UUID; generated when omitted
  runId?: string;
  provider: string;            // e.g. "anthropic"
  model: string;
  feature: string;
  inputTokens: number;         // total input incl. cached tokens (spec to pin)
  outputTokens: number;
  startedAt: Date | string;    // ISO 8601 when a string
  durationMs: number;
  costUsd?: number | null;     // null/omitted = unknown
  status: TraceStatus;
  prompt?: string;             // trace text, opt-in
  response?: string;
}
```

---

## 7. Packaging without npm (Q6)

**Evidence:**
- **Git dependencies.** npm supports `git+https://…#<commit-ish>` and `#semver:<range>`. With neither,
  "the default branch is used". The docs say nothing about subdirectories
  ([package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)).
- **`prepare` on git dependencies.** If a git dependency has a `prepare` script, "its `dependencies` and
  `devDependencies` will be installed, and the prepare script will be run" before packing
  ([npm install](https://docs.npmjs.com/cli/v11/commands/npm-install)).
- **Subdirectories.**
  - The 2013 maintainer position was "There's no plans to do this … npm assumes that the git repo is the
    package" ([npm/npm#2974](https://github.com/npm/npm/issues/2974)).
  - RFC 0010 added only `repository.directory` *metadata*
    ([RFC 0010](https://github.com/npm/rfcs/blob/latest/implemented/0010-monorepo-subdirectory-declaration.md)).
  - npm-package-arg parses `#<ref>::path:<dir>` into `gitSubdir`
    ([npa.js](https://raw.githubusercontent.com/npm/npm-package-arg/main/lib/npa.js)).
  - pacote implemented it in [#442](https://github.com/npm/pacote/pull/442), merged on 2026-02-06. npm
    CLI picked up pacote 21.3.1+ in 11.10.0
    ([CHANGELOG](https://raw.githubusercontent.com/npm/cli/refs/heads/latest/CHANGELOG.md)).
  - It is **undocumented**, and **broken in local tests**:
    `npm install github:npm/cli#path:workspaces/libnpmversion` and the `git+https://…cli.git#path:…` form
    (npm 11.19.1, with `--ignore-scripts`) both installed `node_modules/libnpmversion` containing the
    **root** `npm@12.2.3` package. `npm pack --dry-run` showed the subdirectory's *name* with the root's
    *files*. Untested: whether it works without `--ignore-scripts`, or when the subdirectory has a `prepare`
    script. The cause is **not confirmed**.
- **Tarball URLs.** "You may specify a tarball URL in place of a version range"
  ([package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)). It must be `http(s)://`
  ([npm install](https://docs.npmjs.com/cli/v11/commands/npm-install)). GitHub release asset URLs
  redirect to a CDN, and whether npm follows that redirect is **not confirmed** in the docs. Test it once
  in the spec phase.

**Options:**

| Option | Works with a subfolder? | Pros | Cons |
|---|---|---|---|
| `github:v1be-coding/ainakupo` (repo root) | n/a. It installs the *app*: root `prepare: husky` runs, and every dependency and devDependency is installed | none | wrong package, slow, runs app scripts |
| `#path:sdk` | **No** in local tests | one repo, one command | undocumented; installed the root files; npm ≥ 11.10 only |
| Separate `ainakupo-sdk` repo plus `github:…#semver:^1` tags | Yes | documented git-dependency path; tags give versions | a new repo is a `v1be-infra` or user step; types shared across repos drift; needs `prepare` or a committed `dist/` |
| Committed `dist/` plus a git dependency | Only in a separate repo | no build at install | built files in git; needs a CI drift check |
| **Release asset `.tgz`** (`npm pack` in `sdk/`, `gh release create sdk-vX.Y.Z <tgz>`) | **Yes** | documented form; immutable per version; lockfile records URL and integrity; no install-time scripts | a release per version (a GitHub write, which the spec must allow); the built artefact isn't reviewed as source; redirect behaviour to test |
| Tarball committed in the repo, served by a raw URL | Yes | no releases | binary in git; raw URLs are odd for deps |
| npm workspaces | Only *inside* this repo | the app and the frozen tests can import `sdk/` | doesn't help other repos install it |
| Vendor `sdk/src/index.ts` into each sender | Yes | no install machinery; zero deps; one file | copies drift; no update path |

**Monorepo and shared types:**
- Keep the SDK in `sdk/`, with its own `package.json` (`name: "@v1be-coding/ainakupo-sdk"`, `private: true`
  so it can't be published by accident, and `files: ["dist"]`) and its own `tsconfig`.
- The SDK owns the wire types. The app's ingest handler imports them with a type-only relative import from
  `sdk/src`, which is erased at build time, so the two can't drift.
- Frozen and unit tests import `sdk/src/index.ts` directly. No packaging step is needed to test it.
- knip and ESLint will need `sdk/` entries (**not confirmed** against this repo's knip config).

**Recommendation:**
- A release `.tgz`.
- Install command:
  `npm install https://github.com/v1be-coding/ainakupo/releases/download/sdk-v1.0.0/ainakupo-sdk-1.0.0.tgz`
- Build `dist/` in a `prepack` script, so `npm pack` always ships fresh output.
- If the spec won't allow release writes, vendor the single file and record its source commit in a header
  comment.

---

## 8. Module format (Q7)

- **ESM only.**
  - Node can `require()` synchronous ESM, unflagged since v22.12 / v20.19, warning-free since v22.13, and
    not experimental since v25.4
    ([modules](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require)).
  - esbuild bundles ESM into CJS output, as this repo's own `--format=cjs` build shows (`package.json`).
  - Dual packages bring the "dual package hazard" ([packages](https://nodejs.org/api/packages.html)) for
    no gain. Don't use top-level `await`, so `require(esm)` keeps working.
- **`exports`:** `{ ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`, plus
  `"type": "module"`.
  - `exports` blocks deep imports ([packages](https://nodejs.org/api/packages.html)).
  - TypeScript checks conditions in order, so put `"types"` first
    ([TS modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html)).
- **Ship compiled JS and `.d.ts`, not `.ts`.** Node "refuses to handle TypeScript files inside folders
  under a `node_modules` path" ([Node TS](https://nodejs.org/api/typescript.html)).
- **The SDK's `tsconfig`:** `module`/`moduleResolution: nodenext`, `declaration: true`, `target: ES2023`.
  TS calls `node16`/`nodenext` "the only correct `module` options" for code that runs in Node, and says
  `bundler` suits apps run through a bundler
  ([TS](https://www.typescriptlang.org/docs/handbook/modules/reference.html)). The app keeps its
  `bundler` config.
- **Zero runtime dependencies.** It needs only `fetch`, `AbortSignal` and `node:crypto`.
- **`engines: { "node": ">=22" }`.** `engines` is advisory only
  ([package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)). The UUIDv7 path
  feature-detects, so 22 works.

---

## 9. Testing (Q8)

**Unit tests** (vitest, in this repo):
- Inject `fetch` through a hidden option, for example `createAInakupo({ …, fetch })`, to test the status
  mapping table quickly.
- Use a local `node:http` server for the behaviours a mock can't reproduce: a real `AbortSignal.timeout`
  that fires during the body, `redirect: "error"` on a 307, connection refused, and a non-JSON 502 body.
  The probe in §4 shows each of these is cheap.
- Assert:
  - `send` never rejects, even with a hostile `fetch` that throws synchronously;
  - the key appears only in the `authorization` header;
  - unknown fields aren't sent;
  - an id is generated and returned;
  - a `Date` `startedAt` is serialised.

**Frozen acceptance tests** (against the live branch environment):

| Check | Expect |
|---|---|
| A valid trace with the test ingest key | `{ ok: true, status: 201, id, hasText: false, textTruncated: false }`, and the trace then appears in the read API or dashboard |
| The same id resent with changed tokens | `ok: true, status: 200`. The stored trace shows the new values |
| `prompt` longer than 8192 chars | `ok: true, hasText: true, textTruncated: true` |
| A wrong ingest key | `{ ok: false, reason: "invalid_key", status: 401 }` |
| A negative `inputTokens` (bypassing the types) | `{ ok: false, reason: "invalid_trace", field: "inputTokens" }` |
| A non-HTTPS public endpoint, or an empty key | `{ ok: false, reason: "invalid_config" }`, with no request made |
| An unreachable endpoint (`http://127.0.0.1:1`) | `{ ok: false, reason: "network" }`. It resolves, doesn't throw |
| The response body and result never contain the key | string check |

**Leave out of the frozen tests:**
- 429 bursts. They take 61 sends and pollute the shared key's window, so test rate limiting server-side
  with its own key if at all.
- Exact timeout timing.
- 5xx mapping, which can't be forced on a live server. Unit-test it instead.
- The release-asset install path, which is a docs or smoke check, not a test.
- `trace_conflict` unless the branch environment has two keys (**spec decision**).

---

## 10. Security (Q9)

- **Never log the key.** The SDK writes no console output. Results carry no headers, no request body and
  no raw error messages. The key lives only in the closure.
- **No env credentials.** The SDK never reads `process.env`. Senders pass `ingestKey` explicitly, from
  their own SSM read or env, which is their choice. The body comes from an allowlist (§6).
- **Redirects:**
  - The Fetch Standard removes a developer-set `Authorization` header on cross-origin redirects
    ([whatwg/fetch#1544](https://github.com/whatwg/fetch/pull/1544)), and undici implemented that
    ([undici e041de3](https://github.com/nodejs/undici/commit/e041de359221ebeae04c469e8aff4145764e6d76)).
  - A same-origin redirect still re-sends it, and RFC 9110 lets a 301 or 302 turn POST into GET.
  - **Use `redirect: "error"`.** The ingest API has no reason to redirect, and a redirect becomes
    `{ ok: false, reason: "network" }`.
- **HTTPS only.** Reject an `endpoint` whose protocol isn't `https:`, except `http:` on `localhost`,
  `127.0.0.1` or `[::1]` for tests. Also reject URLs with userinfo (`https://u:p@host`).
- **Key format check:**
  - If the spec gives ingest keys a prefix (prior-art §9.3 suggests one), check it at init.
  - Also refuse obvious provider keys, such as anything starting `sk-ant-`. That stops a mixed-up env var
    being sent to the endpoint.
  - Return `invalid_config` without making a request.
- **Never echo it:** `invalid_key` results say only that the key was rejected.

---

## Recommended SDK design for AInakupo v1

### Public API

```ts
// @v1be-coding/ainakupo-sdk  (sdk/src/index.ts)
export interface AInakupoOptions {
  endpoint: string;      // base URL, e.g. "https://ainakupo.emilianocasijr.com"; no default
  ingestKey: string;     // never read from env
  timeoutMs?: number;    // default 2000, clamped to [100, 10000]; covers the whole request
}

export type SendResult =
  | { ok: true; id: string; status: 200 | 201; hasText: boolean; textTruncated: boolean }
  | {
      ok: false;
      id: string | null;          // null only for invalid_config before an id exists
      reason: FailureReason;
      status?: number;            // HTTP status when a response arrived
      field?: string;             // for invalid_trace
      retryAfterSeconds?: number; // for rate limits, informational only
    };

export type FailureReason =
  | "invalid_config"   // bad endpoint/key/options; no request made
  | "invalid_trace"    // 400
  | "invalid_key"      // 401
  | "trace_conflict"   // 409
  | "key_rate_limited" // 429
  | "rate_limited"     // 429
  | "server_error"     // 5xx
  | "unexpected_response" // any other status, or unparseable body
  | "timeout"          // AbortSignal.timeout fired
  | "network";         // fetch rejected otherwise (DNS, refused, reset, redirect)

export interface AInakupo {
  send(trace: TraceInput): Promise<SendResult>; // never rejects
}

export function createAInakupo(options: AInakupoOptions): AInakupo; // never throws
export type { TraceInput, TraceStatus }; // as in §6
```

Request: `POST new URL("/api/traces", endpoint)`, with `content-type: application/json`,
`authorization: Bearer <ingestKey>`, `redirect: "error"`, `signal: AbortSignal.timeout(timeoutMs)`, and the
allowlisted body with the `id` filled in and `startedAt` as ISO.

### Behaviour table

| Outcome | Result |
|---|---|
| Config invalid (non-HTTPS public URL, userinfo, empty or provider-shaped key, bad `timeoutMs`) | `{ ok:false, reason:"invalid_config", id }`. No fetch |
| 201 `{id, hasText, textTruncated}` | `{ ok:true, status:201, id, hasText, textTruncated }` |
| 200 (idempotent replace) | `{ ok:true, status:200, … }` |
| 400 `invalid_trace` + `field` | `{ ok:false, reason:"invalid_trace", status:400, field }` |
| 401 `invalid_key` | `{ ok:false, reason:"invalid_key", status:401 }` |
| 409 `trace_conflict` | `{ ok:false, reason:"trace_conflict", status:409 }` |
| 429 `key_rate_limited` / `rate_limited` | the same `reason`, `status:429`, `retryAfterSeconds` from `retry-after`. **No retry** |
| 5xx | `{ ok:false, reason:"server_error", status }`. No retry |
| Any other status, or a 2xx with a body that won't parse | `{ ok:false, reason:"unexpected_response", status }` |
| `TimeoutError` (headers or body) | `{ ok:false, reason:"timeout" }` |
| Other fetch rejection, including a redirect | one immediate retry if time remains (optional, see §4), then `{ ok:false, reason:"network" }` |
| Anything thrown inside the SDK | caught, and becomes `"network"` or `"unexpected_response"`. Never propagates |

Every result carries `id` (§5).

### Packaging

- `sdk/` gets its own `package.json`: `"type":"module"`, an `exports` entry with `types` first,
  `files:["dist"]`, `engines.node ">=22"`, no `dependencies`, `private:true`, and a
  `prepack: "tsc -p tsconfig.json"` script using `module: nodenext` with declarations.
- To release: `npm pack` in `sdk/`, then attach the `.tgz` to a GitHub release tagged `sdk-v1.0.0`.
- Senders install it with:
  `npm install https://github.com/v1be-coding/ainakupo/releases/download/sdk-v1.0.0/ainakupo-sdk-1.0.0.tgz`
- Before relying on this, confirm once that npm follows the release-asset redirect.
- The fallback, if releases aren't allowed, is vendoring `sdk/src/index.ts`.
- Don't use `#path:` installs (§7).

### Frozen tests: check vs leave out

- **Check:** every row of the §9 frozen table. That's create, replace, the text truncation flags,
  `invalid_key`, `invalid_trace` + `field`, `invalid_config` with no request, an unreachable endpoint
  resolving to `network`, and the key never appearing in results.
- **Leave out:** 429 bursts, timing precision, 5xx, retries, the release install path, and
  `trace_conflict` unless two keys exist. Cover those with unit tests against a local `node:http` server.

### Open points for the spec

- The ingest key prefix and format, for the client-side check.
- What "8192 chars" means: UTF-16 units, code points or bytes.
- Whether `inputTokens` includes cache tokens (recommended: yes), and whether to ship `fromAnthropicUsage`.
- Whether a run may create GitHub releases.
- The optional single network retry: yes or no.
- Whether the server accepts any UUID version (recommended: yes).
