# Using AInakupo from another episode

How a sending episode reports its AI calls to AInakupo and scores them in CI. Terms follow `GLOSSARY.md`. The full contract is in spec #4 (`Test contract inputs › Routes` and `› SDK`).

AInakupo lives at `https://ainakupo.emilianocasijr.com`. Its public dashboard shows each sending episode's production traces: counts, tokens, cost, latency and average score. It never shows prompt or response text, or anything about keys.

## 1. Get the episode's keys (owner, once)

Admin logins happen only in Windows Sandbox, which has no Node. So run `v1be-infra`'s wizard there, in Git Bash:

```sh
/c/code/v1be-infra/sandbox/wizards/ainakupo-keys.sh <episode>
```

It builds `keys:add` from a pinned commit of this repo, signs you in, finds production's DSQL endpoint, and runs:

```sh
CLUSTER_ENDPOINT=<prod-cluster-id>.dsql.ap-southeast-1.on.aws npm run keys:add -- <episode>
```

This writes two SecureStrings into the sending episode's own SSM folder and prints only `aik_prod_…abcd`-style hints:

| SSM parameter                        | Key            | Use it in                  | Text stored  |
| ------------------------------------ | -------------- | -------------------------- | ------------ |
| `/<episode>/ainakupo/production-key` | production key | the live app (production)  | never        |
| `/<episode>/ainakupo/preview-key`    | preview key    | CI and branch environments | yes, 30 days |

The script refuses an episode that already has keys; rotation isn't supported yet. See `README.md` and ADR-0003.

Only production-key traces appear on the dashboard. Preview traces are for CI: they can carry text, and the judge scores them.

## 2. Copy the SDK into the sending episode

The SDK is one dependency-free TypeScript file. Download it, commit it, and compile it with the episode's own TypeScript:

```sh
curl -fsSo src/ai/ainakupo.ts https://ainakupo.emilianocasijr.com/sdk/ainakupo.ts
```

To update it, download it again and review the diff before committing (ADR-0004). It imports only `node:crypto`, never reads `process.env`, never logs, and never throws.

## 3. Report each AI call from the Lambda

Read the right key from SSM once per container. Use `WithDecryption: true`. Give the Lambda's role `ssm:GetParameter` on `/<episode>/ainakupo/*`, and `kms:Decrypt` with the conditions `kms:ViaService` = `ssm.ap-southeast-1.amazonaws.com` and `kms:EncryptionContext:PARAMETER_ARN` like that path. The keys are SecureStrings, and AWS requires `kms:Decrypt` to read one decrypted. The episode boundary allows the same since `v1be-infra` #59. `portfolio-site`'s `infra/main.tf` has the statement. Pass the key in; the SDK won't look for it. Use the production key on production and the preview key on branch environments, so branch traffic stays off the dashboard.

```ts
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { createAInakupo, fromAnthropicUsage } from "./ainakupo.js";

const ssm = new SSMClient({});
let client: ReturnType<typeof createAInakupo> | undefined;

async function ainakupo() {
  if (!client) {
    const which = process.env.TARGET === "production" ? "production-key" : "preview-key";
    const out = await ssm.send(
      new GetParameterCommand({ Name: `/${EPISODE}/ainakupo/${which}`, WithDecryption: true }),
    );
    client = createAInakupo({
      endpoint: "https://ainakupo.emilianocasijr.com",
      ingestKey: out.Parameter?.Value ?? "",
    });
  }
  return client;
}

// Around each model call:
const startedAt = new Date();
const message = await callClaude(/* … */);
const result = await (
  await ainakupo()
).send({
  provider: "anthropic",
  model: message.model,
  feature: "menu-chat",
  ...fromAnthropicUsage(message.usage),
  startedAt,
  durationMs: Date.now() - startedAt.getTime(),
  costUsd: null, // or your own estimate; null shows as "unknown", never $0
  status: "ok",
});
if (!result.ok) console.warn("AInakupo trace not stored", result.reason);
```

- **Await `send`.** It's one request per trace with a 2-second timeout (`timeoutMs`, 100–10,000), and it doesn't retry. A Lambda may freeze as soon as the handler returns, so an unawaited send can be lost. A cold AInakupo can take over 1.5 s. If you set a shorter `timeoutMs` to stay inside your own Lambda's limit, expect some `timeout` results that AInakupo still stored (`portfolio-site` uses 1 s).
- **`send` never throws.** Every outcome is a `SendResult`; see the table below. AInakupo being down can't break the feature.
- **Report failed calls too,** with `status: "error"` and whatever tokens you have (0 is allowed).
- **`fromAnthropicUsage`** adds cached tokens into `inputTokens`, as the dashboard expects.
- **Don't send `prompt` or `response` from production.** The server drops text under a production key anyway, but the visitor's text shouldn't leave the app at all.

