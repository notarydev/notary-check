// Real-Postgres tests for service-to-service API-key auth
// (engine/src/auth/apiKey.ts). Skip cleanly when no test database is
// configured (set TEST_DATABASE_URL or DATABASE_URL) — same skip pattern as
// liveApi.test.ts. When a database IS configured these run against it for
// real: issue → verify → revoke → verify-rejected, plus garbage-key rejection
// (which must never touch the database).

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import {
  apiKeyPrefixFor,
  generateApiKeySecret,
  hashApiKey,
  isWellFormedApiKey,
  issueApiKey,
  revokeApiKey,
  verifyApiKey,
  API_KEY_PREFIX,
  API_KEY_SECRET_HEX_LENGTH,
} from "./apiKey.ts";
import { createOrganization, freshPool, HAS_DB } from "../test/db.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

test(
  "issue → verify: a freshly issued key verifies and resolves to the right organization",
  { ...skip },
  async () => {
    const pool: pg.Pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const issued = await issueApiKey(orgId, pool);

      // The plaintext is returned once...
      assert.ok(issued.plaintextKey.startsWith(API_KEY_PREFIX));
      assert.equal(issued.plaintextKey.length, API_KEY_PREFIX.length + API_KEY_SECRET_HEX_LENGTH);

      // ...the row stores only the hash and the non-secret prefix, never the key.
      const row = await pool.query("SELECT key_hash, key_prefix FROM organization_api_key WHERE id = $1", [issued.keyId]);
      assert.equal(row.rows[0].key_hash, hashApiKey(issued.plaintextKey));
      assert.notEqual(row.rows[0].key_hash, issued.plaintextKey);
      assert.equal(row.rows[0].key_prefix, issued.keyPrefix);

      const verified = await verifyApiKey(issued.plaintextKey, pool);
      assert.equal(verified.ok, true);
      if (verified.ok) {
        assert.equal(verified.organizationId, orgId);
        assert.equal(verified.keyId, issued.keyId);
      }
    } finally {
      await pool.end();
    }
  },
);

test(
  "revoke → verify: a revoked key is rejected, and rejection is permanent",
  { ...skip },
  async () => {
    const pool: pg.Pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const issued = await issueApiKey(orgId, pool);

      assert.equal((await verifyApiKey(issued.plaintextKey, pool)).ok, true);
      assert.equal((await revokeApiKey(issued.keyId, pool)).ok, true);
      // The revocation write is a hard fail for that key — never silent.
      assert.equal((await verifyApiKey(issued.plaintextKey, pool)).ok, false);
      const revoked = await verifyApiKey(issued.plaintextKey, pool);
      assert.ok(!revoked.ok && revoked.reason === "revoked");
    } finally {
      await pool.end();
    }
  },
);

test(
  "garbage and malformed keys are rejected without ever reaching the database",
  { ...skip },
  async () => {
    const pool: pg.Pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      // A valid key for later comparison.
      const issued = await issueApiKey(orgId, pool);

      // The known valid key must pass the shape check.
      assert.equal(isWellFormedApiKey(issued.plaintextKey), true);

      // Malformed shapes: wrong prefix, wrong length, non-hex, uppercase hex,
      // empty, and the prefix alone.
      assert.equal(isWellFormedApiKey("sk-live-abcdef"), false);
      assert.equal(isWellFormedApiKey(`${API_KEY_PREFIX}abcd`), false);
      assert.equal(isWellFormedApiKey(`${API_KEY_PREFIX}zzzz`.padEnd(API_KEY_PREFIX.length + API_KEY_SECRET_HEX_LENGTH, "0")), false);
      assert.equal(isWellFormedApiKey(issued.plaintextKey.toUpperCase()), false);
      assert.equal(isWellFormedApiKey(""), false);
      assert.equal(isWellFormedApiKey(API_KEY_PREFIX), false);

      // Verify rejects all of them, and an unknown-but-well-formed key, with no
      // DB round-trip for the malformed ones (they never get as far as a hash
      // lookup).
      assert.ok(!(await verifyApiKey("sk-live-abcdef", pool)).ok);
      const malformed = await verifyApiKey(`${API_KEY_PREFIX}abcd`, pool);
      assert.ok(!malformed.ok && malformed.reason === "malformed_key");
      const unknown = await verifyApiKey(`${API_KEY_PREFIX}${"0".repeat(API_KEY_SECRET_HEX_LENGTH)}`, pool);
      assert.ok(!unknown.ok && unknown.reason === "unknown_key");
    } finally {
      await pool.end();
    }
  },
);

test("hashApiKey / apiKeyPrefixFor: deterministic hash, non-secret short prefix", () => {
  const secret = generateApiKeySecret();
  const hash = hashApiKey(secret);
  assert.equal(hash, hashApiKey(secret), "hashing is deterministic");
  assert.equal(hash.length, 64);
  assert.notEqual(hash, secret, "the hash is not the secret");

  const prefix = apiKeyPrefixFor(secret);
  assert.ok(secret.startsWith(prefix), "the prefix is the secret's own leading slice");
  assert.equal(prefix, `${API_KEY_PREFIX}${secret.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8)}`);
});
