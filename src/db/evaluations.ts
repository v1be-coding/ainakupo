import { withRetry } from "@aws/aurora-dsql-drizzle";
import { eq } from "drizzle-orm";
import { apiDb, type ApiDb as Db } from "./api-db.js";
import { traces } from "./schema.js";

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
