// Server-only helpers for talking to the Notary engine API.
//
// Never imported from a Client Component — `import "server-only"` makes that
// a build error, because ENGINE_URL and INTERNAL_SERVICE_SECRET must never
// reach the browser bundle.

import "server-only";

function engineUrl(): string {
  const url = process.env.ENGINE_URL;
  if (!url) throw new Error("ENGINE_URL is not configured");
  return url;
}

function internalSecret(): string {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) throw new Error("INTERNAL_SERVICE_SECRET is not configured");
  return secret;
}

export interface ResolvedOrganization {
  organizationId: string;
  apiKey: string;
  created: boolean;
}

/**
 * Resolves the Notary organization that belongs to a Clerk user, via the
 * engine's internal lazy-provisioning endpoint:
 *   POST {ENGINE_URL}/v1/internal/resolve-organization
 *   headers: { "X-Internal-Secret": <shared secret> }
 *   body: { clerk_user_id: string, email?: string }
 *   -> { organization_id: string, api_key: string, created: boolean }
 *
 * The first call for a given Clerk user creates the organization if none
 * exists yet.
 */
export async function resolveOrganization(clerkUserId: string, email?: string): Promise<ResolvedOrganization> {
  const res = await fetch(`${engineUrl()}/v1/internal/resolve-organization`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": internalSecret(),
    },
    body: JSON.stringify({
      clerk_user_id: clerkUserId,
      ...(email ? { email } : {}),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`resolve-organization failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { organization_id: string; api_key: string; created: boolean };
  return {
    organizationId: data.organization_id,
    apiKey: data.api_key,
    created: data.created,
  };
}

/**
 * Starts a Stripe checkout session for a self-serve tier via the engine's
 * real billing route:
 *   POST {ENGINE_URL}/v1/billing/checkout
 *   headers: { Authorization: "Bearer <organization api key>" }
 *   body: { organization_id: string (uuid), tier: string }
 *   -> { checkout_url: string }
 *
 * Auth is the org's own API key (from resolveOrganization), not the internal
 * secret — the checkout route derives the organization from the key and
 * rejects a body organization_id that doesn't match it.
 */
export async function createCheckoutSession(apiKey: string, organizationId: string, tier: string): Promise<string> {
  const res = await fetch(`${engineUrl()}/v1/billing/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ organization_id: organizationId, tier }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`billing checkout failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { checkout_url: string };
  if (!data.checkout_url) {
    throw new Error("billing checkout response missing checkout_url");
  }
  return data.checkout_url;
}

export interface Review {
  id: string;
  organization_id: string;
  idempotency_key: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
}

export interface ListReviewsResult {
  reviews: Review[];
  next_cursor: string | null;
}

/**
 * Lists the org's review history, keyset-paginated (created_at DESC, id DESC):
 *   GET {ENGINE_URL}/v1/reviews?limit=&cursor=&status=
 *   headers: { Authorization: "Bearer <organization api key>" }
 *   -> { reviews: Review[], next_cursor: string | null }
 *
 * `next_cursor` is an opaque base64 keyset cursor — pass it straight back as
 * `cursor` for the next page. It's null once the last page is reached.
 */
export async function listReviews(
  apiKey: string,
  opts?: { limit?: number; cursor?: string; status?: "processing" | "complete" | "failed" },
): Promise<ListReviewsResult> {
  const params = new URLSearchParams();
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.cursor !== undefined) params.set("cursor", opts.cursor);
  if (opts?.status !== undefined) params.set("status", opts.status);
  const qs = params.toString();

  const res = await fetch(`${engineUrl()}/v1/reviews${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`list reviews failed: ${res.status} ${body}`);
  }

  return (await res.json()) as ListReviewsResult;
}

export interface EvidenceRef {
  id: string;
  origin: string;
  submitted_url: string | null;
  canonical_url: string | null;
  retrieval_status: string;
  retrieved_at: string | null;
}

export interface EvidenceMatch {
  id: string;
  evidence_id: string;
  locator: unknown;
  resolved_text_hash: string | null;
  excerpt_ref: unknown;
  applicability_json: unknown;
  relation: string;
  method: string;
  evaluator_version: string;
  evaluated_at: string;
  evidence: EvidenceRef;
}

