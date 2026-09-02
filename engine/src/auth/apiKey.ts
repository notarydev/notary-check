// Service-to-service authentication for the engine's HTTP API (§ Phase 1 build
// order step 5). Replaces step 1's `x-notary-organization-id` header stub:
// a presented `Authorization: Bearer <key>` is hashed and looked up against the
// organization_api_key table; the organization is derived from the key, never
// from a client-supplied header.
//
// Security model:
//   - The key is NEVER stored in plaintext. Only the SHA-256 hex digest is
//     persisted (see the comment in migrations/0004_auth_usage.sql). The
//     plaintext is returned EXACTLY ONCE by issueApiKey and is otherwise
//     unrecoverable — if a caller loses it, the key must be rotated.
//   - key_prefix (e.g. "nk_live_a1b2c3d4") is the non-secret, loggable
//     identifier for a key. Logs carry the prefix, never the secret.
//   - A revoked key fails verification immediately and permanently — a
//     revocation write is a hard fail for that key, never a silent pass.
//   - Malformed keys (wrong shape) are rejected WITHOUT a database round-trip,
//     so a garbage header costs nothing and cannot probe the table.

import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

export const API_KEY_PREFIX = "nk_live_";
/** The random, high-entropy tail of a key, as lowercase hex. */
export const API_KEY_SECRET_HEX_LENGTH = 64; // 32 bytes → 64 hex chars
/** How many hex chars of the secret tail go into the loggable prefix. */
export const API_KEY_PREFIX_TAIL_LENGTH = 8;

const SECRET_TAIL_PATTERN = new RegExp(`^[0-9a-f]{${API_KEY_SECRET_HEX_LENGTH}}$`);
const KEY_PATTERN = new RegExp(`^${API_KEY_PREFIX}[0-9a-f]{${API_KEY_SECRET_HEX_LENGTH}}$`);

/** SHA-256 hex digest of a full key — the only thing ever stored. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Generates a fresh key secret: `nk_live_` + 32 random bytes as hex. */
export function generateApiKeySecret(): string {
  return `${API_KEY_PREFIX}${randomBytes(API_KEY_SECRET_HEX_LENGTH / 2).toString("hex")}`;
}

/** The non-secret prefix stored on the row and safe for logs. */
export function apiKeyPrefixFor(secret: string): string {
  const tail = secret.slice(API_KEY_PREFIX.length);
  return `${API_KEY_PREFIX}${tail.slice(0, API_KEY_PREFIX_TAIL_LENGTH)}`;
}

/**
 * Shape check for a presented key. Rejects anything that cannot be a real key
 * before any database work — a malformed header is not a credential attempt
 * worth a lookup.
 */
export function isWellFormedApiKey(presentedKey: string): boolean {
  return KEY_PATTERN.test(presentedKey);
}

export interface IssuedApiKey {
  /** The plaintext key. Returned exactly once; not stored, not logged. */
  plaintextKey: string;
  /** The non-secret prefix, safe to log. */
  keyPrefix: string;
  keyId: string;
}

/** Issues a new key for an organization. The plaintext is returned once. */
export async function issueApiKey(organizationId: string, db: pg.Pool): Promise<IssuedApiKey> {
  const plaintextKey = generateApiKeySecret();
  const keyHash = hashApiKey(plaintextKey);
  const keyPrefix = apiKeyPrefixFor(plaintextKey);
  const result = await db.query(
    `INSERT INTO organization_api_key (organization_id, key_hash, key_prefix)
     VALUES ($1, $2, $3)
     RETURNING id, key_prefix`,
    [organizationId, keyHash, keyPrefix],
  );
  return {
    plaintextKey,
    keyPrefix: result.rows[0].key_prefix,
    keyId: result.rows[0].id,
  };
}

export type ApiKeyVerifyResult =
  | { ok: true; organizationId: string; keyId: string }
  | { ok: false; reason: "malformed_key" | "unknown_key" | "revoked" };

/**
 * Verifies a presented key. Hash → lookup → reject if revoked. Never returns a
 * key id or organization id on failure.
 */
export async function verifyApiKey(presentedKey: string, db: pg.Pool): Promise<ApiKeyVerifyResult> {
  if (!isWellFormedApiKey(presentedKey)) {
    return { ok: false, reason: "malformed_key" };
  }
  const keyHash = hashApiKey(presentedKey);
  const result = await db.query(
    `SELECT id, organization_id, revoked_at
     FROM organization_api_key
     WHERE key_hash = $1`,
    [keyHash],
  );
  if (!result.rowCount) {
    return { ok: false, reason: "unknown_key" };
  }
  const row = result.rows[0] as { id: string; organization_id: string; revoked_at: string | null };
  if (row.revoked_at !== null) {
    return { ok: false, reason: "revoked" };
  }
  return { ok: true, organizationId: row.organization_id, keyId: row.id };
}

export interface ApiKeySummary {
  id: string;
  key_prefix: string;
  created_at: string;
  revoked_at: string | null;
}

/**
 * Lists an organization's API keys for dashboard display. Never returns
 * key_hash — only the non-secret prefix, matching the "logs/UI carry the
 * prefix, never the secret" discipline documented above.
 */
export async function listApiKeys(organizationId: string, db: pg.Pool): Promise<ApiKeySummary[]> {
  const result = await db.query(
    `SELECT id, key_prefix, created_at, revoked_at
     FROM organization_api_key
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId],
  );
  return result.rows as ApiKeySummary[];
}

/** Revokes a key by id. A revoked key stops working on the next verification. */
export async function revokeApiKey(keyId: string, db: pg.Pool): Promise<{ ok: boolean }> {
  const result = await db.query(
    `UPDATE organization_api_key
     SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [keyId],
  );
  return { ok: result.rowCount !== null && result.rowCount !== undefined && result.rowCount > 0 };
}
