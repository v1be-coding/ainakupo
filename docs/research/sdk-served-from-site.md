# Serving the SDK from the site, so the frozen tests can import it

Researched 2026-11-19 against primary sources: AWS, Node, Playwright, Python and Debian sources, and this
repo plus a fresh clone of `v1be-infra` (`main` at `e7a3a14`). Where a source didn't answer, this note says
**not confirmed**. Packaging options and the SDK's API are in [`sdk-design.md`](./sdk-design.md) and
[ADR-0004](../adr/0004-sdk-is-one-copied-file.md), and aren't repeated here.

---

## 1. Summary

- **Verdict: workable, with no Setup or `v1be-infra` change needed.** The publish step syncs all of
  `dist/web` to the bucket (`.github/workflows/deploy-target.yml:175-176`), so the build only has to put
  the file there. Neither clean-URL function rewrites a path whose last segment has a dot, and the
  invalidation runs before `verify` starts.
- **Serve one file: `/sdk/ainakupo.ts`.** Tests fetch it, transpile it with the `typescript` that
  `frozen/` already depends on, and import the result. That checks the very file senders copy. A second
  `/sdk/ainakupo.js` would be an untested twin, so leave it out unless senders need it.
- **Content type can't be set without a workflow change.** `aws s3 sync` guesses types with Python's
  `mimetypes`. That gives `text/javascript` for `.js`. For `.ts` it gives `text/vnd.trolltech.linguist`
  under Debian's current `mime.types`, or nothing (S3 then stores `binary/octet-stream`). **It isn't
  `video/mp2t`**: Debian's `video/MP2T` line lists no extensions. The exact type on the runner is
  **not confirmed**. Node `fetch` and `curl` ignore it, so the spec leaves the type of `.ts` untested.
- **Caching is fine.** The file falls under the `no-cache` rule (`deploy-target.yml:175-176`), and
  `Managed-CachingOptimized` then caches it for its 1 s minimum TTL. The `/*` invalidation
  (`deploy-target.yml:185`) runs before `verify` (`needs: deploy`, line 189). The API zip and `dist/web`
  come from the same `npm run build` of the same checkout.
- **The import lives in `frozen/helpers/`,** because it needs `if` and `throw` on a bad response, and
  `try`/`finally` to clean up the temp file (lint bans these only outside `helpers/`,
  `frozen/helpers/lint.ts:14,49-53`). Node can't import `https:` URLs natively, so the helper writes a
  temp `.mjs` and calls `import(pathToFileURL(...))`.
- **Two gaps the helper must close:** `send()` uses global `fetch`, so it skips the fixture that paces and
  counts API calls (`frozen/helpers/fixtures.ts`, the `request` override). And the PR's code would run
  inside the judge's process. Expose the SDK through a fixture that reserves a pace slot per `send`, and
  check every result against a plain read through the paced `request`.
- **No series rule forbids this,** if the spec pins the SDK's public surface the way it pins a route:
  the URL, the export names, the options and the result shapes. `/acceptance` bans unit tests only because
  "they need names from inside the code, which the spec doesn't fix" (`.claude/commands/acceptance.md:52`).
- **The spec must pin:** the path `/sdk/ainakupo.ts`; erasable-only TypeScript with zero imports apart
  from `node:` builtins; a build step that runs after `vite build`; a Routes line for `GET /sdk/ainakupo.ts`
  (200, so it gets a tagged test); and what the tests leave out (content type, minified or not).

---

## 2. Serving: S3, CloudFront and Cloudflare (Q1)

**How the file gets there.**

- Vite's `root` is `src/web` and `emptyOutDir: true` (`vite.config.ts:5-7`). So a file written to
  `dist/web/sdk/` _before_ `vite build` is wiped. The SDK step must run after `build:web` in
  `npm run build` (`package.json:9`). A run can edit `package.json`, but not the workflow.
- The publish step syncs everything outside `assets/` with `--cache-control "no-cache"`, and `--delete`
  removes anything that isn't in the new build (`deploy-target.yml:175-176`). Don't put the SDK under
  `assets/`, which gets `max-age=31536000, immutable` (lines 171-174) and is meant for hashed names.

**Content type.**

