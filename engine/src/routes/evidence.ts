import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { verifyApiKey } from "../auth/apiKey.ts";
import { logEvent } from "../observability/log.ts";

// The registerEvidenceSchema body — build-order step 1.
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

const BEARER_PREFIX = "Bearer ";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

const listEvidenceQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  cursor: z.string().optional(),
});

interface EvidenceCursor {
  createdAt: string;
  id: string;
}

/** Encodes a (created_at, id) keyset cursor as opaque base64. Same scheme as reviews.ts. */
function encodeEvidenceCursor(cursor: EvidenceCursor): string {
  return Buffer.from(`${cursor.createdAt},${cursor.id}`, "utf8").toString("base64");
}

/** Decodes and shape-checks a client-supplied cursor. Returns null if malformed. */
function decodeEvidenceCursor(raw: string): EvidenceCursor | null {
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

export function evidenceRouter(database: pg.Pool): Router {
  const router = Router();

  // GET /v1/evidence — org-scoped evidence library, keyset-paginated on
  // (created_at DESC, id DESC) over the new evidence.created_at column
  // (migration 0008). Org scoping goes through `review` since evidence has no
  // organization_id column of its own. Deliberately EXCLUDES resolved_text —
  // a list response should not ship large/sensitive payload text; fetch a
  // single evidence row's full detail through the review-detail endpoint
  // (GET /v1/reviews/:id) instead.
  router.get("/v1/evidence", async (req, res) => {
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

    const parsedQuery = listEvidenceQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: "invalid query parameters", details: parsedQuery.error.flatten() });
    }
    const { limit, cursor } = parsedQuery.data;

    let afterCreatedAt: string | null = null;
    let afterId: string | null = null;
    if (cursor !== undefined) {
      const decoded = decodeEvidenceCursor(cursor);
      if (decoded === null) {
        return res.status(400).json({ error: "invalid cursor" });
      }
      afterCreatedAt = decoded.createdAt;
      afterId = decoded.id;
    }

    const result = await database.query(
      `SELECT
         evidence.id, evidence.review_id, evidence.origin, evidence.submitted_url, evidence.canonical_url,
         evidence.retrieval_status, evidence.retrieved_at, evidence.retention_until,
         evidence.access_revoked_at, evidence.created_at
       FROM evidence
       JOIN review ON evidence.review_id = review.id
       WHERE review.organization_id = $1
         AND (
           $3::timestamptz IS NULL
           OR (evidence.created_at, evidence.id) < ($3::timestamptz, $4::uuid)
         )
       ORDER BY evidence.created_at DESC, evidence.id DESC
       LIMIT $2`,
      [orgId, limit, afterCreatedAt, afterId],
    );

    const rows = result.rows as Array<{
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
    }>;

    const last = rows[rows.length - 1];
    // See the identical comment in reviews.ts's GET /v1/reviews handler:
    // node-pg returns timestamptz columns as JS Date objects, and a bare
    // template-literal interpolation would call the Date's locale-formatted
    // toString() instead of toISOString(), producing an invalid timestamptz
    // literal that 500s the next page. toISOString() is required here.
    const nextCursor =
      rows.length === limit && last
        ? encodeEvidenceCursor({ createdAt: new Date(last.created_at).toISOString(), id: last.id })
        : null;

    return res.status(200).json({ evidence: rows, next_cursor: nextCursor });
  });

  // Registers a new source into the evidence manifest by creating an Evidence
  // row. Nothing is fetched or parsed here — safe fetching is a later
  // build-order step. Records are append-only: a later fetch of the same URL
  // produces a NEW Evidence row, never an update to an existing one.
  //
  // Auth (build-order step 5): identity comes from `Authorization: Bearer
  // <api-key>`, verified against the organization_api_key table. The
  // organization is DERIVED from the key, never from a client-supplied header.
  router.post("/v1/evidence", async (req, res) => {
    const startedAt = performance.now();
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

    const parsed = registerEvidenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    }

    const { review_id, origin, submitted_url, payload_ref, payload, submitted_by, snapshot_reuse_policy, retention_until } = parsed.data;

    // Organization scoping: never trust a client-supplied organization id
    // alone. The review itself must belong to the organization the key resolved
    // to — if it does not, the source is not bound.
    const review = await database.query("SELECT id FROM review WHERE id = $1 AND organization_id = $2", [review_id, orgId]);
    if (review.rowCount === 0) {
      return res.status(404).json({ error: "review not found for this organization" });
    }

    let payloadHash: string | null = null;
    let retrievalStatus = "pending";
    let retrievedAt: string | null = null;
    // The inline payload is already in memory and its hash is already computed
    // below — also persist the text itself into resolved_text, so the review
    // orchestrator has something to read without re-fetching or re-hashing
    // (migration 0005 documents this column as the narrow stand-in for the
    // future object-store payload store).
    let resolvedText: string | null = null;
    // Inline-excerpt provenance (migration 0010). A caller-supplied excerpt is
    // legitimate evidence — often the ONLY checkable text there is — but this
    // system did not fetch it and has proved nothing about where it came from.
    // The MCP layer sends `payload` (the pasted excerpt) and `submitted_url`
    // TOGETHER on one registration, and this route marks the row 'retrieved'
    // from the payload alone without ever fetching that URL. Recording
    // provenance as 'caller_supplied' — even when a URL is present — is what
    // stops a downstream locator from presenting the excerpt as if the system
    // had proved it appears at that URL. (The inverse bug, dropping the
    // excerpt in favour of an unresolved URL, is in HANDOFF.md; neither
    // direction is acceptable.)
    //
    // E-EVIDENCE (2026-09-05, migration 0020): a 19–224 character excerpt is
    // too thin to establish entity/period/metric and produced live false
    // negatives (review 900530a5) and INDETERMINATE floods. So when a row
    // carries BOTH a caller excerpt AND a URL, it is now registered `pending`
    // — resolution at review time will FETCH the cited page and verify against
    // it, keeping the excerpt as `caller_excerpt` for provenance and as the
    // fallback when the fetch is unreachable or unparseable. Registration
    // stays fetch-free (resolveEvidence.ts documents why); only the status
    // and the extra column changed.
    let contentKind: string | null = null;
    let textProvenance: string | null = null;
    let canonicalTextHash: string | null = null;
    let parseStatus = "not_attempted";
    let callerExcerpt: string | null = null;
    if (payload !== undefined) {
      payloadHash = createHash("sha256").update(payload, "utf8").digest("hex");
      resolvedText = payload;
      retrievedAt = new Date().toISOString();
      contentKind = "inline_excerpt";
      textProvenance = "caller_supplied";
      canonicalTextHash = payloadHash; // sha256 of the exact text retained
      parseStatus = "parsed"; // the text IS the canonical text; nothing to parse
      if (submitted_url !== undefined) {
        // Both present: keep the excerpt, but let review-time resolution try
        // the page first (E-EVIDENCE). The excerpt remains the fallback and
        // the provenance record.
        callerExcerpt = payload;
        retrievalStatus = "pending";
      } else {
        // Excerpt alone (no URL): nothing to fetch; it is 'retrieved' as-is.
        retrievalStatus = "retrieved";
      }
    }

    // canonical_url and locator_scheme are left null: assigning an immutable
    // canonical locator is the later source-resolution step's job, not this
    // registration endpoint's.
    const result = await database.query(
      `INSERT INTO evidence (
         review_id, origin, submitted_url, canonical_url, payload_ref, payload_hash,
         retrieval_status, retrieved_at, locator_scheme, retention_until,
         submitted_by, snapshot_reuse_policy, access_revoked_at, resolved_text,
         content_kind, text_provenance, canonical_text_hash, parse_status,
         caller_excerpt
       )
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, NULL, $8, $9, $10, NULL, $11, $12, $13, $14, $15, $16)
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
        resolvedText,
        contentKind,
        textProvenance,
        canonicalTextHash,
        parseStatus,
        callerExcerpt,
      ],
    );

    // Observability (§ Monitoring): latency + org identity per registration.
    // No payload, key, or hash is ever logged — only metadata.
    logEvent({
      event: "evidence_registered",
      path: "deterministic-only",
      latency_ms: Math.round(performance.now() - startedAt),
      organization_id: orgId,
    });

    return res.status(201).json({ evidence: result.rows[0] });
  });

  return router;
}
