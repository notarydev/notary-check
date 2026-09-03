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
//
// THE RESPONSE CONTRACT IS THE FIX (bug 2). This route used to answer 200
// `{ claims: [] }` for a broken extractor and 200 `{ claims: [] }` for an
// answer with nothing checkable in it — byte-identical responses for two
// situations that must never be shown to a user the same way. The MCP layer
// reads an empty claim list as the `no_issue` card, so an outage rendered as
// "no issue found". Two changes make that misreading impossible:
//
//   1. Every response carries an explicit `extraction_status`. A caller reading
//      only `claims` still cannot be misled, because —
//   2. a failure is NOT 200. A quota denial is 429 and every other failure is
//      502, and neither carries a `claims` key at all. A client that ignores
//      status codes and reads `body.claims` gets `undefined`, not `[]`.
//
// A successful extraction of zero claims is still 200 with `claims: []` and
// `extraction_status: "ok"` — that is a real answer and must stay one.

import { performance } from "node:perf_hooks";
import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { verifyApiKey } from "../auth/apiKey.ts";
import { extractClaims } from "../extraction/extractClaims.ts";
import type { JudgeClient } from "../judge/judgeClient.ts";
import { logEvent } from "../observability/log.ts";
import type { ClaimLifecycleState } from "../review/lifecycle.ts";

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

    // The org is BOTH the observability scope (§ Monitoring) and — now that
    // `database` is passed through — the quota scope: extraction is metered
    // against the same per-org monthly limit and global spend cap as the judge
    // path. Passing the pool here is what turns the gate in extractClaims.ts on
    // for real traffic.
    const result = await extractClaims(parsed.data.answer_text, {
      client: options.client,
      organizationId: orgId,
      db: database,
    });

    if (!result.ok) {
      logEvent({
        event: "claims_extracted",
        path: "judge-involved",
        latency_ms: Math.round(performance.now() - startedAt),
        organization_id: orgId,
        error_cause: result.reason,
      });
      // 429 for a quota denial (the caller may retry next month or on a higher
      // plan); 502 for a provider/parse failure (an upstream fault, not the
      // caller's request). Neither response carries a `claims` key — a client
      // that reads body.claims without checking the status gets undefined
      // rather than an empty array it could mistake for "nothing to report".
      const status = result.reason === "quota_denied" ? 429 : 502;
      return res.status(status).json({
        error: "claim extraction did not complete",
        extraction_status: "failed",
        lifecycle_state: "not_extracted" satisfies ClaimLifecycleState,
        reason: result.reason,
        detail: result.detail,
      });
    }

    logEvent({
      event: "claims_extracted",
      path: "judge-involved",
      latency_ms: Math.round(performance.now() - startedAt),
      organization_id: orgId,
      claim_count: result.claims.length,
    });

    return res.status(200).json({
      extraction_status: "ok",
      claims: result.claims,
      // Every returned claim has been extracted and nothing more — it has not
      // been submitted for verification, so no caller may read it as checked.
      lifecycle_state: "extracted" satisfies ClaimLifecycleState,
      // Non-zero means the model emitted claims that were rejected as not
      // verbatim from the answer: the extraction succeeded but was partially
      // unusable, and a caller that cares about completeness must see it.
      dropped_claim_count: result.droppedCount,
    });
  });

  return router;
}
