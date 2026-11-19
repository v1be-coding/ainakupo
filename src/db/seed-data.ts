import type { ingestKeys, sendingEpisodes } from "./schema.js";

// Branch environments only: the frozen tests' own sending episode (C31). Keyed by
// name and hash, so a repeat adds nothing. The plaintext keys live only in GitHub
// Actions secrets; their hashes are safe to commit (docs/research/ingest-key-hashing.md).
export const seedEpisodes: (typeof sendingEpisodes.$inferInsert)[] = [{ name: "test-episode" }];

export const seedKeys: (typeof ingestKeys.$inferInsert)[] = [
  {
    // TEST_PRODUCTION_KEY
    hash: "97bb3d2b51d9f40bf769038af262fd57f2bbebb77732529880d65e4a6978bdb4",
    episode: "test-episode",
    environment: "production",
    textAllowed: false,
    displaySuffix: null,
  },
  {
    // TEST_PREVIEW_KEY
    hash: "698b4ee71375aa0ec42e27a4934c72f6986369e3bfcce76063a95321c9ad1534",
    episode: "test-episode",
    environment: "preview",
    textAllowed: true,
    displaySuffix: null,
  },
];
