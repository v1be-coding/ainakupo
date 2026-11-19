# Ingest keys are minted by a script the owner runs

Each episode's roles can read and write only their own SSM path, so AInakupo's CI can't hand a key to a sending episode. Rather than ask `v1be-infra` for a cross-episode grant or expose an admin route that mints keys, the owner runs `npm run keys:add -- <episode>` with their own admin AWS credentials. It makes a production key and a preview key, stores only their hashes in AInakupo's database, writes the plaintext into the sending episode's own SSM path, and never prints them. The frozen tests' `test-episode` keys follow the same rule that no plaintext key is public: the owner makes them with a wizard and stores them only as GitHub Actions secrets, while their SHA-256 hashes are committed in `seed-data.ts`. That is safe because each key holds 256 random bits (`docs/research/ingest-key-hashing.md`). The seed skips `test-episode` on production, and production's server also refuses its keys.

## Considered Options

- **A cross-episode SSM grant:** a `v1be-infra` change that weakens the one-path-per-episode rule.
- **An admin route that mints keys:** a public route that would need its own authentication.
