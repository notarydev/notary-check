// POST /v1/extract-claims — claim extraction from raw answer text
// (§ Verification pipeline, step 2). Same auth pattern as every other route:
// identity comes from `Authorization: Bearer <api-key>`, the organization is
// DERIVED from the key. The org is not actually used by extraction itself, but
// auth is required so this endpoint is not open to the world.
//
// Response conventions: this is a NEW endpoint, not bound by evidence.ts's
// snake_case convention (which mirrors DB column names). ExtractedClaim's
// camelCase keys are returned as-is: `decontextualizedForm`, `claimFields`,
// `valueUnit`, `comparatorBaseline`.

import { performance } from "node:perf_hooks";
import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { verifyApiKey } from "../auth/apiKey.ts";
import { extractClaims } from "../extraction/extractClaims.ts";
import type { JudgeClient } from "../judge/judgeClient.ts";
import { logEvent } from "../observability/log.ts";

const BEARER_PREFIX = "Bearer ";

const extractClaimsSchema = z.object({
  answer_text: z.string().min(1, "answer_text must be a non-empty string"),
});

export interface ExtractClaimsRouterOptions {
  /** Injected judge client for the extraction call. Tests inject a mock so the
   * route never touches the network; production omits it and extractClaims
   * builds a real client. */
  client?: JudgeClient;
}

export function extractClaimsRouter(database: pg.Pool, options: ExtractClaimsRouterOptions = {}): Router {
  const router = Router();

  router.post("/v1/extract-claims", async (req, res) => {
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

    const parsed = extractClaimsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    }

    // The org is derived and authenticated but not used by extraction — it only
    // rides along for observability (§ Monitoring), so per-org latency/cost on
    // the extraction path can be rolled up.
    const claims = await extractClaims(parsed.data.answer_text, {
      client: options.client,
      organizationId: orgId,
    });

    logEvent({
      event: "claims_extracted",
      path: "judge-involved",
      latency_ms: Math.round(performance.now() - startedAt),
      organization_id: orgId,
      claim_count: claims.length,
    });

    return res.status(200).json({ claims });
  });

  return router;
}
