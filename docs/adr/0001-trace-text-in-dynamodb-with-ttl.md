# Trace text lives in a DynamoDB table with a TTL; trace numbers live in DSQL

Trace text must be gone 30 days after the trace started, but the episode's CI role can't create a scheduler (EventBridge), so nothing can run a daily cleanup, and deleting old text inside each ingest request would put housekeeping on the hot path. So trace text goes in its own DynamoDB table, keyed by trace id, with a TTL of `startedAt` + 30 days that DynamoDB enforces by itself, while trace numbers and evaluations stay in DSQL. DynamoDB deletes expired items within days rather than on the second, so every read, the judge included, also treats text older than 30 days as gone.

## Considered Options

- **A daily cleanup job:** needs a scheduler the CI role can't create.
- **Deleting a bounded batch of old text on each ingest request:** works with one database, but adds a delete to every request.
- **Text in DSQL with a read-side filter only:** text would never actually be deleted.
