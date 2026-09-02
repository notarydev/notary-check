// Bridge from the MCP tool call to the real engine API (replaces
// mocks/scenarios.ts's pickMockScenario). Does the real work: extract claims
// from the answer text, register whatever sources were actually supplied,
// run each material claim through the engine's deterministic+judge pipeline,
// and map the results onto the card's locked 3-state shape.
//
// Engine-state -> finding-type -> card-state mapping is exactly the table in
// docs/plan.md's "Engine state -> finding type -> card state" section — this
// module does not invent its own compression rule, it implements that one.

import { randomUUID } from "node:crypto";
import type { ReviewCardData } from "./mocks/scenarios.js";

// Read lazily, not as module-level constants: ES module imports are hoisted
// and evaluated before any other top-level code in the importing module runs
// (including server.ts's process.loadEnvFile() call), so capturing
// process.env at import time would permanently bake in the pre-.env-load
// (undefined) values.
function engineUrl(): string {
  return process.env.ENGINE_URL ?? "http://localhost:4001";
}
function engineApiKey(): string {
  return process.env.ENGINE_API_KEY ?? "";
}

interface SourceRef {
  url?: string;
  title?: string;
  quoted_excerpt?: string;
  source_role: "answer_citation" | "user_added" | "workspace_collection";
}

interface ClaimFields {
  entity?: string;
  period?: string;
  metric?: string;
  operator?: "increase" | "decrease" | "no_change";
  valueUnit?: { value: string; unit?: string };
  comparatorBaseline?: string;
  modality?: string;
  scope?: string;
}

interface ExtractedClaim {
  ordinal: number;
  text: string;
  materiality: boolean;
  claimFields: ClaimFields;
}

interface ClaimResult {
  claim: { id: string; state: string; state_reason: string | null; no_source: boolean };
}

async function engineFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${engineUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${engineApiKey()}`,
      ...init.headers,
    },
  });
}

async function extractClaims(answerText: string): Promise<ExtractedClaim[]> {
  const res = await engineFetch("/v1/extract-claims", {
    method: "POST",
    body: JSON.stringify({ answer_text: answerText }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { claims: ExtractedClaim[] };
  return body.claims;
}

async function createReview(): Promise<string> {
  const res = await engineFetch("/v1/reviews", {
    method: "POST",
    body: JSON.stringify({ idempotency_key: randomUUID() }),
  });
  const body = (await res.json()) as { review: { id: string } };
  return body.review.id;
}

async function registerEvidence(reviewId: string, source: SourceRef): Promise<string | undefined> {
  const body: Record<string, unknown> = { review_id: reviewId, origin: source.source_role };
  // When both are present, send both: the excerpt is the actually-checkable
  // text (often already resolved by whoever supplied it, and not guaranteed
  // to be re-fetchable — a paywalled page, a screenshot transcript), while
  // the URL is provenance/traceability. Registering the URL alone and
  // dropping the excerpt would silently discard the one thing the caller
  // could actually check against — this was a real bug: it made the URL
  // resolve lazily (and often fail to reproduce the pasted text at all)
  // instead of using the text that was right there.
  if (source.quoted_excerpt !== undefined) body.payload = source.quoted_excerpt;
  if (source.url !== undefined) body.submitted_url = source.url;
  if (body.payload === undefined && body.submitted_url === undefined) return undefined; // nothing addressable to register

  const res = await engineFetch("/v1/evidence", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) return undefined;
  const parsed = (await res.json()) as { evidence: { id: string } };
  return parsed.evidence.id;
}

async function submitClaim(reviewId: string, claim: ExtractedClaim, evidenceIds: string[]): Promise<ClaimResult | undefined> {
  const res = await engineFetch(`/v1/reviews/${reviewId}/claims`, {
    method: "POST",
    body: JSON.stringify({
      text: claim.text,
      ordinal: claim.ordinal,
      materiality: claim.materiality,
      claim_fields: claim.claimFields,
      evidence_ids: evidenceIds,
    }),
  });
  if (!res.ok) return undefined;
  return (await res.json()) as ClaimResult;
}

// docs/plan.md's engine-state -> finding-type -> card-state table, made code.
function findingFor(result: ClaimResult["claim"], claimText: string): { finding?: { label: string; text: string; why: string }; needsCheck: boolean } {
  if (result.no_source) {
    return {
      finding: { label: claimText, text: "No inspectable evidence was supplied for this claim.", why: "no_inspectable_evidence" },
      needsCheck: true,
    };
  }
  switch (result.state) {
    case "SUPPORTED":
      return { needsCheck: false };
    case "CONTRADICTED":
      return {
        finding: { label: claimText, text: result.state_reason ?? "The supplied evidence contradicts this claim.", why: "direct_contradiction" },
        needsCheck: false,
      };
    case "UNSUPPORTED":
      return {
        finding: { label: claimText, text: result.state_reason ?? "No supplied evidence supports this claim.", why: "unsupported_claim" },
        needsCheck: false,
      };
    default: // INDETERMINATE, any reason
      return {
        finding: { label: claimText, text: result.state_reason ?? "This claim could not be checked against the supplied evidence.", why: "unresolved_applicability" },
        needsCheck: true,
      };
  }
}

export async function reviewAnswer(answerText: string, sourceRefs: SourceRef[]): Promise<ReviewCardData> {
  const claims = await extractClaims(answerText);
  const materialClaims = claims.filter((c) => c.materiality);

  if (materialClaims.length === 0) {
    return { status: "no_issue", scope: "No material factual claims found to review.", actions: [] };
  }

  const reviewId = await createReview();
  const evidenceIds = (await Promise.all(sourceRefs.map((s) => registerEvidence(reviewId, s)))).filter(
    (id): id is string => id !== undefined,
  );

  const issueFindings: Array<{ label: string; text: string; why: string }> = [];
  const uncheckedFindings: Array<{ label: string; text: string; why: string }> = [];

  for (const claim of materialClaims) {
    const result = await submitClaim(reviewId, claim, evidenceIds);
    if (result === undefined) continue;
    const { finding, needsCheck } = findingFor(result.claim, claim.text);
    if (finding === undefined) continue;
    if (needsCheck) uncheckedFindings.push(finding);
    else issueFindings.push(finding);
  }

  const scope = `${materialClaims.length} material claim${materialClaims.length === 1 ? "" : "s"} reviewed against ${evidenceIds.length} accessible source${evidenceIds.length === 1 ? "" : "s"}.`;

  if (issueFindings.length > 0) {
    return { status: "issue_found", scope, findings: issueFindings, actions: ["Open evidence", "Qualify", "Dismiss", "Recheck"] };
  }
  if (uncheckedFindings.length > 0 && uncheckedFindings.length === materialClaims.length) {
    return { status: "could_not_check", scope: uncheckedFindings[0].text, actions: [] };
  }
  return { status: "no_issue", scope, actions: [] };
}
