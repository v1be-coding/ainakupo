import { PutParameterCommand, type PutParameterCommandInput } from "@aws-sdk/client-ssm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { hashKey } from "../api/keys.js";
import { addKeys, EpisodeHasKeys, type KeyRow, type KeyStore } from "./add.js";

const KEY = /^aik_(prod|prev)_[A-Za-z0-9_-]{43}$/;

function fakes(options: { hasKeys?: boolean; addFails?: Error } = {}) {
  const stored: KeyRow[] = [];
  const hasKeys = vi.fn(() => Promise.resolve(options.hasKeys ?? false));
  const addRows = vi.fn((_episode: string, rows: KeyRow[]) => {
    if (options.addFails) return Promise.reject(options.addFails);
    stored.push(...rows);
    return Promise.resolve();
  });
  const store: KeyStore = { hasKeys, addKeys: addRows };
  const puts: PutParameterCommandInput[] = [];
  const send = vi.fn((command: unknown) => {
    if (!(command instanceof PutParameterCommand)) throw new Error("unexpected SSM call");
    puts.push(command.input);
    return Promise.resolve({});
  });
  return { store, hasKeys, addRows, stored, puts, send, ssm: { send } as never };
}

const secret = (puts: PutParameterCommandInput[], suffix: string) =>
  puts.find((put) => put.Name?.endsWith(suffix))?.Value ?? "";

let logs: MockInstance[] = [];

beforeEach(() => {
  logs = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("addKeys", () => {
  it("makes a production and a preview key in the key format", async () => {
    const { store, puts, ssm } = fakes();

    await addKeys("portfolio", { store, ssm });

    const production = secret(puts, "/production-key");
    const preview = secret(puts, "/preview-key");
    expect(production).toMatch(KEY);
    expect(production.startsWith("aik_prod_")).toBe(true);
    expect(preview).toMatch(KEY);
    expect(preview.startsWith("aik_prev_")).toBe(true);
    expect(production).not.toBe(preview);
  });

  it("writes both keys as SecureStrings under the sending episode's own path", async () => {
    const { store, puts, ssm } = fakes();

    await addKeys("portfolio", { store, ssm });

    expect(puts.map(({ Name, Type }) => ({ Name, Type }))).toEqual([
      { Name: "/portfolio/ainakupo/production-key", Type: "SecureString" },
      { Name: "/portfolio/ainakupo/preview-key", Type: "SecureString" },
    ]);
  });

  it("stores only hashes and suffixes, with text allowed for the preview key only", async () => {
    const { store, stored, puts, ssm } = fakes();

    await addKeys("portfolio", { store, ssm });

    const production = secret(puts, "/production-key");
    const preview = secret(puts, "/preview-key");
    expect(stored).toEqual([
      {
        hash: hashKey(production),
        episode: "portfolio",
        environment: "production",
        textAllowed: false,
        displaySuffix: production.slice(-4),
      },
      {
        hash: hashKey(preview),
        episode: "portfolio",
        environment: "preview",
        textAllowed: true,
        displaySuffix: preview.slice(-4),
      },
    ]);
    expect(JSON.stringify(stored)).not.toContain(production);
    expect(JSON.stringify(stored)).not.toContain(preview);
  });

  it("writes SSM before the hashes, so a stored hash always has its key in SSM", async () => {
    const { store, addRows, send, ssm } = fakes();

    await addKeys("portfolio", { store, ssm });

    const lastPut = Math.max(...send.mock.invocationCallOrder);
    const [stored] = addRows.mock.invocationCallOrder;
    expect(stored).toBeGreaterThan(lastPut);
  });

  it("returns and logs nothing that holds a key, only its display form", async () => {
    const { store, puts, ssm } = fakes();

    const minted = await addKeys("portfolio", { store, ssm });

    const production = secret(puts, "/production-key");
    const preview = secret(puts, "/preview-key");
    expect(minted).toEqual([
      {
        environment: "production",
        parameter: "/portfolio/ainakupo/production-key",
        display: `aik_prod_…${production.slice(-4)}`,
      },
      {
        environment: "preview",
        parameter: "/portfolio/ainakupo/preview-key",
        display: `aik_prev_…${preview.slice(-4)}`,
      },
    ]);
    const printed = JSON.stringify(logs.map((spy) => spy.mock.calls));
    for (const key of [production, preview]) {
      expect(printed).not.toContain(key);
      expect(printed).not.toContain(key.slice(9, -4));
    }
  });

  it("puts no key in the error when the database write fails", async () => {
    const { store, puts, ssm } = fakes({ addFails: new Error("connection reset") });

    const error = await addKeys("portfolio", { store, ssm }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    for (const put of puts) {
      expect(String(error)).not.toContain(put.Value);
    }
  });

  it.each(["", "Portfolio", "has space", "under_score", "a".repeat(51), "../etc", "x/y"])(
    "refuses the episode name %j before writing anything",
    async (name) => {
      const { store, hasKeys, addRows, send, ssm } = fakes();

      await expect(addKeys(name, { store, ssm })).rejects.toThrow("Episode names match");

      expect(send).not.toHaveBeenCalled();
      expect(hasKeys).not.toHaveBeenCalled();
      expect(addRows).not.toHaveBeenCalled();
    },
  );

  it("accepts a 50-character name", async () => {
    const { store, ssm } = fakes();

    await expect(addKeys("a".repeat(50), { store, ssm })).resolves.toHaveLength(2);
  });

  it("refuses an episode that already has keys before writing anything", async () => {
    const { store, hasKeys, addRows, send, ssm } = fakes({ hasKeys: true });

    await expect(addKeys("portfolio", { store, ssm })).rejects.toBeInstanceOf(EpisodeHasKeys);

    expect(hasKeys).toHaveBeenCalledWith("portfolio");
    expect(send).not.toHaveBeenCalled();
    expect(addRows).not.toHaveBeenCalled();
  });
});
