// Entitlement gating (paid private alpha) — engine/migrations/0010_entitlement.sql.
//
// checkEntitlement() is the single gate a route would call before doing
// billable work for an organization, mirroring quotas/quotaCheck.ts's
// checkQuota() shape: `{ allowed: true } | { allowed: false; reason: string }`.
// It is intentionally the ONLY thing this file does — no route wiring here.
// A follow-up pass inserts the one-line call into routes/reviews.ts once that
// file's own in-flight changes land, to avoid two concurrent edits to the same
// route file.
//
// entitlement_status is written exclusively by routes/webhook.ts (and
// routes/billing.ts's cancel endpoint) in response to real Stripe events —
// this file only ever reads it. It must never be confused with
// organization.plan (which tier) or claim.state (verification outcome, a
// completely separate state machine this file never touches).

import type pg from "pg";

export type EntitlementStatus = "active" | "past_due" | "canceled" | "inactive";

export type EntitlementResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Checks whether an organization currently has usable entitlement. Reads
 * `organization.entitlement_status` (migrations/0010_entitlement.sql) and
 * returns `{ allowed: false, reason }` for anything other than 'active' —
 * including an organization id that doesn't exist, so a caller can never
 * mistake "no such org" for "allowed by default".
 */
export async function checkEntitlement(organizationId: string, db: pg.Pool): Promise<EntitlementResult> {
  const result = await db.query("SELECT entitlement_status FROM organization WHERE id = $1", [organizationId]);
  if (result.rowCount === 0) {
    return { allowed: false, reason: "organization_not_found" };
  }
  const status = result.rows[0].entitlement_status as EntitlementStatus;
  if (status === "active") {
    return { allowed: true };
  }
  return { allowed: false, reason: `entitlement_${status}` };
}