export interface Claim {
  id: string;
  review_id: string;
  ordinal: number;
  text: string;
  decontextualized_form: string | null;
  materiality: boolean;
  state: string;
  no_source: boolean;
  state_reason: string | null;
  policy_version: string;
  created_at: string;
  evidence_matches: EvidenceMatch[];
}

export interface ReviewDetail {
  review: Review;
  claims: Claim[];
}

/**
 * Fetches one review plus its claims (ordered by ordinal) plus each claim's
 * evidence matches, joined to their evidence:
 *   GET {ENGINE_URL}/v1/reviews/:id
 *   headers: { Authorization: "Bearer <organization api key>" }
 *   -> { review: Review, claims: Claim[] } | 404 if not found for this org
 *
 * Returns null on a 404 (not found for this org) so callers can trigger
 * next/navigation's notFound(); throws on any other non-2xx status.
 */
export async function getReview(apiKey: string, reviewId: string): Promise<ReviewDetail | null> {
  const res = await fetch(`${engineUrl()}/v1/reviews/${reviewId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`get review failed: ${res.status} ${body}`);
  }

  return (await res.json()) as ReviewDetail;
}

export interface EvidenceListItem {
  id: string;
  review_id: string;
  origin: string;
  submitted_url: string | null;
  canonical_url: string | null;
  retrieval_status: string;
  retrieved_at: string | null;
  retention_until: string | null;
  access_revoked_at: string | null;
  created_at: string;
}

export interface ListEvidenceResult {
  evidence: EvidenceListItem[];
  next_cursor: string | null;
}

/**
 * Lists the org's evidence library, keyset-paginated (created_at DESC, id
 * DESC). Deliberately excludes resolved_text — see engine/src/routes/evidence.ts.
 *   GET {ENGINE_URL}/v1/evidence?limit=&cursor=
 *   headers: { Authorization: "Bearer <organization api key>" }
 *   -> { evidence: EvidenceListItem[], next_cursor: string | null }
 */
export async function listEvidence(apiKey: string, opts?: { limit?: number; cursor?: string }): Promise<ListEvidenceResult> {
  const params = new URLSearchParams();
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.cursor !== undefined) params.set("cursor", opts.cursor);
  const qs = params.toString();

  const res = await fetch(`${engineUrl()}/v1/evidence${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`list evidence failed: ${res.status} ${body}`);
  }

  return (await res.json()) as ListEvidenceResult;
}

export interface Usage {
  plan_id: string;
  checks_used_this_month: number;
  checks_limit: number | null;
  cost_cents_this_month: number;
  org_monthly_limit_cents: number;
}

/**
 * Fetches the org's usage/quota summary for the current calendar month:
 *   GET {ENGINE_URL}/v1/usage
 *   headers: { Authorization: "Bearer <organization api key>" }
 *   -> { plan_id, checks_used_this_month, checks_limit, cost_cents_this_month, org_monthly_limit_cents }
 *
 * `checks_limit` is null for a plan with no fixed allowance (e.g. Enterprise)
 * — never coerced to 0, never inferred as unlimited without checking for null.
 */
export async function getUsage(apiKey: string): Promise<Usage> {
  const res = await fetch(`${engineUrl()}/v1/usage`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`get usage failed: ${res.status} ${body}`);
  }

  return (await res.json()) as Usage;
}

/**
 * Submits an email to the public waitlist, via the engine's unauthenticated
 * capture endpoint:
 *   POST {ENGINE_URL}/v1/waitlist
 *   body: { email: string }
 *
 * Deliberately unauthenticated (there's no org yet) — this is the "soft"
 * half of the signup gate (see NOTARY_SIGNUP_MODE in app/page.tsx); the
 * "hard" half is Clerk's own Restricted sign-up mode, configured outside
 * this codebase. No org/API key is involved here.
 */
export async function submitWaitlist(email: string): Promise<void> {
  const res = await fetch(`${engineUrl()}/v1/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`waitlist submission failed: ${res.status} ${body}`);
  }
}
