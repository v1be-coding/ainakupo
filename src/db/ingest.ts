import { withRetry } from "@aws/aurora-dsql-drizzle";
import { desc, eq } from "drizzle-orm";
import { apiDb, type ApiDb as Db } from "./api-db.js";
import { ingestKeys, traces, type KeyEnvironment } from "./schema.js";

export type StoredKey = {
  hash: string;
  episode: string;
  environment: KeyEnvironment;
  textAllowed: boolean;
};

export async function findIngestKey(hash: string, db: Db = apiDb()): Promise<StoredKey | null> {
  const rows = await withRetry(() =>
    db
      .select({
        hash: ingestKeys.hash,
        episode: ingestKeys.episode,
        environment: ingestKeys.environment,
        textAllowed: ingestKeys.textAllowed,
      })
      .from(ingestKeys)
      .where(eq(ingestKeys.hash, hash)),
  );
  return rows[0] ?? null;
}

export type TraceRow = typeof traces.$inferInsert;

export type SaveOutcome = "created" | "replaced" | "conflict";

// Upserts the trace, unless its id belongs to another key: then nothing changes. DSQL's
// optimistic concurrency aborts one of two racing writes to the same id, and the retry
// then reads the winner's key.
export async function saveTrace(row: TraceRow, db: Db = apiDb()): Promise<SaveOutcome> {
  const { id, ...fields } = row;
  return db.transactionWithRetry(async (tx) => {
    const [existing] = await tx
      .select({ keyHash: traces.keyHash })
      .from(traces)
      .where(eq(traces.id, id));
    if (existing && existing.keyHash !== row.keyHash) return "conflict";

    await tx.insert(traces).values(row).onConflictDoUpdate({ target: traces.id, set: fields });
    return existing ? "replaced" : "created";
  });
}

export type RecentTrace = {
  id: string;
  runId: string | null;
  episode: string;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number | null;
  status: "ok" | "error";
  startedAt: Date;
};

const RECENT_LIMIT = 50;

export async function listRecentTraces(db: Db = apiDb()): Promise<RecentTrace[]> {
  return withRetry(() =>
    db
      .select({
        id: traces.id,
        runId: traces.runId,
        episode: traces.episode,
        feature: traces.feature,
        provider: traces.provider,
        model: traces.model,
        inputTokens: traces.inputTokens,
        outputTokens: traces.outputTokens,
        durationMs: traces.durationMs,
        costUsd: traces.costUsd,
        status: traces.status,
        startedAt: traces.startedAt,
      })
      .from(traces)
      .where(eq(traces.environment, "production"))
      .orderBy(desc(traces.startedAt), desc(traces.id))
      .limit(RECENT_LIMIT),
  );
}
