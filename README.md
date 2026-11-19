# episode-template

Where every V1be Coding episode starts.

## Sites

- **Production:** none for the template itself. Setup sets this line to the episode's address, such as `https://<subdomain>.emilianocasijr.com`.
- **Branch environments:** each ready PR in an episode gets its own address, printed as `Branch environment: <url>` in its `branch / deploy` job log. The template's own PRs deploy nothing: they run `rounds`, `checks` and `green` only.

## Database

Aurora DSQL through `@aws/aurora-dsql-drizzle` (ADR-0003). Change `src/db/schema.ts`, run `npm run db:generate`, then review and commit what lands in `drizzle/`.

- **Migrations only add things.** A revert can't undo one, and `deploy.yml` refuses any that don't.
- **Writes are upserts keyed by client-generated IDs, inside `transactionWithRetry`,** because any write may be retried.
- **`src/db/seed-data.ts` holds fake data only:** `test-episode` and its two test key hashes. It loads on every branch environment; the seed skips production itself (`TARGET=production`).
- **Trace text isn't in the database.** It lives in the `v1be-<episode>-trace-text-<target>` DynamoDB table, through `src/db/trace-text.ts`, and expires 30 days after its trace started (ADR-0001).
