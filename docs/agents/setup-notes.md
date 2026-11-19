# Setup notes

What Setup learned that the spec must honour. Each note is a constraint on the spec, unless the user says otherwise.

## The episode

| Field | Value |
| --- | --- |
| Site | `https://ainakupo.emilianocasijr.com` (`SITE_URL`) |
| Shape | `pages = true`: prerendered pages, clean URLs, a 404 page, and the security headers below |
| Anthropic | `anthropic = true`, for evals scored by a Claude judge. See [`calling-claude.md`](../calling-claude.md) |

## What AInakupo is for

It records how the series' apps use AI: traces, token counts, latency, cost, and eval scores. Later episodes report through it.

## Ingest rules

The ingest API is public, so the spec must make these hold:

1. **The SDK has no default endpoint.** Whoever uses it sets the URL. Installing it never sends anything to this site.
2. **Every trace needs an ingest key.** Each sending episode has its own key. The server rejects a missing or unknown key, and limits each key's rate.
3. **The SDK never reads or sends API keys or credentials.** It sends metadata: model, token counts, latency, cost. Prompt and response text are left out unless the sending app turns them on.

## Infra limits

- **An episode reads only its own SSM path.** Each episode's roles can read and write `/<episode>/*` and nothing else. So AInakupo's CI can't put a key where `portfolio-site` reads it, and `portfolio-site` can't read `/ainakupo/*`. The spec must say how a sending episode gets its ingest key. Any answer that needs a cross-episode grant is a `v1be-infra` change, so flag it before `/acceptance`.
- **The CSP allows only the site's own origin:** `default-src 'self'` for scripts, styles, images, fonts and `connect-src`, and `frame-ancestors 'none'`. No CDN scripts, web fonts or third-party charts loaded from elsewhere. Bundle what the dashboard needs. Widening it is a `v1be-infra` change.
- **Traces come from servers, not browsers.** Sending episodes call the ingest API from their Lambdas, so the API needs no CORS. A browser sender would need it.

## The Claude judge

- **Only Haiku 5.5 can be called.** It has a rate limit of 120 requests a minute. Every other model, batch and web search is at 0 for now. A spec that needs another model says so, and the user raises its limit first.
- **Spend:** every judge call goes through `withSpendCap` (the daily cap). The episode's Anthropic workspace has a monthly limit, set in Setup step 5.
- **Judge prompts see stored traces.** If a sending app turned on prompt text, that text reaches the judge. Say in the spec whether the judge may read it.

## npm

**Not decided.** The spec decides whether the SDK is published to npm, and leans toward not. Without npm, episodes install it from this repo. Publishing is a one-way step, since npm keeps every version.

If the spec does publish: use npm trusted publishing from a `publish.yml` workflow (no token), under a `@v1be-coding` npm org. The first version is published by hand, because a trusted publisher can only be added to a package that exists. The user creates the npm org and uploads the workflow.