- The AWS CLI's `guess_content_type` is just `mimetypes.guess_type(filename)[0]`, with no added mappings
  ([aws-cli `utils.py`](https://raw.githubusercontent.com/aws/aws-cli/v2/awscli/customizations/s3/utils.py)).
- CPython's built-in table maps `.js` and `.mjs` to `text/javascript` and has no `.ts` entry. On Linux it
  also reads `/etc/mime.types` and other `knownfiles`
  ([`mimetypes.py`](https://raw.githubusercontent.com/python/cpython/main/Lib/mimetypes.py)).
- Debian's `media-types` file maps `ts` to `text/vnd.trolltech.linguist`, and `js mjs es` to
  `text/javascript`. Its `video/MP2T` line lists no extensions
  ([Debian `mime.types`](https://salsa.debian.org/debian/media-types/-/raw/master/mime.types)).
- Whether the `ubuntu-24.04` runner has `/etc/mime.types`, and which `media-types` version it ships: **not
  confirmed**. With no match, the CLI sends no type, and S3 falls back to `binary/octet-stream` (S3 default,
  **not confirmed** against the current doc page).
- **Effect:** `.ts` arrives as a non-script type. `curl -o` and Node `fetch` don't care. A browser opening
  the URL downloads it rather than showing it. Fixing the type needs `--content-type` on a separate
  `aws s3 cp` in the publish step, which only the user can commit.

**CloudFront.**

- **Clean URLs:** both `v1be-origin-check-pages` (production) and `v1be-pages` (branches) leave a URI alone
  when its last segment has a dot. The comment says `/app.js -> unchanged, because the last segment has a
dot` (`v1be-infra/modules/edge-account/main.tf:51-57`, code at 107-110 and 152-155). `/sdk/` with a slash
  gets a 301, and `/sdk` would be rewritten to `/sdk/index.html`. Neither affects `/sdk/ainakupo.ts`.
- **404 handling:** production maps origin 403 and 404 to `/404.html` with status 404, and caches that
  error for 60 s (`v1be-infra/modules/episode/edge.tf:228-239`). This repo's branch edge has no
  `custom_error_response` (`infra/branch-edge/main.tf:54-115`), so a missing key there is S3's 403. The
  helper must therefore check for a 200 before it imports anything, or it will try to import HTML or XML.
- **Compression:** `compress = true`, but CloudFront only compresses listed types. `text/javascript` is on
  the list; neither `.ts` type above is
  ([AWS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html)).
  So `.ts` is served uncompressed, which is harmless at about 150 lines. Node's `fetch` decodes gzip and br
  either way.
- **Headers:** production's response headers policy adds `nosniff`, a CSP, HSTS and others to every
  site response (`edge.tf:38-73,202`). The branch edge here attaches no policy (`infra/branch-edge/main.tf:86-93`).
  - `nosniff` blocks a response only when the request's destination is script-like or a style
    ([Fetch: "should response to request be blocked due to nosniff?"](https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-nosniff?)).
    Node's `fetch` has an empty destination.
  - A CSP is enforced by a browser on the document it governs
    ([MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)). Neither header affects Node,
    `curl` or the helper. **Confirmed by spec text; not tested here.**

**Cloudflare (production only).**

- `email_obfuscation`, `rocket_loader` and `automatic_https_rewrites` are pinned `off`, and all three
  rewrite HTML only (`v1be-infra/stacks/edge/cloudflare.tf:17-46`).
- Cloudflare caching is bypassed for every request (`cloudflare.tf:76-95`), so CloudFront is the only
  cache.
- The rate-limit rule matches `/api/*` only (`cloudflare.tf:117-128`), so downloading the SDK can't trip it.
- Auto Minify, the one feature that rewrote JS, was deprecated on 2024-08-05
  ([Cloudflare API deprecations](https://developers.cloudflare.com/fundamentals/api/reference/deprecations/)).
  Forum posts say it was later removed for every zone
  ([community](https://community.cloudflare.com/t/deprecating-auto-minify/655677)). That second-hand
  source is **not confirmed** by an official changelog.
- The Web Analytics beacon that broke the CSP on 2026-11-18 was injected into HTML
  (`frozen/helpers/served-html.ts:1-5`). Whether it would touch a `.ts` response: **not confirmed**, but
  it targets HTML.
- Bot Fight Mode or a challenge on scripted downloads isn't set in Terraform. The dashboard state is **not
  confirmed**. CI tests never touch production's `/sdk/` (acceptance tests are branch-only,
  `frozen/helpers/projects.ts:6-9`), so only a sender's one-off `curl` could hit it.

---

## 3. Importing downloaded code in a Playwright test (Q2)

- **Node version:** `.nvmrc` is `24`. `verify.yml` reads it, and the cone-mode sparse checkout of `frozen`
  still includes the repo's root files.
- **Remote imports aren't supported.** Node supports `file:`, `node:` and `data:` URLs. `https:` "is not
  supported natively in Node.js unless using a custom HTTPS loader", and the default loader "fails on any
  other URL protocol" ([Node ESM](https://nodejs.org/api/esm.html#urls)). So the helper must `fetch`
  first.

**Options:**

| Mechanism                                         | Works                                                                                                                           | Drawbacks                                                                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Temp `.mjs` + `import(pathToFileURL(p).href)`** | Yes: a `file:` URL. `.mjs` is ESM whatever the nearest `package.json` says                                                      | Needs cleanup. Has readable stack traces                                                                                                                                                                                    |
| `import("data:text/javascript;base64,…")`         | Yes for ESM. Builtin specifiers resolve, relative ones don't ([Node ESM `data:`](https://nodejs.org/api/esm.html#data-imports)) | Opaque stack traces. How Playwright's ESM loader hook treats `data:` is **not confirmed**                                                                                                                                   |
| Temp `.ts` + `import()`                           | Node 24 strips types by default (since 22.18 / 23.6, stable since 24.12) ([Node TS](https://nodejs.org/api/typescript.html))    | Fails on `enum`, runtime `namespace`, parameter properties and decorators. Playwright also transforms `.ts` with its own pipeline ([Playwright TS](https://playwright.dev/docs/test-typescript)), so two transforms compete |
| `vm.SourceTextModule`                             | Only with `--experimental-vm-modules`                                                                                           | A flag the Playwright CLI doesn't pass. And "the `node:vm` module is not a security mechanism" ([Node vm](https://nodejs.org/api/vm.html)), so it isolates nothing                                                          |

**Recommended mechanism (in `frozen/helpers/sdk.ts`):**

1. `fetch(new URL("/sdk/ainakupo.ts", BASE_URL))`, and throw with the status and content type unless it
   returns 200.
2. Transpile with `ts.transpileModule(source, { compilerOptions: { module: ESNext, target: ES2023 } })`,
   using `frozen/`'s pinned `typescript` 6.0.3 (`frozen/package.json`), which `lint.ts` already imports.
3. Write the output to `<fs.mkdtemp(os.tmpdir())>/ainakupo.mjs`, then
   `await import(pathToFileURL(path).href)`.
4. Check that `createAInakupo` is a function, and return the module typed by a helper-local interface
   copied from the spec.

Notes:

- Use `os.tmpdir()`, not `testInfo.outputPath()`. `test-results/` is uploaded as an artifact
  (`verify.yml:81-88`). The source is public anyway, so this only keeps the artifact tidy.
- Cache the module once per worker. `workers: 1` (`frozen/playwright.config.ts`) means once per run.
  Retries run isolated at the end, in a fresh worker
  ([Playwright retries](https://playwright.dev/docs/test-retries)), so a retry re-downloads the file.
- The ESM loader issues seen in Playwright concerned importing ESM-only packages and the removal of a Babel
  dynamic-import transform ([#23662](https://github.com/microsoft/playwright/issues/23662),
  [#31725](https://github.com/microsoft/playwright/issues/31725)). A plain `file:` `.mjs` import outside
  the project is the simplest case. That it works under Playwright 1.65 is **not confirmed** until the
  first frozen test runs it. `/acceptance`'s "must fail on main" run will show any loader error.
- Add a `node --test` unit test in `helpers/test/` that serves a tiny module from a local `node:http`
  server. Cover the 200 path and the 404/403-with-HTML path, as the README asks
  (`.claude/commands/acceptance.md:73`).

---

## 4. Ordering, staleness and same-commit (Q3)

- **Order.** `deploy` runs, in turn: build, migrate, `terraform apply` (the Lambda), seed, then
  "Publish the site", which syncs and then calls `create-invalidation --paths '/*'`
  (`deploy-target.yml:60-64,124-127,163-185`). `verify` has `needs: deploy` (line 189). So the new
  `/sdk/ainakupo.ts` is in S3 before any test runs.
- **Invalidation isn't awaited** (no `aws cloudfront wait invalidation-completed`). It doesn't matter for
  this file. With `Cache-Control: no-cache` and a minimum TTL above 0, "CloudFront caches the object for
  the value of the CloudFront minimum TTL"
  ([AWS expiration](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)).
  That is 1 s for `Managed-CachingOptimized`
  ([AWS managed policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)).
  So an edge copy from the previous round is at most about 1 s stale, even before invalidation completes.
- **Edge case:** if an origin is unreachable, CloudFront may serve the earlier object (same AWS page,
  Warning box). S3 being down mid-test is outside the suite's control.
- **Production's 60 s error cache** (`edge.tf:237`) can only hold a 404 from _before_ the file first
  existed. Whether an invalidation also clears cached error responses: **not confirmed**. It can't affect
  branch runs, which have no custom error response.
- **Same commit:** one job checks out one ref, runs one `npm run build`, and zips the API and syncs
  `dist/web` from that output (`deploy-target.yml:53-64`). So the SDK and the API it calls always match, as
  long as the SDK step is part of `npm run build`.
- **Concurrency:** the caller's concurrency group covers deploy and verify together, so a later push can't
  redeploy mid-test (`deploy-target.yml:4-7`).

---

## 5. Security and supply chain (Q4)

**Senders downloading from production.**

- **Risks:** no integrity check; anyone who can deploy to the bucket controls the file; and Cloudflare
  terminates TLS, so it sees and could alter the bytes, as any proxy can. The file is copied once and
  compiled into the sender, so a bad download lasts until someone re-copies.
- **Mitigations, best first:**
  1. **Commit the copy and review the diff** on every update (ADR-0004 already copies). Add a header
     comment with the SDK version and source commit, injected by the build from `GITHUB_SHA`. That lets a
     reviewer compare the copy with `sdk/ainakupo.ts` at that commit on GitHub, which is an independent
     channel.
  2. A published `/sdk/ainakupo.ts.sha256` comes through the same bucket and CDN, so it catches only
     corruption, not a compromise. Low value. Skip it unless the spec wants it.
  3. Versioned paths (`/sdk/v1/…`) don't give immutability here, because `--delete` removes every file
     the current build doesn't make (`deploy-target.yml:175`). A version in the header comment is enough.
- The SDK itself still never reads env or credentials, and has no default endpoint
  (`docs/agents/setup-notes.md`, "Ingest rules").

**Tests executing the PR's code.**

- **The keys are already exposed.** The PR's server receives `TEST_PRODUCTION_KEY` and `TEST_PREVIEW_KEY`
  in plaintext, in the `Authorization` header of every ingest test. The verify job has no AWS token
  (`deploy-target.yml:187`). `GH_TOKEN` is set only in the comment step's env (`verify.yml:91-96`), and
  checkout runs with `persist-credentials: false`.
  - New exposure: the imported code sees both keys in `process.env` at once, and could send them anywhere.
    The server code could already do that with each key it receives, so this is a marginal change.
- **The real new risk is integrity, not secrecy.** The SDK would run inside the process that judges it.
  It could replace `globalThis.fetch` or other globals, or write to `frozen/reports/`. Runs aren't
  adversaries, but the series' frozen lint exists because agent code has gamed tests
  (`frozen/README.md`, "The frozen lint").
  - Mitigations in the helper:
    - capture `fetch` before the import, and use only the paced Playwright `request` for checks;
    - confirm every `send` result through a read of the stored trace;
    - pass keys as arguments rather than leaving the SDK to find them.
  - Stronger option: run the SDK in a child process with an empty env (`execFile(process.execPath, …,
{ env: {} })`), passing the trace and key on stdin and reading the JSON result. That costs about 40
    lines in `helpers/`, and is optional.

---

## 6. Series and frozen-test rules (Q5)

- "Tests must come from the spec, not from how something happens to be built"
  (`.claude/commands/acceptance.md:9`). An SDK whose file path, exports and result shapes the spec pins is
  a public interface, like a route. Testing it imports nothing the spec doesn't name.
- "No unit tests in `frozen/`: they need names from inside the code, which the spec doesn't fix"
  (`acceptance.md:52`). That reason doesn't apply once the spec fixes the names. The spec should say
  outright that the SDK's surface is part of the test contract, so `/acceptance` doesn't stop on line 52.
- **Is the file a Routes line?** `contract-coverage.ts` checks only the Routes and Page headings
  (`frozen/helpers/contract-coverage.ts:8`). Making `GET /sdk/ainakupo.ts → 200` a Routes line forces a
  tagged test, which the import test supplies naturally. Each SDK behaviour (the outcome table in
  `sdk-design.md` §9) then gets its own C-line, at API level, through the helper.
- **Pacing:** each `send` must count against the test's `apiBudget`, or a test could exceed the per-IP
  limit unseen (`docs/agents/spec.md:40`). The `sdk` fixture should wrap `send` with the same
  `waitForSlot` and `tally` that `request` uses (`fixtures.ts`, the `request` override). That's a helpers
  change, which `/acceptance` makes in the frozen PR.
- The unreachable-endpoint case (`http://127.0.0.1:1`) and `invalid_config` make no API call, so they cost
  no budget.

---

## 7. Alternatives (Q6)

| Option                                                                                | Change needed                                                                                                                                                                                                                                    | Pros                                                                                     | Cons                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Serve `/sdk/ainakupo.ts`, tests transpile and import it** (recommended)          | Spec plus `package.json` build step. No workflow change                                                                                                                                                                                          | Tests exactly what senders download, from the deployed commit; same path on every target | Content type unpinnable; PR code runs in the test process (§5)                                                                                                                                             |
| A′. Also serve compiled `/sdk/ainakupo.js` and import that                            | Same                                                                                                                                                                                                                                             | `text/javascript`; no transpile in tests                                                 | Tests a file senders don't use, so a broken `.ts` passes                                                                                                                                                   |
| B. Frozen tests use plain `fetch` for the ingest API; SDK unit-tested only            | None                                                                                                                                                                                                                                             | Simplest; no code imported                                                               | The run writes the SDK _and_ its unit tests, so no independent check of `send`'s result mapping, the allowlist or never-reject behaviour                                                                   |
| C. `verify.yml` also checks out `sdk/` from the deployed commit                       | User commits a second `actions/checkout` (`ref: ${{ github.sha }}`, `sparse-checkout: sdk`, `path: app`) in `verify.yml`, and possibly a new input from `deploy-target.yml`. A series template change, so it likely affects every episode's copy | No network fetch; tests the committed file                                               | A workflow change for one episode; doesn't prove the site serves the file; `frozen/tsconfig.json` would need the path. `github.sha` in a called workflow is the caller's: **not confirmed** for this chain |
| D. Fetch `raw.githubusercontent.com/v1be-coding/ainakupo/$GITHUB_SHA/sdk/ainakupo.ts` | None (`GITHUB_SHA` is a default env var in every step)                                                                                                                                                                                           | Commit-addressed and immutable                                                           | Whether raw serves a PR's merge-ref commit is **not confirmed**; local `/acceptance` runs have no `GITHUB_SHA`; depends on GitHub's CDN and rate limits                                                    |
| E. Copy the SDK into `frozen/helpers`                                                 | None                                                                                                                                                                                                                                             | n/a                                                                                      | Frozen is written before the SDK exists, and would test its own copy, not the run's. Not a real option                                                                                                     |

---

## Recommendation

**Option A.** Serve the TypeScript source from the site, and have the frozen tests import that same file.

**Build (a run's work, no Setup):**

- Add `build:sdk` after `build:web` in `npm run build`. It copies `sdk/ainakupo.ts` to
  `dist/web/sdk/ainakupo.ts` and prepends a header comment with the version and `GITHUB_SHA`.
- It must run _after_ Vite, because `emptyOutDir` wipes `dist/web` (`vite.config.ts:7`).
- No `.js`. Don't use `assets/`.

**Path and caching:**

- `GET /sdk/ainakupo.ts` on every target.
- It falls under the publish step's existing `Cache-Control: no-cache` (CloudFront holds it for at most
  the 1 s minimum TTL) and the `/*` invalidation.
- Content type: whatever `mimetypes` guesses. The spec leaves it untested. If a correct type matters later,
  the user adds an `aws s3 cp --content-type "text/plain; charset=utf-8"` for `sdk/` to the publish step:
  a **workflow change, optional**.

**Test side (`frozen/helpers/sdk.ts`, written by `/acceptance`):**

- Fetch the file, throw unless the response is 200, then `ts.transpileModule` it.
- Write the output to a temp `.mjs` from `fs.mkdtemp`, then `import(pathToFileURL(p).href)`. Cache it
  once per worker.
- Capture global `fetch` first.
- Expose an `sdk` fixture in `fixtures.ts` that paces and counts each `send`.
- Unit-test the loader with `node:http`.
- Tests stay straight-line: create a client, `send`, `toEqual` the whole result, then confirm with a
  paced `request` read.

**Setup or `v1be-infra` changes:** none required. Optional: an explicit content type for `.ts` (workflow),
and a child-process sandbox for the SDK (helpers only).

**The spec must state:**

1. The SDK is served at `/sdk/ainakupo.ts` from every target, built from the same commit as the API. It
   is a Routes line: `GET → 200`.
2. The SDK's public surface is part of the test contract: export names, options, result shapes, and the
   outcome table. Without this, `/acceptance` stops on its "no unit tests" rule.
3. The file is erasable-only TypeScript (no `enum`, runtime `namespace`, parameter properties or
   decorators), with no imports apart from `node:` builtins, and no top-level `await`. Then it transpiles
   in isolation and senders can strip it too.
4. It never reads `process.env` (already an ingest rule; restated for the tests).
5. What the tests leave out: the content type of `.ts`, compression, minification, and the header
   comment's exact text.
6. Senders commit their copy and review the diff on every update. There's no checksum file and no
   versioned path.
