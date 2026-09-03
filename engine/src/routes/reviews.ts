// Review + claim routes for the engine's HTTP API. Same auth pattern as
// evidence.ts: identity comes from `Authorization: Bearer <api-key>`, the
// organization is DERIVED from the key, never from a client-supplied field.

import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { verifyApiKey } from "../auth/apiKey.ts";
import { checkEntitlement } from "../auth/entitlement.ts";
import { logEvent } from "../observability/log.ts";
import { runReview } from "../review/reviewFlow.ts";

const BEARER_PREFIX = "Bearer ";

const createReviewSchema = z.object({
  idempotency_key: z.string().min(1),
  host: z.string().optional(),
  scope: z.string().optional(),
});

// Mirrors ClaimFields from ../verification/applicability.ts — every field
// optional, valueUnit structured as { value, unit? }.
const claimFieldsSchema = z.object({
  entity: z.string().optional(),
  period: z.string().optional(),
  metric: z.string().optional(),
  operator: z.enum(["increase", "decrease", "no_change"]).optional(),
  valueUnit: z.object({ value: z.string(), unit: z.string().optional() }).optional(),
  comparatorBaseline: z.string().optional(),
  modality: z.string().optional(),
  scope: z.string().optional(),
});

const createClaimSchema = z.object({
  text: z.string().min(1),
  ordinal: z.number().int(),
  materiality: z.boolean().optional(),
  decontextualized_form: z.string().optional(),
  claim_fields: claimFieldsSchema,
  evidence_ids: z.array(z.string().uuid()).default([]),
  // ADVANCE — the user's own original request/question for this turn,
  // verbatim, when the caller (server/src/engineClient.ts) actually has it.
  // Optional and passed straight through to review/reviewFlow.ts's
  // runReview(): absent or empty means Advance is skipped for this claim
  // entirely (never a guess — see liveGenerate.ts's no_user_request
  // short-circuit), not a validation error.
  user_request: z.string().optional(),
});

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

const listReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  cursor: z.string().optional(),
  status: z.enum(["processing", "complete", "failed"]).optional(),
});

interface ReviewCursor {
  createdAt: string;
  id: string;
}

/** Encodes a (created_at, id) keyset cursor as opaque base64. */
function encodeReviewCursor(cursor: ReviewCursor): string {
  return Buffer.from(`${cursor.createdAt},${cursor.id}`, "utf8").toString("base64");
}

