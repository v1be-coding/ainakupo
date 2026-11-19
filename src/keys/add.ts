import { randomBytes } from "node:crypto";
import { withRetry } from "@aws/aurora-dsql-drizzle";
import { PutParameterCommand, type SSMClient } from "@aws-sdk/client-ssm";
import { eq } from "drizzle-orm";
import { hashKey } from "../api/keys.js";
import type { connect } from "../db/client.js";
import { ingestKeys, sendingEpisodes, type KeyEnvironment } from "../db/schema.js";

const EPISODE_NAME = /^[a-z0-9-]{1,50}$/;

const PREFIX: Record<KeyEnvironment, string> = { production: "aik_prod_", preview: "aik_prev_" };
const PARAMETER: Record<KeyEnvironment, string> = {
  production: "production-key",
  preview: "preview-key",
};
const ENVIRONMENTS: KeyEnvironment[] = ["production", "preview"];

export type KeyRow = typeof ingestKeys.$inferInsert;

// What keys:add needs from production's database. Only hashes and suffixes cross it.
export interface KeyStore {
  hasKeys(episode: string): Promise<boolean>;
  // Adds the episode and its keys in one transaction, and throws EpisodeHasKeys if
  // the episode got keys since hasKeys answered.
  addKeys(episode: string, rows: KeyRow[]): Promise<void>;
}

export class EpisodeHasKeys extends Error {
  constructor(episode: string) {
    super(`${episode} already has keys; rotation isn't supported`);
  }
}

type MintedKey = { environment: KeyEnvironment; parameter: string; display: string };

function parameterName(episode: string, environment: KeyEnvironment): string {
  return `/${episode}/ainakupo/${PARAMETER[environment]}`;
}

// The only form of a key that may be shown or logged: its prefix and last 4 characters.
function displayKey(environment: KeyEnvironment, suffix: string): string {
  return `${PREFIX[environment]}…${suffix}`;
}

// 32 random bytes give exactly 43 base64url characters, with no padding.
function makeKey(environment: KeyEnvironment): string {
  return PREFIX[environment] + randomBytes(32).toString("base64url");
}

// Writes SSM first and the hashes last, so a stored hash always has its SSM value: a
// run that fails before the commit leaves only unknown keys in SSM, and running it
// again overwrites them. A run that fails after the commit is refused next time, and
// SSM already holds the keys that commit stored. Two runs at once for one episode can
// leave SSM holding the losing run's keys, so run one at a time.
export async function addKeys(
  episode: string,
  deps: { store: KeyStore; ssm: Pick<SSMClient, "send"> },
): Promise<MintedKey[]> {
  if (!EPISODE_NAME.test(episode)) {
    throw new Error(`Episode names match ${EPISODE_NAME.source}`);
  }
  if (await deps.store.hasKeys(episode)) throw new EpisodeHasKeys(episode);

  const keys = ENVIRONMENTS.map((environment) => ({ environment, key: makeKey(environment) }));

  for (const { environment, key } of keys) {
    await deps.ssm.send(
      new PutParameterCommand({
        Name: parameterName(episode, environment),
        Value: key,
        Type: "SecureString",
        Overwrite: true,
      }),
    );
  }

  const rows: KeyRow[] = keys.map(({ environment, key }) => ({
    hash: hashKey(key),
    episode,
    environment,
    textAllowed: environment === "preview",
    displaySuffix: key.slice(-4),
  }));
  await deps.store.addKeys(episode, rows);

  return rows.map((row) => ({
    environment: row.environment,
    parameter: parameterName(episode, row.environment),
    display: displayKey(row.environment, row.displaySuffix ?? ""),
  }));
}

type Admin = ReturnType<typeof connect>;

export function databaseKeyStore(db: Admin): KeyStore {
  return {
    async hasKeys(episode) {
      const rows = await withRetry(() =>
        db
          .select({ hash: ingestKeys.hash })
          .from(ingestKeys)
          .where(eq(ingestKeys.episode, episode))
          .limit(1),
      );
      return rows.length > 0;
    },
    async addKeys(episode, rows) {
      await db.transactionWithRetry(async (tx) => {
        const existing = await tx
          .select({ hash: ingestKeys.hash })
          .from(ingestKeys)
          .where(eq(ingestKeys.episode, episode))
          .limit(1);
        if (existing.length > 0) throw new EpisodeHasKeys(episode);

        // An update rather than DO NOTHING, so two racing runs write the same row and
        // DSQL's optimistic concurrency aborts one; its retry then sees the keys.
        await tx
          .insert(sendingEpisodes)
          .values({ name: episode })
          .onConflictDoUpdate({ target: sendingEpisodes.name, set: { name: episode } });
        await tx.insert(ingestKeys).values(rows).onConflictDoNothing({ target: ingestKeys.hash });
      });
    },
  };
}
