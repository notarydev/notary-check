import { createHash } from "node:crypto";
import { Router } from "express";
import type pg from "pg";
import { z } from "zod";

const ORGANIZATION_ID_HEADER = "x-notary-organization-id";

// Build-order step 1 stub for organization identity: the org is taken from a
// required header and cross-checked against the review's real organization.
// This is NOT auth — real authentication (§ Phase 1 build order step 5) will
// replace the header with a verified organization-scoped identity later.
const registerEvidenceSchema = z
  .object({
    review_id: z.string().uuid(),
    origin: z.enum(["answer_citation", "user_added", "workspace_collection"]),
    submitted_url: z.string().url().optional(),
    payload_ref: z.string().optional(),
    payload: z.string().optional(),
    submitted_by: z.string().optional(),
    snapshot_reuse_policy: z.string().optional(),
    retention_until: z.string().datetime().optional(),
  })
  .refine((b) => b.submitted_url !== undefined || b.payload_ref !== undefined || b.payload !== undefined, {
    message: "one of submitted_url, payload_ref, or payload is required",
  });

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function evidenceRouter(database: pg.Pool): Router {
  const router = Router();

  // Registers a new source into the evidence manifest by creating an Evidence
  // row. Nothing is fetched or parsed here — safe fetching is a later
  // build-order step. Records are append-only: a later fetch of the same URL
  // produces a NEW Evidence row, never an update to an existing one.
  router.post("/v1/evidence", async (req, res) => {
    const orgId = req.header(ORGANIZATION_ID_HEADER);
    if (!orgId || !uuidPattern.test(orgId)) {
      return res.status(401).json({ error: `missing or invalid ${ORGANIZATION_ID_HEADER} header` });
    }

    const parsed = registerEvidenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    }

    const { review_id, origin, submitted_url, payload_ref, payload, submitted_by, snapshot_reuse_policy, retention_until } = parsed.data;

    // Organization scoping: never trust a client-supplied organization id
    // alone. The review itself must belong to the organization from the
    // header — if it does not, the source is not bound.
    const review = await database.query("SELECT id FROM review WHERE id = $1 AND organization_id = $2", [review_id, orgId]);
    if (review.rowCount === 0) {
      return res.status(404).json({ error: "review not found for this organization" });
    }

    let payloadHash: string | null = null;
    let retrievalStatus = "pending";
    let retrievedAt: string | null = null;
    if (payload !== undefined) {
      payloadHash = createHash("sha256").update(payload, "utf8").digest("hex");
      retrievalStatus = "retrieved";
      retrievedAt = new Date().toISOString();
    }

    // canonical_url and locator_scheme are left null: assigning an immutable
    // canonical locator is the later source-resolution step's job, not this
    // registration endpoint's.
    const result = await database.query(
      `INSERT INTO evidence (
         review_id, origin, submitted_url, canonical_url, payload_ref, payload_hash,
         retrieval_status, retrieved_at, locator_scheme, retention_until,
         submitted_by, snapshot_reuse_policy, access_revoked_at
       )
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, NULL, $8, $9, $10, NULL)
       RETURNING *`,
      [
        review_id,
        origin,
        submitted_url ?? null,
        payload_ref ?? null,
        payloadHash,
        retrievalStatus,
        retrievedAt,
        retention_until ?? null,
        submitted_by ?? null,
        snapshot_reuse_policy ?? null,
      ],
    );

    return res.status(201).json({ evidence: result.rows[0] });
  });

  return router;
}
