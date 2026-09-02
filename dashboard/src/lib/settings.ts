// Server-only helpers for the /dashboard/settings pages: organization plan
// summary and API-key management. Kept separate from lib/engine.ts (owned by
// a parallel agent) to avoid concurrent edits to that file.
//
// Same style as lib/engine.ts: private engineUrl() getter, cache: "no-store",
// throw with the response body on !res.ok.

import "server-only";

function engineUrl(): string {
  const url = process.env.ENGINE_URL;
  if (!url) throw new Error("ENGINE_URL is not configured");
  return url;
}

export interface OrganizationSummary {
  planId: string;
  planName: string;
  checksPerMonth: number | null;
  priceCents: number | null;
  hasPaymentMethod: boolean;
  createdAt: string | null;
}

/**
 * Reads the authenticated organization's plan summary:
 *   GET {ENGINE_URL}/v1/organization
 *   headers: { Authorization: "Bearer <organization api key>" }
 *   -> { plan_id, plan_name, checks_per_month, price_cents, has_payment_method, created_at }
 *
 * See engine/src/routes/organization.ts.
 */
export async function getOrganization(apiKey: string): Promise<OrganizationSummary> {
  const res = await fetch(`${engineUrl()}/v1/organization`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`get organization failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    plan_id: string;
    plan_name: string;
    checks_per_month: number | null;
    price_cents: number | null;
    has_payment_method: boolean;
    created_at: string | null;
  };

  return {
    planId: data.plan_id,
    planName: data.plan_name,
    checksPerMonth: data.checks_per_month,
    priceCents: data.price_cents,
    hasPaymentMethod: data.has_payment_method,
    createdAt: data.created_at,
  };
}

export interface ApiKeySummary {
  id: string;
  keyPrefix: string;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * Lists the organization's API keys (never the key_hash or plaintext):
 *   GET {ENGINE_URL}/v1/api-keys
 *   headers: { Authorization: "Bearer <organization api key>" }
 *   -> { api_keys: [{ id, key_prefix, created_at, revoked_at }] }
 *
 * See engine/src/routes/apiKeys.ts / auth/apiKey.ts's ApiKeySummary.
 */
export async function listApiKeys(apiKey: string): Promise<ApiKeySummary[]> {
  const res = await fetch(`${engineUrl()}/v1/api-keys`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`list api keys failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    api_keys: { id: string; key_prefix: string; created_at: string; revoked_at: string | null }[];
  };

  return data.api_keys.map((k) => ({
    id: k.id,
    keyPrefix: k.key_prefix,
    createdAt: k.created_at,
    revokedAt: k.revoked_at,
  }));
}

export interface IssuedApiKey {
  id: string;
  /** The plaintext key. Returned exactly once by the engine; never persisted. */
  plaintextKey: string;
  keyPrefix: string;
}

/**
 * Issues a new API key for the organization:
 *   POST {ENGINE_URL}/v1/api-keys
 *   headers: { Authorization: "Bearer <organization api key>" }
 *   -> { id, key, key_prefix }
 *
 * `key` is the plaintext, returned exactly once — the caller must show it to
 * the user immediately and must never persist or re-display it afterward.
 */
export async function issueApiKey(apiKey: string): Promise<IssuedApiKey> {
  const res = await fetch(`${engineUrl()}/v1/api-keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`issue api key failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { id: string; key: string; key_prefix: string };
  return { id: data.id, plaintextKey: data.key, keyPrefix: data.key_prefix };
}

/**
 * Revokes one of the organization's API keys. Idempotent on double-revoke;
 * the engine 404s if the key doesn't exist or belongs to a different org:
 *   DELETE {ENGINE_URL}/v1/api-keys/:id
 *   headers: { Authorization: "Bearer <organization api key>" }
 *   -> { id, revoked: true }
 */
export async function revokeApiKey(apiKey: string, keyId: string): Promise<void> {
  const res = await fetch(`${engineUrl()}/v1/api-keys/${keyId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`revoke api key failed: ${res.status} ${body}`);
  }
}
