# episode-template

Where every V1be Coding episode starts.

## Sites

- **Production:** none for the template itself. Setup sets this line to the episode's address, such as `https://<subdomain>.emilianocasijr.com`.
- **Branch environments:** each ready PR in an episode gets its own address, printed as `Branch environment: <url>` in its `branch / deploy` job log. The template's own PRs deploy nothing: they run `rounds`, `checks` and `green` only.

## Sending traces from another episode

`docs/using-ainakupo.md`: minting an episode's keys, copying the SDK, reporting each AI call from a Lambda, and scoring answers with the judge in CI.

## Database

Aurora DSQL through `@aws/aurora-dsql-drizzle` (ADR-0003). Change `src/db/schema.ts`, run `npm run db:generate`, then review and commit what lands in `drizzle/`.

- **Migrations only add things.** A revert can't undo one, and `deploy.yml` refuses any that don't.
- **Writes are upserts keyed by client-generated IDs, inside `transactionWithRetry`,** because any write may be retried.
- **`src/db/seed-data.ts` holds fake data only:** `test-episode` and its two test key hashes. It loads on every branch environment; the seed skips production itself (`TARGET=production`).
- **A sending episode's keys come from `npm run keys:add -- <episode>`** (ADR-0003), run by the owner with admin AWS credentials and `CLUSTER_ENDPOINT` set to production's cluster (`<id>.dsql.ap-southeast-1.on.aws`). It writes the keys to `/<episode>/ainakupo/{production,preview}-key` in SSM, stores only their hashes, prints only `aik_prod_…abcd`, and refuses an episode that already has keys. If it fails, run it again: a failure before the database commit leaves only unused keys in SSM, which the rerun overwrites.
- **Trace text isn't in the database.** It lives in the `v1be-<episode>-trace-text-<target>` DynamoDB table, through `src/db/trace-text.ts`, and expires 30 days after its trace started (ADR-0001).
