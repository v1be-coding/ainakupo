import { getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { accessStatements, describeError, loginStatement, seed } from "./setup.js";

const arn = "arn:aws:iam::000000000000:role/v1be-sample-api-production";

describe("loginStatement", () => {
  it("maps the database role to the Lambda's role", () => {
    expect(loginStatement(arn)).toBe(`AWS IAM GRANT api TO '${arn}'`);
  });

  it.each(["", "arn:aws:iam::000000000000:user/someone", `${arn}'; DROP TABLE notes; --`])(
    "refuses %j",
    (value) => {
      expect(() => loginStatement(value)).toThrow("not an IAM role ARN");
    },
  );
});

describe("accessStatements", () => {
  it("gives the app read and write access to tables, and no schema rights", () => {
    expect(accessStatements).toEqual([
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO api",
    ]);
  });
});

// A database that keeps inserted rows per table and, like ON CONFLICT DO NOTHING,
// never overwrites a row whose primary key it already has.
function fakeDb() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const rowsOf = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name) as Map<string, Record<string, unknown>>;
  };
  const keyOf = (name: string, row: Record<string, unknown>) =>
    String(name === "ingest_keys" ? row.hash : (row.name ?? row.id));

  const tx = {
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        onConflictDoNothing: () => {
          const name = getTableName(table);
          for (const row of [values].flat()) {
            const key = keyOf(name, row);
            if (!rowsOf(name).has(key)) rowsOf(name).set(key, row);
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  const transactionWithRetry = vi.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx));
  const db = { transactionWithRetry } as unknown as Parameters<typeof seed>[0];

  return { db, transactionWithRetry, rows: (name: string) => [...rowsOf(name).values()] };
}

describe("seed", () => {
  it("adds test-episode and its production and preview keys on a branch environment (C31)", async () => {
    const { db, rows } = fakeDb();

    await seed(db, "pr-12");

    expect(rows("sending_episodes")).toEqual([{ name: "test-episode" }]);
    expect(rows("ingest_keys")).toEqual(
      expect.arrayContaining([
        {
          hash: "97bb3d2b51d9f40bf769038af262fd57f2bbebb77732529880d65e4a6978bdb4",
          episode: "test-episode",
          environment: "production",
          textAllowed: false,
          displaySuffix: null,
        },
        {
          hash: "698b4ee71375aa0ec42e27a4934c72f6986369e3bfcce76063a95321c9ad1534",
          episode: "test-episode",
          environment: "preview",
          textAllowed: true,
          displaySuffix: null,
        },
      ]),
    );
    expect(rows("ingest_keys")).toHaveLength(2);
    expect(rows("traces")).toEqual([]);
    expect(rows("evaluations")).toEqual([]);
  });

  it("changes nothing when it runs again", async () => {
    const { db, rows } = fakeDb();

    await seed(db, "pr-12");
    const before = { episodes: rows("sending_episodes"), keys: rows("ingest_keys") };
    await seed(db, "pr-12");

    expect({ episodes: rows("sending_episodes"), keys: rows("ingest_keys") }).toEqual(before);
  });

  it("adds nothing on production", async () => {
    const { db, transactionWithRetry } = fakeDb();

    await seed(db, "production");

    expect(transactionWithRetry).not.toHaveBeenCalled();
  });

  it("refuses to guess when it doesn't know the target", async () => {
    const { db, transactionWithRetry } = fakeDb();

    await expect(seed(db, "")).rejects.toThrow("TARGET");
    expect(transactionWithRetry).not.toHaveBeenCalled();
  });
});

describe("describeError", () => {
  it("includes the database's own reason, which Drizzle wraps", () => {
    const error = new Error("Failed query", { cause: new Error("permission denied") });

    expect(describeError(error)).toBe("Failed query: permission denied");
  });

  it("copes with an error that has no cause", () => {
    expect(describeError(new Error("no endpoint"))).toBe("no endpoint");
  });
});
