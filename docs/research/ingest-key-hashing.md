# Ingest key hashing, format and the public test-key hashes (for the spec)

Researched 2026-11-19 against primary sources: OWASP cheat sheets, NIST publications and project pages, vendor
docs, and source on the owning GitHub repos (Langfuse via `gh search code`, secretlint via a shallow clone).
Where a source didn't answer, this note says **not confirmed**. Inferences are labelled as such.

---

## 1. Summary

- **Plain SHA-256 is enough for a 256-bit random key.** NIST SP 800-63B-4 requires a salted *password hashing
  scheme* only for look-up secrets below 112 bits; above that, "an approved hashing function" suffices
  ([NIST 800-63B-4 §3.1.2.2](https://pages.nist.gov/800-63-4/sp800-63b.html)). OWASP's "SHA-256 is not suitable"
  warning is about passwords, and the cheat sheet says nothing about random API keys
  ([OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)).
- **Real key managers do exactly this.** Unkey: "hashes the full key string with SHA-256 … There's no salt"
  ([Unkey](https://www.unkey.com/docs/security/overview)). Langfuse moved *from* bcrypt *to* a fast SHA-256 hash
  looked up on a unique column ([apiKeys.ts](https://github.com/langfuse/langfuse/blob/main/packages/shared/src/server/auth/apiKeys.ts),
  [apiKeyRepository.ts](https://github.com/langfuse/langfuse/blob/main/web/src/features/apiKey/apiKeyRepository.ts)).
- **bcrypt/scrypt/argon2 are the wrong tool here.** They exist to slow guessing of low-entropy input; on a Lambda
  hot path they add tens of ms per request with no gain when the input is 256 random bits (inference;
  Langfuse's migration away from bcrypt for this reason is the closest primary evidence).
- **A pepper (HMAC) is optional defence in depth,** and buys almost nothing for 256-bit keys. NIST puts the
  keyed-hash SHOULD on *passwords* (§3.1.1.2), not look-up secrets. GitLab and Langfuse both mix in a server
  secret; Unkey doesn't.
- **Publishing the SHA-256 of a 256-bit random key is cryptographically safe.** SHA-256 preimage resistance is
  256 bits ([NIST hash functions](https://csrc.nist.gov/projects/hash-functions#security-strengths)). The real
  risks are elsewhere: a low-entropy test key, any code path that accepts the hash as a credential, and the test
  key being *valid data* in production.
- **It's not common practice, but it's not flagged either.** No primary source recommends or forbids it; the
  common OSS pattern is synthetic plaintext dev keys hashed at seed time (Langfuse). No secretlint rule and no
  GitHub secret-scanning pattern matches a 64-char hex hash.
- **Key format: keep `aik_` + 43 base64url chars.** Prefix for identification and scanning (GitHub, Stripe,
  Supabase all do it). A checksum only pays off with GitHub's partner program, which AInakupo won't join.
- **Display suffix: last 4 characters,** stored as `aik_…abcd`. Costs 24 of 256 bits.

---

## 2. Hashing a high-entropy key: SHA-256 vs HMAC vs password hashes

**NIST SP 800-63B-4** (look-up secrets, §3.1.2.2): "All look-up secrets SHALL be stored in a hashed form using an
approved hashing function." Only secrets shorter than the SP 800-131A minimum strength ("112 bits as of the date
of this publication") "SHALL be stored in a salted and hashed form using a suitable password hashing scheme," with
a salt of at least 32 bits. The verifier "SHALL implement a rate-limiting mechanism" on failed attempts
([NIST 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)). An ingest key isn't literally a look-up
secret, but it's the closest category for a verifier-generated random bearer secret (inference).

**NIST, passwords** (§3.1.1.2): a password hashing scheme from SP 800-132 SHOULD be used, and verifiers SHOULD add
"a keyed hashing or encryption operation using a secret key known only to the verifier," stored "separately from
the hashed passwords," ideally in an HSM or TEE ([same](https://pages.nist.gov/800-63-4/sp800-63b.html)). The
document doesn't state that keyed-hash requirement for look-up secrets.

**NIST SP 800-132** covers deriving "master keys from passwords or passphrases"
([NIST 800-132](https://csrc.nist.gov/pubs/sp/800/132/final)). It's for human-chosen secrets, not random keys.
**SP 800-107 Rev. 1** (hash applications incl. HMAC) is slated for withdrawal; its tables moved to the hash
functions project page ([NIST 800-107r1](https://csrc.nist.gov/pubs/sp/800/107/r1/final)), which lists SHA-256 as
128-bit collision, 256-bit preimage strength ([NIST](https://csrc.nist.gov/projects/hash-functions#security-strengths)).

**OWASP Password Storage:** "Fast hashing algorithms such as SHA-256 are not suitable for password storage because
they allow attackers to perform large numbers of guesses quickly." On peppers: the pepper acts "as the HMAC key",
"should not be stored along with the generated hash", "should be stored separately from the password database",
and if compromised "will have to be changed", forcing resets. The page says nothing about API keys or random
tokens ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)).
**OWASP Secrets Management** doesn't discuss hashing keys for storage at all
([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)).

**Is a fast hash acceptable at ≥128 bits?** Yes. The work factor of a password hash multiplies the cost of
each guess, and that matters only when the guess space is small. With 2^256 candidates, a single SHA-256 per guess
is already infeasible (inference from the NIST strengths above; the 112-bit threshold in 800-63B-4 is the
explicit primary statement).

**Real implementations:**

| System | Construction | Source |
|---|---|---|
| Unkey | `base64(sha256(fullKey))`, no salt; verify = hash and compare | [Unkey security](https://www.unkey.com/docs/security/overview) |
| Langfuse | `sha256(key ‖ hex(sha256(SALT)))` hex, `SALT` from env; unique column, `findByFastHash`. Legacy bcrypt (cost 11) kept only for old keys | [apiKeys.ts](https://github.com/langfuse/langfuse/blob/main/packages/shared/src/server/auth/apiKeys.ts), [schema.prisma](https://github.com/langfuse/langfuse/blob/main/packages/shared/prisma/schema.prisma) |
| GitLab | `Digest::SHA256.base64digest("#{value}#{salt}")`, salt = server secret from `db_key_base` | [crypto_helper.rb](https://github.com/gitlabhq/gitlabhq/blob/master/lib/gitlab/crypto_helper.rb) |
| Supabase | Internal storage **not confirmed**; tells users to log "a SHA256 hash of it instead" of a key | [Supabase API keys](https://supabase.com/docs/guides/api/api-keys) |
| GitHub, Stripe | Internal storage **not confirmed**; both show a key once and can't reveal it again (Stripe, for keys you create) | [Stripe keys](https://docs.stripe.com/keys) |

Langfuse and GitLab use concatenation with a server secret, not HMAC. With SHA-256 and a fixed-length secret
key that's acceptable in practice, but HMAC is the standard keyed construction (inference; OWASP names HMAC).

**Constant-time comparison when looking up by hash.** Paragon IE warns that looking a raw token up in a DB
"leaks timing information due to the way strings are compared in database operations", and fixes it with a
split `selector:validator` token where the validator is stored as SHA-256 and compared with `hash_equals()`
([Paragon IE](https://paragonie.com/blog/2015/04/secure-authentication-php-with-long-term-persistence)). When the
lookup key is the *hash* of the presented key, a timing leak reveals at most bytes of a hash the attacker can't
steer without preimages, so lookup by hash is the accepted fix (inference; Unkey and Langfuse both look up by
hash with no separate constant-time compare). No primary standard states this explicitly: **not confirmed**.
If any code compares a hash in application memory (for example, a cached item), use `crypto.timingSafeEqual`.

## 3. What major services do (format, prefix, checksum, scanning)

- **GitHub:** prefix "starting with a company signifier, `gh`, and the first letter of the token type" (`ghp_`,
  `gho_`, `ghu_`, `ghs_`, `ghr_`). `_` because "An underscore is not a Base64 character," and it keeps double-click
  selection whole. A "32 bit checksum in the last 6 digits" (CRC32, Base62, zero-padded) because "A checksum
  virtually eliminates false positives for secret scanning offline." Prefixes were expected to cut false positives
  to 0.5% ([GitHub blog](https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/)).
  Character set `[A-Za-z0-9_]`, and integrators should "support tokens up to 255 characters"
  ([changelog](https://github.blog/changelog/2021-03-31-authentication-token-format-updates-are-generally-available/)).
- **Stripe:** `pk_test_`/`rk_test_`/`sk_test_` for sandboxes and `pk_live_`/`rk_live_`/`sk_live_` for live, so the
  environment is in the prefix. Restricted keys (`rk_`) are recommended over secret keys. A key you create in live
  mode is shown once: "you can't reveal it later" ([Stripe keys](https://docs.stripe.com/keys)).
- **Supabase:** `sb_publishable_…` / `sb_secret_…`, "short strings, not JWTs"
  ([Supabase](https://supabase.com/docs/guides/api/api-keys)). Checksum and storage **not confirmed**.
- **Langfuse:** `pk-lf-<uuid>` / `sk-lf-<uuid>`. The display form is the first 6 characters + `...` + the last 4
  ([apiKeys.ts](https://github.com/langfuse/langfuse/blob/main/packages/shared/src/server/auth/apiKeys.ts)).
- **AWS:** access key IDs have type prefixes (`AKIA` long-term, `ASIA` temporary)
  ([IAM identifiers](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-unique-ids)).
  SigV4 has the server recompute an HMAC with the secret
  ([SigV4](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html)), so AWS can't hold only a
  one-way hash (inference). How it stores secrets: **not confirmed**. It's not a model for bearer keys.
- **GitHub secret-scanning partner program:** for service providers. You supply a regex per secret type (it
  recommends a unique prefix, high entropy and a 32-bit checksum), a test account, and a public verify endpoint
  that checks GitHub's ECDSA signature. GitHub POSTs matches found in public repos and npm, and recommends treating
  them "as public and compromised"
  ([partner program](https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program)).
  For AInakupo, with about a dozen keys and one owner, enrolment isn't worth it (inference). A local secretlint
  pattern gets most of the benefit (§6).

## 4. Is publishing a key's hash acceptable?

**Reversal or brute force:** SHA-256 preimage strength is 256 bits
([NIST](https://csrc.nist.gov/projects/hash-functions#security-strengths)), and the key has 256 bits of entropy
(32 random bytes), so brute-forcing a published hash needs ~2^256 work. That's infeasible. 800-63B-4's 112-bit
line is the same argument from a standards body.

**Primary sources on publishing hashes:** I found none that address publishing a credential's hash, whether they
endorse it or forbid it: **not confirmed**. OWASP and NIST only cover protecting stored hashes against an
attacker who has the DB, which is the threat publishing makes certain. The analysis therefore rests on the
entropy argument.

**Real risks (each is a spec point, not a reason to avoid the hash):**
1. **Weak test key.** If the test key is typed by hand (`aik_test123…`) or derived from something guessable, the
   public hash *is* reversible by guessing. It must come from `randomBytes(32)` like any other key.
2. **Hash accepted as a credential.** Any route, script or cache that takes a hash as input (for example
   `?keyHash=`, an admin lookup, or a cache keyed by hash that a client can address) turns the public hash into
   the key. The server must always hash the presented bearer value and never accept a hash from a client.
3. **Same key valid in every environment.** Seeding the test hashes into production makes the test key a real
   production row whose only guard is the environment-refusal check. The plaintext lives in GitHub Actions
   secrets and goes to every branch environment's CI, so it's the most exposed key in the system. If the refusal
   has a bug, it writes into production. Publishing the hash doesn't change this risk; seeding into production
   does. Safer: don't seed `test-episode` in production, or have a frozen test prove the production refusal.
4. **Correlation.** A public hash lets anyone recognise that key's hash in a log or cache. That's minor, but
   don't use the hash as a public identifier. Use a separate key id or the display suffix.
5. **Peppered variant:** if an HMAC pepper is used, a committed value is only valid with one pepper, so it
   breaks as soon as environments have different peppers (§5).

**Does committing a hash trip scanners?**
- *secretlint:* `preset-recommend` is all vendor-specific rules (npm, AWS, GCP, GitHub, GitLab, private keys,
  basic auth, Slack, Stripe, OpenAI, Anthropic …), with no generic entropy or hex rule
  ([secretlint README, Built-in Rules](https://github.com/secretlint/secretlint#built-in-rules)). The nearest is AWS
  secret access key, which needs an `aws_secret_access_key`-style name and exactly 40 base64 chars
  ([aws rule source](https://github.com/secretlint/secretlint/blob/master/packages/%40secretlint/core/src/builtin/rules/aws/index.ts)).
  A 64-char hex hash doesn't match (inference from the regexes; not run).
- *GitHub secret scanning:* generic patterns are private keys, connection strings, and HTTP Basic/**Bearer**
  authentication headers. No high-entropy or hash detection; the AI detector covers `password` only
  ([supported patterns](https://docs.github.com/en/code-security/secret-scanning/introduction/supported-secret-scanning-patterns)).
  A hash won't match, but a fixture with a literal `authorization: Bearer <value>` could hit
  `http_bearer_authentication_header` (medium precision) if non-provider patterns are on. Whether they're on by
  default for public repos: **not confirmed**.

**Is it common in OSS seed data?** Not that I could find. Langfuse, the closest analogue, commits **synthetic
plaintext** dev keys (`pk-lf-1234567890` / `sk-lf-1234567890`, "seeded key") and hashes them at seed time. Its own
docs call them "shared and synthetic," so previews are never treated as private
([seed constants](https://github.com/langfuse/langfuse/blob/main/packages/shared/scripts/seeder/utils/postgres-seed-constants.ts),
[previews skill](https://github.com/langfuse/langfuse/blob/main/.agents/skills/langfuse-previews/SKILL.md)). A
short search of GitLab's fixtures found no committed token digests. "Rare" is my reading from that search, not a
survey.

## 5. Alternatives to committing the hash

- **HMAC-SHA-256 with a pepper in SSM** (`/ainakupo/<env>/key-pepper`). A committed value is useless without the
  pepper, and a DB-only leak doesn't reveal valid hashes. Costs: an SSM read at cold start (the Lambda can read
  `/ainakupo/*`), and `keys:add` needs the pepper too. Every environment needs the *same* pepper, or the
  committed test hashes and the minted keys stop matching; the alternative is computing them per environment. A
  pepper rotation invalidates every key, which means re-minting all episodes' keys, as OWASP notes for passwords.
  With 256-bit keys a DB leak already doesn't enable impersonation, so the gain is small (inference).
- **Seed the hash at deploy time from a secret.** CI hashes `secrets.TEST_KEY_*` and seeds it. Nothing public,
  but it's a workflow change, and only the repo owner can commit workflows. It also couples seeding to secrets
  being present, which fork PRs don't get.
- **Seed from SSM.** The owner writes the test-key hashes to `/ainakupo/<env>/…` once and the seed step reads
  them. No workflow secret plumbing, but it's one more owner-run step per environment, and branch environments
  need a shared path.
- **Commit the SHA-256 hash (draft).** No workflow change, no pepper, and the same value works everywhere. Safe
  given §4's entropy argument, as long as risks 1–3 are pinned in the spec.

---

## 6. Recommendation for AInakupo

**Hash algorithm.** Plain SHA-256, no pepper:
`keyHash = lowercase_hex(SHA-256(UTF-8(fullKey)))`, where `fullKey` is the whole presented string including the
`aik_` prefix (as Unkey hashes the full key). That's 64 hex chars, stored as the key item's lookup attribute
(DynamoDB `GetItem` by `keyHash`). Check the format with a regex *before* hashing, and reject anything that doesn't
match with the same 401 as an unknown key, without a DB read. The rate-limit counter is keyed by `keyHash` (or a
key id), never by plaintext. Never log the key, and log the display suffix rather than the hash. No
bcrypt/argon2: no benefit at 256 bits, and real cost on the hot path. Optionally add HMAC later. Changing the
construction means re-minting, so decide now. The recommendation is no.

**Commit the test-key hashes: yes**, in `seed-data.ts` and the spec, because:
- 256-bit random input makes the SHA-256 irreversible (NIST preimage strength 256; 800-63B-4 needs only an
  approved hash at ≥112 bits);
- neither secretlint's recommended preset nor GitHub secret scanning flags a hex hash;
- it needs no workflow change (only the owner can commit those) and no pepper plumbing.
It's uncommon, so the spec should state why it's safe and pin these conditions:
1. Test keys are generated from 32 CSPRNG bytes, like real keys, never typed by hand.
2. The server only ever hashes a presented bearer value. No route, script or cache accepts a hash as a credential.
3. Production refuses `test-episode` keys. Better: don't seed `test-episode` into production at all. If it is
   seeded, a frozen test must prove production rejects a valid test key (an exact status and error code).
4. If either test key's plaintext leaks (CI log, secret exposure), rotate it: new secret, new committed hash.

**Key format.** `aik_` + 43 base64url chars (`randomBytes(32).toString("base64url")`, no padding), 47 chars total,
regex `^aik_[A-Za-z0-9_-]{43}$`. Keys are never printed or typed (ADR 0003), so base62's double-click advantage
doesn't matter. No checksum: its value is offline verification for GitHub's partner program, which AInakupo won't
join. Optional, the spec author's call: put the environment in the prefix the way Stripe does (`aik_live_` /
`aik_prev_`) so a preview key misplaced in a production app is visible in SSM. The server must still take the
environment from the DB row, never from the prefix.

**Display suffix.** Store `aik_…` + the last 4 characters (24 bits of 256) at mint time. Show it in the dashboard,
`keys:add` output and logs. Langfuse shows the first 6 + last 4; with a fixed `aik_` prefix only the suffix
carries information.

**Scanning.** Add an `aik_` pattern to `.secretlintrc.json`'s existing `secretlint-rule-pattern` entry, for
example `/\baik_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/`, so a committed plaintext key fails pre-commit and CI. Frozen
tests that need a well-formed but unknown key should build it at runtime (for example
`"aik_" + "A".repeat(43)`) rather than writing it as a literal. Test files should read real test keys from env,
never write `Bearer <literal>`.

**What the spec should state:** the key regex. The exact hash construction above, with one public test vector
(a made-up key that is seeded nowhere, plus its SHA-256) so frozen tests can check the hashing. That only hashes
are stored, plus the 4-char display suffix. That the test-episode hashes are committed, and why that's safe
(conditions 1–4). That malformed and unknown keys get the same response. That the rate limit is keyed per key
hash. And how production treats `test-episode` keys, as a testable status and code.
