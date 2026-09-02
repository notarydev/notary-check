// Resolves an authenticated Clerk user to their own Notary engine
// organization + API key, via the engine's internal resolve-organization
// endpoint (built in parallel — see server/src/server.ts's Clerk wiring for
// the caller side). Replaces the single shared ENGINE_API_KEY used before
// real per-user auth existed.
//
// Cache is process-lifetime, in-memory, module-level: simple and sufficient
// for now. A process restart just re-resolves on next use — no persistence
// needed because the engine is the source of truth for the mapping.

// Read lazily, not as a module-level const, for the same reason
// engineClient.ts's engineUrl()/engineApiKey() do: ES module imports are
// hoisted and evaluated before server.ts's process.loadEnvFile() call runs,
// so capturing process.env at import time would bake in pre-.env-load
// (undefined) values.
function engineUrl(): string {
  return process.env.ENGINE_URL ?? "http://localhost:4001";
}
function internalServiceSecret(): string {
  return process.env.INTERNAL_SERVICE_SECRET ?? "";
}

interface ResolveOrganizationResponse {
  organization_id: string;
  api_key: string;
  created: boolean;
}

// clerk_user_id -> api_key
const apiKeyCache = new Map<string, string>();

/**
 * Injectable so the caching behavior (the one part of this module with zero
 * Clerk dependency) can be unit tested without a live engine or Clerk.
 */
export async function resolveApiKeyForUser(
  clerkUserId: string,
  email: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const cached = apiKeyCache.get(clerkUserId);
  if (cached !== undefined) return cached;

  const res = await fetchImpl(`${engineUrl()}/v1/internal/resolve-organization`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Internal-Secret": internalServiceSecret(),
    },
    body: JSON.stringify(
      email === undefined ? { clerk_user_id: clerkUserId } : { clerk_user_id: clerkUserId, email },
    ),
  });
  if (!res.ok) {
    throw new Error(`resolve-organization failed for user ${clerkUserId}: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as ResolveOrganizationResponse;
  apiKeyCache.set(clerkUserId, body.api_key);
  return body.api_key;
}

/** Test-only escape hatch to reset cache state between test cases. */
export function __clearApiKeyCacheForTests(): void {
  apiKeyCache.clear();
}
