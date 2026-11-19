import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// IDs come from the client, so a retried write lands on the same row (ADR-0003).
// Unused since AInakupo replaced the template's notes; migrations only add, so it stays.
export const notes = pgTable("notes", {
  id: uuid().primaryKey(),
  text: text().notNull(),
});

// DSQL has no foreign keys, so the links between these tables are kept by the code
// that writes them.

// A series episode whose live app sends traces, named like `test-episode`.
export const sendingEpisodes = pgTable("sending_episodes", {
  name: text().primaryKey(),
});

export type KeyEnvironment = "production" | "preview";

// Only the key's SHA-256 is stored, never the key (ADR-0002, ADR-0003).
export const ingestKeys = pgTable(
  "ingest_keys",
  {
    hash: text().primaryKey(),
    episode: text().notNull(),
    environment: text().$type<KeyEnvironment>().notNull(),
    textAllowed: boolean("text_allowed").notNull(),
    // The key's last 4 characters, for showing which key is which. Null on seeded keys.
    displaySuffix: text("display_suffix"),
  },
  (t) => [index("ingest_keys_episode_idx").on(t.episode)],
);

// One model call. The numbers live here; the text lives in DynamoDB (ADR-0001).
export const traces = pgTable(
  "traces",
  {
    id: uuid().primaryKey(),
    keyHash: text("key_hash").notNull(),
    episode: text().notNull(),
    // Copied from the key, so summaries can keep to production traces without a join.
    environment: text().$type<KeyEnvironment>().notNull(),
    runId: uuid("run_id"),
    provider: text().notNull(),
    model: text().notNull(),
    feature: text().notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, precision: 3 }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    costUsd: doublePrecision("cost_usd"),
    status: text().$type<"ok" | "error">().notNull(),
    hasText: boolean("has_text").notNull(),
  },
  (t) => [
    index("traces_environment_started_at_idx").on(t.environment, t.startedAt),
    index("traces_episode_idx").on(t.episode),
  ],
);

// One judge's score of one trace against one criterion. Each judging adds a row.
export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid().primaryKey(),
    traceId: uuid("trace_id").notNull(),
    episode: text().notNull(),
    criterion: text().notNull(),
    description: text().notNull(),
    score: integer().notNull(),
    explanation: text().notNull(),
    model: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull(),
  },
  (t) => [
    index("evaluations_trace_id_idx").on(t.traceId),
    index("evaluations_episode_idx").on(t.episode),
  ],
);
