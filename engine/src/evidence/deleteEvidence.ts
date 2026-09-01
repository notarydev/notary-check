// Honest evidence-payload deletion (§ Security, privacy, and reliability
// requirements: "Make deletion honest: after payload deletion, a record
// becomes unable to re-resolve; never pretend the evidence remains available").
//
// This is NOT a hard DELETE of the Evidence row — that would erase history,
// contradicting the append-only design from build-order step 1. It nulls the
// payload fields (payload_ref, payload_hash) and sets access_revoked_at, so:
//
//   - the row still exists (audit/history intact: origin, review, timestamps);
//   - it can no longer re-resolve to any content (nothing to open or hash);
//   - access_revoked_at is set, so any consumer KNOWS it was revoked — a
//     revoked source must not be able to establish new support going forward,
//     and nobody can pretend the evidence remains available.
//
// The 0004 migration relaxes 0001's resolvable-content CHECK so that a row with
// access_revoked_at set is allowed to carry no content at all (an
// inline-payload-only row had no URL to keep).
//
// Everything else on the row is preserved by design — this function updates
// only the three payload/revocation fields.

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
  | { ok: true; row: EvidencePayloadRow }
  | { ok: false; reason: "not_found" };

/**
 * "Deletes" an evidence row's payload: sets access_revoked_at, nulls
 * payload_ref and payload_hash, keeps everything else. Returns the updated row.
 */
export async function deleteEvidencePayload(evidenceId: string, db: pg.Pool): Promise<DeleteEvidenceResult> {
  const result = await db.query(
    `UPDATE evidence
     SET access_revoked_at = now(),
         payload_ref = NULL,
         payload_hash = NULL
     WHERE id = $1
     RETURNING id, review_id, origin, submitted_url, payload_ref, payload_hash, retrieval_status, access_revoked_at`,
    [evidenceId],
  );
  if (!result.rowCount) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, row: result.rows[0] as EvidencePayloadRow };
}
