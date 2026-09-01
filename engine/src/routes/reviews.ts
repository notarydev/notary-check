// Review + claim routes for the engine's HTTP API. Same auth pattern as
// evidence.ts: identity comes from `Authorization: Bearer <api-key>`, the
// organization is DERIVED from the key, never from a client-supplied field.

import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { verifyApiKey } from "../auth/apiKey.ts";
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
  measure: z.string().optional(),
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
});

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

    const { text, ordinal, materiality, decontextualized_form, claim_fields, evidence_ids } = parsed.data;
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
      },
      database,
    );

    return res.status(201).json({
      claim: {
        id: result.claimId,
        review_id: reviewId,
        state: result.state,
        state_reason: result.stateReason,
        no_source: result.noSource,
      },
      matches: result.matches,
    });
  });

  return router;
}
