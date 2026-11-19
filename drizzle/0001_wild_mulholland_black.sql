CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trace_id" uuid NOT NULL,
	"episode" text NOT NULL,
	"criterion" text NOT NULL,
	"description" text NOT NULL,
	"score" integer NOT NULL,
	"explanation" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_keys" (
	"hash" text PRIMARY KEY NOT NULL,
	"episode" text NOT NULL,
	"environment" text NOT NULL,
	"text_allowed" boolean NOT NULL,
	"display_suffix" text
);
--> statement-breakpoint
CREATE TABLE "sending_episodes" (
	"name" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"episode" text NOT NULL,
	"environment" text NOT NULL,
	"run_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"feature" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"cost_usd" double precision,
	"status" text NOT NULL,
	"has_text" boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX ASYNC "evaluations_trace_id_idx" ON "evaluations"("trace_id");
--> statement-breakpoint
CREATE INDEX ASYNC "evaluations_episode_idx" ON "evaluations"("episode");
--> statement-breakpoint
CREATE INDEX ASYNC "ingest_keys_episode_idx" ON "ingest_keys"("episode");
--> statement-breakpoint
CREATE INDEX ASYNC "traces_environment_started_at_idx" ON "traces"("environment", "started_at");
--> statement-breakpoint
CREATE INDEX ASYNC "traces_episode_idx" ON "traces"("episode");