/** Decodes and shape-checks a client-supplied cursor. Returns null if malformed. */
function decodeReviewCursor(raw: string): ReviewCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const commaIndex = decoded.lastIndexOf(",");
    if (commaIndex === -1) return null;
    const createdAt = decoded.slice(0, commaIndex);
    const id = decoded.slice(commaIndex + 1);
    if (Number.isNaN(Date.parse(createdAt))) return null;
    if (!z.string().uuid().safeParse(id).success) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function reviewsRouter(database: pg.Pool): Router {
  const router = Router();

  // POST /v1/reviews — idempotent create. A review row is keyed by
  // (organization_id, idempotency_key); a duplicate key returns the EXISTING
  // review instead of creating a second one (§ Locked test suite case 18).
  router.post("/v1/reviews", async (req, res) => {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      logEvent({ event: "auth_failed", error_cause: "missing_bearer", path: "deterministic-only" });
      return res.status(401).json({ error: "missing Authorization: Bearer <api-key> header" });
    }
    const presentedKey = authHeader.slice(BEARER_PREFIX.length).trim();
    const auth = await verifyApiKey(presentedKey, database);
    if (!auth.ok) {
      logEvent({ event: "auth_failed", error_cause: `api_key_${auth.reason}`, path: "deterministic-only" });
      return res.status(401).json({ error: "invalid or revoked API key" });
    }
    const orgId = auth.organizationId;

    const parsed = createReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    }
    const { idempotency_key } = parsed.data;
    // host/scope are accepted for API stability (the full Review model per
    // § Core data model carries them) but migration 0005 adds no columns for
    // them yet — validated here, intentionally not persisted.

    // Idempotent create, race-safe under the partial unique index from
    // migration 0005: two concurrent requests with the same key must resolve to
    // the SAME row. `ON CONFLICT ... DO UPDATE SET id = review.id` is the
    // standard trick to make RETURNING hand back the existing row (Postgres has
    // no "DO NOTHING ... RETURNING"). `xmax = 0` distinguishes a fresh insert
    // (201) from a conflict-hit update returning the existing row (200).
    const result = await database.query(
      `INSERT INTO review (organization_id, idempotency_key)
       VALUES ($1, $2)
       ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET id = review.id
       RETURNING (xmax = 0) AS inserted, id, organization_id, idempotency_key, status, created_at`,
      [orgId, idempotency_key],
    );
    const row = result.rows[0] as {
      inserted: boolean;
      id: string;
      organization_id: string;
      idempotency_key: string | null;
      status: string;
      created_at: string;
    };

    return res.status(row.inserted ? 201 : 200).json({
      review: {
        id: row.id,
        organization_id: row.organization_id,
        idempotency_key: row.idempotency_key,
        status: row.status,
        created_at: row.created_at,
      },
    });
  });

  // GET /v1/reviews — org-scoped review history, keyset-paginated on
  // (created_at DESC, id DESC). id is the tiebreaker because created_at alone
  // is not unique enough to guarantee a stable order across rows created in
  // the same instant (migration 0008 adds review.created_at's supporting
  // index for exactly this ordering).
  router.get("/v1/reviews", async (req, res) => {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      logEvent({ event: "auth_failed", error_cause: "missing_bearer", path: "deterministic-only" });
      return res.status(401).json({ error: "missing Authorization: Bearer <api-key> header" });
    }
    const presentedKey = authHeader.slice(BEARER_PREFIX.length).trim();
    const auth = await verifyApiKey(presentedKey, database);
    if (!auth.ok) {
      logEvent({ event: "auth_failed", error_cause: `api_key_${auth.reason}`, path: "deterministic-only" });
      return res.status(401).json({ error: "invalid or revoked API key" });
    }
    const orgId = auth.organizationId;

    const parsedQuery = listReviewsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: "invalid query parameters", details: parsedQuery.error.flatten() });
    }
    const { limit, cursor, status } = parsedQuery.data;

    let afterCreatedAt: string | null = null;
    let afterId: string | null = null;
    if (cursor !== undefined) {
      const decoded = decodeReviewCursor(cursor);
      if (decoded === null) {
        return res.status(400).json({ error: "invalid cursor" });
      }
      afterCreatedAt = decoded.createdAt;
      afterId = decoded.id;
    }

    // $4/$5 (the cursor bounds) are compared only when a cursor was supplied —
    // the `$4::timestamptz IS NULL` branch keeps the first page's query plan
    // simple and correct with no cursor at all.
    const result = await database.query(
      `SELECT id, organization_id, idempotency_key, status, created_at, completed_at
       FROM review
       WHERE organization_id = $1
         AND ($2::text IS NULL OR status = $2)
         AND (
           $4::timestamptz IS NULL
           OR (created_at, id) < ($4::timestamptz, $5::uuid)
         )
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [orgId, status ?? null, limit, afterCreatedAt, afterId],
    );

    const rows = result.rows as Array<{
      id: string;
      organization_id: string;
      idempotency_key: string | null;
      status: string;
      created_at: string;
      completed_at: string | null;
    }>;

    const last = rows[rows.length - 1];
    // node-pg returns timestamptz columns as JS Date objects, not strings —
    // despite the `created_at: string` type above (pg does not narrow the
    // type at the type-checker level, only at runtime). Cursor encoding does
    // manual string concatenation, so it MUST call toISOString() explicitly:
    // a bare template-literal interpolation of a Date silently calls its
    // locale-formatted toString() (e.g. "Wed Sep 02 2026 10:59:04
    // GMT-0400 (Eastern Daylight Time)") instead, which is not a valid
    // timestamptz literal and makes the next page's query 500 — caught by
    // actually paginating against a running server, not by typecheck (see
    // HANDOFF.md's account of the review-orchestrator bugs for why "tsc
    // passed" is never sufficient here).
    const nextCursor =
      rows.length === limit && last
        ? encodeReviewCursor({ createdAt: new Date(last.created_at).toISOString(), id: last.id })
        : null;

    return res.status(200).json({
      reviews: rows.map((row) => ({
        id: row.id,
        organization_id: row.organization_id,
        idempotency_key: row.idempotency_key,
        status: row.status,
        created_at: row.created_at,
        completed_at: row.completed_at,
      })),
      next_cursor: nextCursor,
    });
  });

  // GET /v1/reviews/:id — one review plus its claims (ordered by ordinal) plus
  // each claim's evidence_match rows joined to evidence. 404 (not 403) when
  // the review does not belong to the authenticated org — same
  // don't-leak-existence discipline as the claim-creation route above.
  router.get("/v1/reviews/:id", async (req, res) => {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      logEvent({ event: "auth_failed", error_cause: "missing_bearer", path: "deterministic-only" });
      return res.status(401).json({ error: "missing Authorization: Bearer <api-key> header" });
    }
    const presentedKey = authHeader.slice(BEARER_PREFIX.length).trim();
    const auth = await verifyApiKey(presentedKey, database);
    if (!auth.ok) {
      logEvent({ event: "auth_failed", error_cause: `api_key_${auth.reason}`, path: "deterministic-only" });
      return res.status(401).json({ error: "invalid or revoked API key" });
    }
    const orgId = auth.organizationId;

    // Validate the route param shape BEFORE it reaches a query — same
    // malformed-uuid-must-be-400-not-500 discipline as the claims route below
    // (§ HANDOFF.md's account of the review-orchestrator bugs).
    const { id } = req.params;
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({ error: "invalid review id" });
    }

    const reviewResult = await database.query(
      "SELECT id, organization_id, idempotency_key, status, created_at, completed_at FROM review WHERE id = $1 AND organization_id = $2",
      [id, orgId],
    );
    if (!reviewResult.rowCount) {
      return res.status(404).json({ error: "review not found for this organization" });
    }
    const review = reviewResult.rows[0] as {
      id: string;
      organization_id: string;
      idempotency_key: string | null;
      status: string;
      created_at: string;
      completed_at: string | null;
    };

    const claimsResult = await database.query(
      `SELECT id, review_id, ordinal, text, decontextualized_form, materiality, state, no_source, state_reason, policy_version, created_at,
              lifecycle_state, lifecycle_detail
       FROM claim
       WHERE review_id = $1
       ORDER BY ordinal ASC`,
      [id],
    );
    const claims = claimsResult.rows as Array<{
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
      lifecycle_state: string;
      lifecycle_detail: string | null;
    }>;

    const claimIds = claims.map((c) => c.id);
    const matchesResult =
      claimIds.length > 0
        ? await database.query(
            `SELECT
               em.id, em.claim_id, em.evidence_id, em.locator, em.locator_json, em.locator_resolved,
               em.payload_revoked_at, em.resolved_text_hash, em.excerpt_ref,
               em.applicability_json, em.relation, em.method, em.evaluator_version, em.evaluated_at,
               ev.origin, ev.submitted_url, ev.canonical_url, ev.retrieval_status, ev.retrieved_at,
               ev.parse_status, ev.text_provenance, ev.access_revoked_at
             FROM evidence_match em
             JOIN evidence ev ON ev.id = em.evidence_id
             WHERE em.claim_id = ANY($1::uuid[])`,
            [claimIds],
          )
        : { rows: [] as Array<Record<string, unknown>> };

    const matchesByClaimId = new Map<string, Array<Record<string, unknown>>>();
    for (const row of matchesResult.rows as Array<Record<string, unknown>>) {
      const claimId = row.claim_id as string;
      const list = matchesByClaimId.get(claimId) ?? [];
      list.push({
        id: row.id,
        evidence_id: row.evidence_id,
        locator: row.locator,
        // The real, machine-dereferenceable coordinate (migration 0010). The
        // flat `locator` above is a human-readable label only.
        locator_json: row.locator_json,
        locator_resolved: row.locator_resolved,
        // Non-null means this finding's evidence payload was revoked AFTER the
        // finding was made: the result stands as a truthful record of what was
        // assessed, but its locator no longer dereferences to anything.
        payload_revoked_at: row.payload_revoked_at,
        resolved_text_hash: row.resolved_text_hash,
        excerpt_ref: row.excerpt_ref,
        applicability_json: row.applicability_json,
        relation: row.relation,
        method: row.method,
        evaluator_version: row.evaluator_version,
        evaluated_at: row.evaluated_at,
        evidence: {
          id: row.evidence_id,
          origin: row.origin,
          submitted_url: row.submitted_url,
          canonical_url: row.canonical_url,
          retrieval_status: row.retrieval_status,
          retrieved_at: row.retrieved_at,
          // Fetched is not parsed (migration 0010): a source whose bytes
          // arrived but whose content could not be read is not evidence.
          parse_status: row.parse_status,
          text_provenance: row.text_provenance,
          access_revoked_at: row.access_revoked_at,
        },
      });
      matchesByClaimId.set(claimId, list);
    }

    return res.status(200).json({
      review: {
        id: review.id,
        organization_id: review.organization_id,
        idempotency_key: review.idempotency_key,
        status: review.status,
        created_at: review.created_at,
        completed_at: review.completed_at,
      },
      claims: claims.map((c) => ({
        id: c.id,
        review_id: c.review_id,
        ordinal: c.ordinal,
        text: c.text,
        decontextualized_form: c.decontextualized_form,
        materiality: c.materiality,
        state: c.state,
        no_source: c.no_source,
        state_reason: c.state_reason,
        policy_version: c.policy_version,
        created_at: c.created_at,
        lifecycle_state: c.lifecycle_state,
        lifecycle_detail: c.lifecycle_detail,
        evidence_matches: matchesByClaimId.get(c.id) ?? [],
      })),
    });
  });

  // POST /v1/reviews/:reviewId/claims — runs the full review flow for one
  // claim against the review's bound evidence. Explicitly NOT idempotent:
  // claim-level idempotency / recheck_claim is a separate, later flow.
  router.post("/v1/reviews/:reviewId/claims", async (req, res) => {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      logEvent({ event: "auth_failed", error_cause: "missing_bearer", path: "deterministic-only" });
      return res.status(401).json({ error: "missing Authorization: Bearer <api-key> header" });
    }
    const presentedKey = authHeader.slice(BEARER_PREFIX.length).trim();
    const auth = await verifyApiKey(presentedKey, database);
    if (!auth.ok) {
      logEvent({ event: "auth_failed", error_cause: `api_key_${auth.reason}`, path: "deterministic-only" });
      return res.status(401).json({ error: "invalid or revoked API key" });
    }
    const orgId = auth.organizationId;

    // Entitlement gate, checked here rather than at review-creation: this is
    // the route that actually triggers billable model work (runReview below
    // calls the judge). A valid API key proves identity, not that the org is
    // still paying — those are different questions (auth/entitlement.ts).
    const entitlement = await checkEntitlement(orgId, database);
    if (!entitlement.allowed) {
      logEvent({ event: "entitlement_denied", organization_id: orgId, error_cause: entitlement.reason, path: "deterministic-only" });
      return res.status(402).json({ error: "organization is not currently entitled to run reviews", reason: entitlement.reason });
    }

    const parsed = createClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    }

    // Validate the route param shape BEFORE it reaches a query: an
    // unparseable UUID here would otherwise reach Postgres as a raw string
    // and fail with an "invalid input syntax for type uuid" error, which the
    // app's generic error handler turns into an opaque 500 — confirmed by
    // actually requesting a malformed reviewId against a running server. A
    // malformed identifier is a client error (400), not a server failure.
    const { reviewId } = req.params;
    if (!z.string().uuid().safeParse(reviewId).success) {
      return res.status(400).json({ error: "invalid reviewId" });
    }

    // The review must belong to the authenticated org — never trust the
    // reviewId alone (same cross-org pattern as evidence.ts's review lookup).
    const review = await database.query("SELECT id FROM review WHERE id = $1 AND organization_id = $2", [reviewId, orgId]);
    if (!review.rowCount) {
      return res.status(404).json({ error: "review not found for this organization" });
    }

    const { text, ordinal, materiality, decontextualized_form, claim_fields, evidence_ids, user_request } = parsed.data;
    const result = await runReview(
      {
        organizationId: orgId,
        reviewId,
        claimText: text,
        ordinal,
        materiality,
        decontextualizedForm: decontextualized_form,
        claimFields: claim_fields,
        evidenceIds: evidence_ids,
        userRequest: user_request,
      },
      database,
    );

    // The claim's LIFECYCLE travels with its state, at the same level, so a
    // caller cannot read one without the other. `state` says what the evidence
    // showed; `lifecycle_state` says whether we actually got to look. Only
    // lifecycle_state === "completed" licenses reading `state` as a finding
    // about the world — a claim that came back "not_checkable" carries
    // state INDETERMINATE and must never be rendered as clean.
    return res.status(201).json({
      claim: {
        id: result.claimId,
        review_id: reviewId,
        state: result.state,
        state_reason: result.stateReason,
        no_source: result.noSource,
        lifecycle_state: result.lifecycle,
        lifecycle_detail: result.lifecycleDetail,
        checks_completed: result.checksCompleted,
      },
      matches: result.matches,
      rejectedCandidates: result.rejectedCandidates,
      // Per-source fetched/parsed/locator-resolved/usable status, so a caller
      // can say WHICH source could not be inspected rather than only that one
      // could not be.
      evidence_statuses: result.evidenceStatuses,
      // Track 2 / Challenge layer. Was previously omitted entirely from this
      // response — runTrack2Challenge() generated and persisted challenge_item
      // rows correctly, but nothing carried them out over the wire, so the
      // MCP server's card could never render them regardless of the org
      // feature flag. Mapped to the locked wire contract's snake_case keys
      // (server/src/engineClient.ts's parseChallengeItems requires an exact
      // 4-key match — the engine's own camelCase ChallengeItem type is
      // deliberately not reused as the wire shape here).
      challenges: result.challenges.map((c) => ({
        challenge_type: c.challengeType,
        prompt: c.prompt,
        why_it_matters: c.whyItMatters,
        action: c.action,
      })),
      // ADVANCE — structurally SEPARATE from `challenges` above: a different
      // system, a different authority level (a next-move suggestion about the
      // user's broader task, not a question about this claim's finding), and
      // the UI renders the two differently (§ Part 11's icon-vs-pill design,
      // wired in ui/src/App.tsx). Never merged into one array. Empty
      // whenever no user_request was supplied, no legal move existed, the
      // kill switch was active, quota was exhausted, or the call failed.
      advance_suggestions: result.advanceSuggestions.map((s) => ({
        id: s.id,
        short_label: s.short_label,
        move: s.move,
        prompt: s.prompt,
      })),
    });
  });

  return router;
}
