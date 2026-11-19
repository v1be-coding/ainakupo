# Setup: the test-episode keys

A Setup change the user makes **before `/acceptance`**, settled while grilling AInakupo's spec (2026-11-19). It gives the frozen tests two ingest keys whose plaintext is never in the repo. A session helping with it should read this file, then `docs/adr/0002-production-and-preview-ingest-keys.md`, `docs/adr/0003-keys-minted-by-an-owner-run-script.md` and `docs/research/ingest-key-hashing.md`. Use the `wizard` skill for the steps only the user can do.

## Why

The frozen tests send traces as a fake sending episode, `test-episode`, which has a production key and a preview key. The repo is public, and the rule is that **no plaintext key is ever public**. So the plaintext keys live only in GitHub Actions secrets. Only their SHA-256 hashes are committed (in the spec and in `src/db/seed-data.ts`), which is safe because each key holds 256 random bits.

## The decided rules

- **Format:** `aik_prod_` or `aik_prev_`, then 43 base64url characters: 32 random bytes, base64url without padding. Regex: `^aik_(prod|prev)_[A-Za-z0-9_-]{43}$`. Never typed by hand.
- **Hash:** `lowercase_hex(SHA-256(UTF-8(full key)))`, over the full key including the prefix. No pepper, no salt.
- **Names:** GitHub Actions secrets `TEST_PRODUCTION_KEY` (an `aik_prod_` key) and `TEST_PREVIEW_KEY` (an `aik_prev_` key), at repository level in `v1be-coding/ainakupo`.
- **The plaintext is never printed, logged, pasted into chat or written to a file.** Only the two hashes leave the wizard.
- If a key ever leaks, make a new one, replace the secret, and replace its committed hash.

## Steps

1. **Make the keys (user, through a wizard).** For each key: generate it, pipe it straight into `gh secret set <NAME> --repo v1be-coding/ainakupo` on stdin, and print only its SHA-256 hex hash. There's no Python in the container, so use Node or `openssl` plus `sha256sum`. Strip the newline before hashing.
2. **Hand back the hashes.** Give both hashes, each labelled with its secret name, to the spec session. They go in the spec issue and, through the run, in `seed-data.ts`.
3. **Change the workflows (user only, since the agent's App can't write workflows):**
   - **Pass the secrets to the frozen tests.** The chain is `deploy.yml`, which calls `deploy-target.yml`, which calls `verify.yml`. `deploy.yml` already calls `deploy-target.yml` with `secrets: inherit`, so `deploy-target.yml` will see both secrets once they exist. The gaps are:
     - `verify.yml`: declare `TEST_PRODUCTION_KEY` and `TEST_PREVIEW_KEY` under `on.workflow_call.secrets`, and add them to the `env:` of the "Run the frozen tests" step (`.github/workflows/verify.yml:49-56`).
     - `deploy-target.yml`: pass the two secrets **by name** at the `verify:` call (`.github/workflows/deploy-target.yml:188-197`). Don't use `secrets: inherit` there, because it would also hand the frozen tests `PORTFOLIO_ACCOUNT_ID` and `INFRACOST_API_KEY`, and the verify job is deliberately kept free of AWS access.

     Acceptance tests run only on branch environments (`FROZEN_TARGET`), so production's run doesn't need the keys, but passing them there does no harm.

   - **The seed step's target needs no change.** `deploy-target.yml:30` already sets `TARGET: ${{ inputs.environment }}` for the whole workflow. The run's seed code will skip `test-episode` when `TARGET` is `production`.
4. **Check (user):** `gh secret list --repo v1be-coding/ainakupo` shows both names. The App gets a 403 on that command, so the user runs it. The workflow change is merged to `main` before `/acceptance`.

## Not part of this Setup

These are done by the run, from the spec:

- the seed code that skips `test-episode` on production
- the server refusing `test-episode` keys on production as a backup
- the `aik_` rule in `.secretlintrc.json`
- `npm run keys:add` for real sending episodes.

## Status

- **2026-11-19:** steps 1 and 2 done. `v1be-infra/sandbox/wizards/test-keys.sh ainakupo` (`v1be-infra` #57) set both secrets. The hashes, for the spec issue and `src/db/seed-data.ts`:
  - `TEST_PRODUCTION_KEY`: `97bb3d2b51d9f40bf769038af262fd57f2bbebb77732529880d65e4a6978bdb4`
  - `TEST_PREVIEW_KEY`: `698b4ee71375aa0ec42e27a4934c72f6986369e3bfcce76063a95321c9ad1534`
- Step 3: done in #2 ("Update workflow"). `verify.yml` declares both secrets and puts them in the frozen-test step's `env:`, and `deploy-target.yml` passes them by name at the `verify:` call.
