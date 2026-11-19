// The owner's keys:add, run with admin AWS credentials and production's
// CLUSTER_ENDPOINT: npm run keys:add -- <episode> (ADR-0003). Prints no key.
import { SSMClient } from "@aws-sdk/client-ssm";
import { connect } from "../db/client.js";
import { describeError } from "../db/setup.js";
import { addKeys, databaseKeyStore } from "./add.js";

// The sending episode's SSM path is in the same region as the cluster:
// <id>.dsql.<region>.on.aws.
function regionOf(endpoint: string): string {
  const region = /^[^.]+\.dsql\.([a-z0-9-]+)\.on\.aws$/.exec(endpoint)?.[1];
  if (!region) throw new Error("CLUSTER_ENDPOINT isn't a DSQL cluster endpoint");
  return region;
}

async function main() {
  const episode = process.argv[2] ?? "";
  const region = regionOf(process.env.CLUSTER_ENDPOINT ?? "");

  const db = connect("admin");
  try {
    const minted = await addKeys(episode, {
      store: databaseKeyStore(db),
      ssm: new SSMClient({ region }),
    });
    for (const key of minted) {
      console.log(`${key.environment}: ${key.display} saved to ${key.parameter}`);
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(describeError(error));
  process.exitCode = 1;
});
