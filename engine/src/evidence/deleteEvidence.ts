// Honest evidence-payload deletion (§ Security, privacy, and reliability
// requirements: "Make deletion honest: after payload deletion, a record
// becomes unable to re-resolve; never pretend the evidence remains available").
//
// This is NOT a hard DELETE of the Evidence row — that would erase history,
// contradicting the append-only design from build-order step 1. It shreds every
// retrievable representation of the payload and sets access_revoked_at, so:
//
//   - the row still exists (audit/history intact: origin, review, timestamps);
//   - it can no longer re-resolve to any content (nothing to open or hash);
//   - access_revoked_at is set AND retrieval_status becomes 'revoked', so any
//     consumer KNOWS it was revoked — a revoked source must not be able to
//     establish new support going forward, and nobody can pretend the evidence
//     remains available.
//
// THE BUG THIS CLOSES. The previous version nulled exactly two columns,
// payload_ref and payload_hash. It was written at build-order step 5. The
// review orchestrator LATER added evidence.resolved_text (migration 0006) — the
// column that actually holds the readable payload text — and the two were never
// reconciled. So "deleting" an evidence payload left the full text sitting in
// resolved_text, and resolveEvidence.ts happily returned it to any new review,
// because it did not check revocation at all. Deletion was documented as done
// for weeks while the text remained both readable and usable. Three things were
// therefore wrong and are fixed together:
//
//   1. here — shred EVERY retrievable representation, not two of them;
//   2. in resolveEvidence.ts — check revocation at READ time, on every path,
//      before returning any cached content;
//   3. in evidence_match — stamp payload_revoked_at on the historical matches,
//      so a past finding stays truthful (it was true when made) while openly
//      recording that the payload behind its locator no longer exists. The
//      alternative — silently leaving a locator pointing into deleted text —
//      is the dishonesty this requirement exists to forbid.
//
// All of it runs in ONE transaction: a partially-shredded payload with a
// non-revoked status would be exactly the state an attacker or a retry would
// want to catch the system in.

import type pg from "pg";

export interface EvidencePayloadRow {
  id: string;
  review_id: string;
  origin: string;
  submitted_url: string | null;
  payload_ref: string | null;
  payload_hash: string | null;
  retrieval_status: string;
  access_revoked_at: string | null;
}

export type DeleteEvidenceResult =
  | { ok: true; row: EvidencePayloadRow; matchesMarked: number }
  | { ok: false; reason: "not_found" };

/**
 * Revokes an evidence row's payload: shreds every retrievable representation,
 * sets access_revoked_at and retrieval_status = 'revoked', marks the historical
 * evidence_match rows as revoked-payload, and keeps the audit row. Idempotent —
 * revoking an already-revoked row is a no-op that still reports ok.
 *
 * Deliberately preserved: id, review_id, origin, submitted_url, retrieved_at,
 * retention_until, submitted_by, snapshot_reuse_policy, created_at. Those are
 * the audit trail (WHAT was submitted, by whom, when) and carry no payload
 * content. submitted_url in particular is metadata about the submission, not a
 * retrievable representation of the payload — the row can no longer re-resolve
 * through it because 'revoked' short-circuits the resolver before any fetch.
 */
export async function deleteEvidencePayload(evidenceId: string, db: pg.Pool): Promise<DeleteEvidenceResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE evidence
       SET access_revoked_at = COALESCE(access_revoked_at, now()),
           retrieval_status = 'revoked',
           payload_ref = NULL,
           payload_hash = NULL,
           -- resolved_text is THE readable payload (migration 0006). Leaving it
           -- populated was the bug; it is the first thing that must go.
           resolved_text = NULL,
           -- The canonical-text hash and page boundaries are derived from the
           -- payload and would let a holder confirm a guessed payload or
           -- reconstruct its shape. Derived representations are payload too.
           canonical_text_hash = NULL,
           page_ranges = NULL,
           parse_status = 'not_attempted',
           parse_error = NULL,
           content_kind = NULL
       WHERE id = $1
       RETURNING id, review_id, origin, submitted_url, payload_ref, payload_hash, retrieval_status, access_revoked_at`,
      [evidenceId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }

    // Historical matches: keep the finding, tell the truth about its payload.
    // The locator/quote already persisted on the match is NOT erased — it is
    // the record of what was actually assessed at the time, which is the whole
    // point of an audit trail — but payload_revoked_at now marks it so no
    // reader can mistake it for a locator that still dereferences.
    const matches = await client.query(
      `UPDATE evidence_match
       SET payload_revoked_at = COALESCE(payload_revoked_at, now()),
           locator_resolved = false
       WHERE evidence_id = $1
       RETURNING id`,
      [evidenceId],
    );

    await client.query("COMMIT");
    return { ok: true, row: result.rows[0] as EvidencePayloadRow, matchesMarked: matches.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
