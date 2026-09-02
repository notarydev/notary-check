// Internal, service-authenticated route: maps a Clerk user to a Notary
// organization + API key. Foundation piece for wiring real Clerk OAuth into
// the MCP server (server/), so each real user gets their own isolated
// organization instead of everyone sharing one shared test account.
//
// This endpoint is called ONLY by our own trusted server/ process, never by
// end users — it deliberately does NOT use verifyApiKey()/the
// organization_api_key table (that scheme identifies an already-provisioned
// organization; this endpoint is what PROVISIONS one). Auth here is a single
// shared secret (X-Internal-Secret, checked against
// process.env.INTERNAL_SERVICE_SECRET) known only to engine/ and server/,
// never exposed to end users.

import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { issueApiKey } from "../auth/apiKey.ts";
import { logEvent } from "../observability/log.ts";

const INTERNAL_SECRET_HEADER = "x-internal-secret";

const resolveOrganizationSchema = z.object({
  clerk_user_id: z.string().min(1),
  email: z.string().email().optional(),
});

/**
 * Constant-time comparison of the presented secret against the configured
 * one. `timingSafeEqual` throws on a length mismatch rather than returning
 * false, so lengths are checked first (comparing SHA-256 digests of both
 * values would also avoid the throw, but hashing before compare is
 * unnecessary here — the secret is already long/high-entropy, so the length
 * check plus a same-length timingSafeEqual is sufficient and matches
 * apiKey.ts's discipline of never using `===` on secret material).
 */
function isValidInternalSecret(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  const presentedBuf = Buffer.from(presented, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (presentedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(presentedBuf, expectedBuf);
}

/** Simple, non-secret display-name derivation. Not an identity check. */
function deriveOrganizationName(clerkUserId: string, email: string | undefined): string {
  if (email !== undefined) {
    const local = email.split("@")[0];
    if (local !== undefined && local.length > 0) return local;
  }
  return `Notary user ${clerkUserId.slice(0, 12)}`;
}

export function internalRouter(database: pg.Pool): Router {
  const router = Router();

  // POST /v1/internal/resolve-organization — finds or creates the
  // organization for a Clerk user, and mints a fresh API key for the caller
  // to use on the user's behalf.
  router.post("/v1/internal/resolve-organization", async (req, res) => {
    const expectedSecret = process.env.INTERNAL_SERVICE_SECRET;
    if (!expectedSecret) {
      // Fail closed: an unconfigured secret must never be treated as "no auth
      // required" — that would make every request pass.
      logEvent({ event: "auth_failed", error_cause: "internal_secret_not_configured", path: "deterministic-only" });
      return res.status(401).json({ error: "internal auth not configured" });
    }
    const presentedSecret = req.header(INTERNAL_SECRET_HEADER);
    if (!isValidInternalSecret(presentedSecret, expectedSecret)) {
      logEvent({ event: "auth_failed", error_cause: "internal_secret_invalid", path: "deterministic-only" });
      return res.status(401).json({ error: "missing or invalid X-Internal-Secret header" });
    }

    const parsed = resolveOrganizationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    }
    const { clerk_user_id, email } = parsed.data;

    const existing = await database.query("SELECT id FROM organization WHERE clerk_user_id = $1", [clerk_user_id]);

    let organizationId: string;
    let created: boolean;
    if (existing.rowCount) {
      organizationId = existing.rows[0].id as string;
      created = false;
    } else {
      const name = deriveOrganizationName(clerk_user_id, email);
      const inserted = await database.query(
        "INSERT INTO organization (name, clerk_user_id) VALUES ($1, $2) RETURNING id",
        [name, clerk_user_id],
      );
      organizationId = inserted.rows[0].id as string;
      created = true;
    }

    // Tradeoff, deliberate not accidental: API key plaintext is never
    // recoverable after issuance (apiKey.ts), so this endpoint always mints a
    // FRESH key on every call rather than trying to return a previously
    // issued one. Repeated calls for the same clerk_user_id therefore issue
    // multiple independently-valid keys over time for the same organization
    // — the caller (server/) is expected to cache the key it receives and
    // call this endpoint only once per user (e.g. at first sign-in), not per
    // request. Old keys are not auto-revoked here; that's a separate,
    // later key-hygiene decision.
    const { plaintextKey } = await issueApiKey(organizationId, database);

    logEvent({
      event: "organization_resolved",
      path: "deterministic-only",
      organization_id: organizationId,
      created,
    });

    return res.status(200).json({
      organization_id: organizationId,
      api_key: plaintextKey,
      created,
    });
  });

  return router;
}