### Field rules

The server rejects a trace field by field, and the result's `field` names the first bad one.

| Field                         | Rule                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`                          | UUID; the SDK makes one if omitted. Resending the same `id` with the same key replaces the trace |
| `runId`                       | optional UUID, to group the calls of one request or agent run                                    |
| `provider`, `feature`         | 1–50 of `a-z`, `0-9`, `-`                                                                        |
| `model`                       | 1–100 characters, no control characters                                                          |
| `inputTokens`, `outputTokens` | integers 0–10,000,000                                                                            |
| `startedAt`                   | `Date` or ISO string, from now − 7 days to now + 5 minutes                                       |
| `durationMs`                  | integer 0–3,600,000                                                                              |
| `costUsd`                     | optional, `null` or 0–1,000                                                                      |
| `status`                      | `"ok"` or `"error"`                                                                              |
| `prompt`, `response`          | optional strings; kept only under the preview key, cut at 8,192 characters                       |

### Results

| `result`                                                              | Meaning                                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `{ ok: true, status: 201 \| 200, hasText, textTruncated }`            | stored (201 new, 200 replaced)                                                    |
| `reason: "invalid_trace"`, `field`                                    | a field broke its rule                                                            |
| `reason: "invalid_key"`                                               | missing, malformed or unknown key, or a key under the wrong prefix                |
| `reason: "trace_conflict"`                                            | that `id` was already sent with a different key                                   |
| `reason: "key_rate_limited"` or `"rate_limited"`, `retryAfterSeconds` | over 60 calls a minute for this key, or 120 a minute from one IP                  |
| `reason: "server_error"` / `"unexpected_response"`                    | AInakupo answered 5xx, or something it shouldn't have                             |
| `reason: "timeout"` / `"network"`                                     | no answer in time, a connection failure, or a redirect (refused)                  |
| `reason: "invalid_config"`                                            | bad `endpoint` (must be `https:`), key format or `timeoutMs`; no request was made |

## 4. Score answers in CI

An eval step sends a preview trace with its text, then asks AInakupo's judge (Claude Haiku 5.5) to score it against a criterion you describe. Read the preview key from SSM in the CI job, the same way as above.

```ts
const trace = await ainakupoPreview.send({
  provider: "anthropic",
  model,
  feature: "menu-chat",
  ...fromAnthropicUsage(message.usage),
  startedAt,
  durationMs,
  status: "ok",
  prompt: question,
  response: answer,
});
if (!trace.ok) throw new Error(`trace not stored: ${trace.reason}`);

const res = await fetch(`https://ainakupo.emilianocasijr.com/api/traces/${trace.id}/evaluations`, {
  method: "POST",
  headers: { authorization: `Bearer ${previewKey}`, "content-type": "application/json" },
  body: JSON.stringify({
    criterion: "answers-from-menu",
    description: "The answer only names dishes that appear on the menu in the prompt.",
  }),
});
const body = await res.json();
// 201: { id, traceId, criterion, score (1–5), explanation, model, createdAt }
```

- **Body:** exactly `criterion` (`^[a-z-]{1,50}$`) and `description` (1–1,000 characters).
- **Either of the episode's keys may judge its own traces.** Another episode's trace is a `404`.
- **Each `201` adds an evaluation;** re-judging keeps the history. The dashboard shows the episode's evaluation count and average score.
- **Handle every outcome:**

| Status | `error`                                           | Meaning                                                                                        |
| ------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 201    | –                                                 | scored                                                                                         |
| 400    | `invalid_criterion`                               | the body broke a rule                                                                          |
| 401    | `invalid_key`                                     | bad key                                                                                        |
| 404    | `trace_not_found`                                 | no such trace for this episode                                                                 |
| 422    | `no_text`                                         | the trace has no stored text (sent with the production key, without text, or over 30 days old) |
| 429    | `key_rate_limited`, `rate_limited` or `daily_cap` | wait `retry-after` seconds; `daily_cap` means the judge's spend cap is reached for today       |
| 502    | `judge_failed`                                    | the judge's reply was unusable; try again                                                      |
| 503    | `judge_unavailable`                               | Anthropic was busy; try again shortly                                                          |

- **Treat scores as advisory.** The trace text is graded as data, but a sender's own text can still nudge its own score. Use them to spot drift between runs, not as a hard gate.
- **The explanation is plain text.** Show it as text, never as HTML or Markdown.

## Privacy

- Production keys never store text. Preview text is kept for 30 days, then deleted, and is read only by the judge.
- Keys are stored only as SHA-256 hashes. Keep them in SSM, never in code, logs or URLs.
- The SDK never sends anything but the trace fields above. There's no default endpoint, so installing it sends nothing on its own.
