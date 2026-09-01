// Real-Postgres tests for honest evidence-payload deletion
// (engine/src/evidence/deleteEvidence.ts). Skip cleanly without a configured
// test database. Verifies the exact honesty contract: after deletion the row
// still exists (history intact), but payload_ref and payload_hash are null and
// access_revoked_at is set — it can never re-resolve and nobody can pretend the
// evidence remains available.

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import { deleteEvidencePayload } from "./deleteEvidence.ts";
import { createOrganization, createReview, freshPool, HAS_DB } from "../test/db.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

test(
  "deleteEvidencePayload nulls the payload and revokes access, keeping the row",
  { ...skip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const orgId = await createOrganization(pool);
    const reviewId = await createReview(pool, orgId);
    try {
      const inserted = await pool.query(
        `INSERT INTO evidence (review_id, origin, submitted_url, payload_ref, payload_hash,
                              retrieval_status, retrieved_at)
         VALUES ($1, 'answer_citation', 'https://example.com/report.pdf', 'ref://s3/abc', 'aabbcc', 'retrieved', now())
         RETURNING id`,
        [reviewId],
      );
      const evidenceId = inserted.rows[0].id as string;

      const result = await deleteEvidencePayload(evidenceId, pool);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.row.id, evidenceId);
        assert.equal(result.row.payload_ref, null);
        assert.equal(result.row.payload_hash, null);
        assert.ok(result.row.access_revoked_at !== null, "access_revoked_at must be set");

        // The row still exists — this is not a hard delete.
        const row = await pool.query("SELECT * FROM evidence WHERE id = $1", [evidenceId]);
        assert.equal(row.rowCount, 1);
        assert.equal(row.rows[0].review_id, reviewId);
        assert.equal(row.rows[0].origin, "answer_citation");
        assert.equal(row.rows[0].submitted_url, "https://example.com/report.pdf");
        assert.equal(row.rows[0].retrieval_status, "retrieved");
      }
    } finally {
      await pool.end();
    }
  },
);

test(
  "deleteEvidencePayload also works for an inline-payload-only row (no URL to keep)",
  { ...skip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const orgId = await createOrganization(pool);
    const reviewId = await createReview(pool, orgId);
    try {
      // 0004 relaxed the resolvable-content CHECK so a revoked row may carry no
      // content at all; this row never had a URL, only an inline payload hash.
      const inserted = await pool.query(
        `INSERT INTO evidence (review_id, origin, payload_hash, retrieval_status)
         VALUES ($1, 'user_added', 'deadbeef', 'retrieved')
         RETURNING id`,
        [reviewId],
      );
      const evidenceId = inserted.rows[0].id as string;

      const result = await deleteEvidencePayload(evidenceId, pool);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.row.payload_hash, null);
        assert.equal(result.row.submitted_url, null);
        assert.ok(result.row.access_revoked_at !== null);
      }
      // The row still exists, now contentless and revoked.
      const row = await pool.query("SELECT * FROM evidence WHERE id = $1", [evidenceId]);
      assert.equal(row.rowCount, 1);
      assert.equal(row.rows[0].payload_hash, null);
      assert.notEqual(row.rows[0].access_revoked_at, null);
    } finally {
      await pool.end();
    }
  },
);

test(
  "deleteEvidencePayload reports not_found for a missing row",
  { ...skip },
  async () => {
    const pool: pg.Pool = await freshPool();
    try {
      const result = await deleteEvidencePayload("00000000-0000-4000-8000-0000000000ff", pool);
      assert.deepEqual(result, { ok: false, reason: "not_found" });
    } finally {
      await pool.end();
    }
  },
);
