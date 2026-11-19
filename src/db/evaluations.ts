import { withRetry } from "@aws/aurora-dsql-drizzle";
import { eq } from "drizzle-orm";
import { apiDb, type ApiDb as Db } from "./api-db.js";
import { evaluations, traces } from "./schema.js";

export type EvaluationRow = typeof evaluations.$inferInsert;

// What judging needs to know about a trace before reading its text.
export type JudgedTrace = {
  id: string;
  episode: string;
  startedAt: Date;
  hasText: boolean;
};

// `id` must already be a UUID: the column is typed, so anything else fails the query.
export async function findTrace(id: string, db: Db = apiDb()): Promise<JudgedTrace | null> {
  const rows = await withRetry(() =>
    db
      .select({
        id: traces.id,
        episode: traces.episode,
        startedAt: traces.startedAt,
        hasText: traces.hasText,
      })
      .from(traces)
      .where(eq(traces.id, id)),
  );
  return rows[0] ?? null;
}

// Adds one evaluation; earlier ones for the same trace stay. The id is made before the
// call, so a retried transaction lands on the same row instead of adding a second.
export async function saveEvaluation(row: EvaluationRow, db: Db = apiDb()): Promise<void> {
  await db.transactionWithRetry(async (tx) => {
    await tx
      .insert(evaluations)
      .values(row)
      .onConflictDoUpdate({
        target: evaluations.id,
        set: {
          traceId: row.traceId,
          episode: row.episode,
          criterion: row.criterion,
          description: row.description,
          score: row.score,
          explanation: row.explanation,
          model: row.model,
          createdAt: row.createdAt,
        },
      });
  });
}
