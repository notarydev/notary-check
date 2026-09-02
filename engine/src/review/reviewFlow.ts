// The review orchestrator (§ Architecture, "Orchestrator" row) — wires the
// whole deterministic-first verification pipeline for ONE claim into a single
// callable, DB-backed function. Routes stay thin and call this.
//
// Pipeline order, load-bearing (§ Verification pipeline steps 4-7, "deterministic
// first, judge only for residue"):
//   1. load + resolve evidence rows (source resolution is lazy, on-demand);
//   2. deterministic field pass — literal, case-insensitive substring matching
//      only (§ HANDOFF step 4 explicitly forbids semantic/normalized matching
//      here — use assessApplicability exactly as it exists);
//   3. judge only for the residue, gated once by checkQuota;
//   4. assemble per-row EvidenceFields (deterministic overlay, judge residue);
//   5. assessApplicability per resolved row;
//   6. relations (only for applicable rows — stateMachine.ts's caller precondition);
//   7. assignState (no_source / CONTRADICTED / SUPPORTED / UNSUPPORTED);
//   8. persist claim + evidence_match rows in a single transaction.
//
// The judge never decides the final state: it only extracts per-field values
// from the residue, and the deterministic layer compares them
// (assessApplicability) and assigns the state (assignState).

import { createHash } from "node:crypto";
import type pg from "pg";
import type { ResolvedEvidence } from "../ingestion/resolveEvidence.ts";
import { resolveEvidenceRow } from "../ingestion/resolveEvidence.ts";
import { extractField, assembleEvidenceFields } from "../judge/fieldExtraction.ts";
import type { JudgeFieldAnswer } from "../judge/fieldExtraction.ts";
import type { JudgeCallRecord } from "../judge/judgeClient.ts";
import { DEFAULT_JUDGE_MODEL } from "../judge/judgeClient.ts";
import { PROMPT_VERSION } from "../judge/promptTemplates.ts";
import { logEvent } from "../observability/log.ts";
import { checkQuota } from "../quotas/quotaCheck.ts";
import { insertUsageEvent, usageEventFromJudgeCall } from "../quotas/usage.ts";
import type { ApplicabilityField, ClaimFields, EvidenceFields } from "../verification/applicability.ts";
import { assessApplicability } from "../verification/applicability.ts";
import type { EvidenceRelation } from "../verification/stateMachine.ts";
import { assignState } from "../verification/stateMachine.ts";

export interface RunReviewInput {
  organizationId: string;
  reviewId: string;
  claimText: string;
  ordinal: number;
  materiality?: boolean;
  decontextualizedForm?: string;
  /** Already-structured claim fields — extraction from raw text is out of scope. */
  claimFields: ClaimFields;
  /** Evidence rows already bound to this review. */
  evidenceIds: string[];
}

export interface RunReviewMatch {
  evidenceId: string;
  relation: "supports" | "contradicts";
  method: "quoted_or_computed" | "entailed";
}

/**
 * A bound evidence row that WAS resolved and assessed but came back inapplicable
 * (wrong entity, wrong period, ...). Response-shape only — computed at request
 * time, never persisted, never written to evidence_match (whose relation CHECK
 * permits only supports/contradicts, and which stays untouched). The
 * single-finding and two-block cards (§ Product contract) need this to explain
 * WHY a candidate was rejected.
 */
export interface RunReviewRejectedCandidate {
  evidenceId: string;
  /** Same locator value computed for resolved rows (evidence URL, or inline:<hash>). */
  locator: string | null;
  /** From ApplicabilityResult.mismatched — the fields that excluded the row. */
  mismatchedFields: string[];
  /** From ApplicabilityResult.fields, only the status === "mismatched" entries. */
  details: Array<{ field: string; detail: string }>;
}

export interface RunReviewResult {
  claimId: string;
  state: string;
  stateReason: string;
  noSource: boolean;
  matches: RunReviewMatch[];
  /**
   * Resolved-but-inapplicable rows only — never unavailable/unresolved rows
   * that never reached applicability at all.
   */
  rejectedCandidates: RunReviewRejectedCandidate[];
}

const STRING_FIELDS: Exclude<ApplicabilityField, "valueUnit">[] = [
  "entity",
  "period",
  "metric",
  "operator",
  "comparatorBaseline",
  "modality",
  "scope",
];

/** sha256 hex digest of a string. */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

interface ResolvedRow {
  evidenceId: string;
  resolved: ResolvedEvidence;
  /** payload_hash on the evidence row (raw-bytes hash for PDF rows). */
  payloadHash: string;
  /** Fields the deterministic pass resolved to the claim's own value. */
  deterministic: EvidenceFields;
  /** Fields the claim asserts but the deterministic pass left unresolved. */
  residuals: ApplicabilityField[];
}

/**
 * Step 2 — deterministic field pass. For each field the claim asserts, an
 * exact, case-insensitive substring search for the claim's literal string value
 * inside the row's resolved_text. Found verbatim → the field resolves to the
 * claim's own value (evidence[field] = claim[field], so assessApplicability's
 * existing exact comparator reuses the claim value unchanged). NOT found →
 * UNRESOLVED, a candidate for the judge. A row with no resolved_text (PDF with
 * no parser, or unavailable) has every field unresolved.
 *
 * valueUnit is searched as `${value} ${unit}` AND as `value` alone as a
 * fallback, since a source might write "17%" with no space.
 */
function deterministicPass(claimFields: ClaimFields, resolvedText: string | null): {
  deterministic: EvidenceFields;
  residuals: ApplicabilityField[];
} {
  const deterministic: EvidenceFields = {};
  const residuals: ApplicabilityField[] = [];
  const haystack = resolvedText?.toLowerCase() ?? null;
  const contains = (needle: string): boolean => haystack !== null && haystack.includes(needle.toLowerCase());

  for (const field of STRING_FIELDS) {
    const claimed = claimFields[field];
    if (claimed === undefined) continue; // never ask about a field the claim doesn't assert
    if (contains(claimed)) {
      deterministic[field] = claimed;
    } else {
      residuals.push(field);
    }
  }

  const claimedValueUnit = claimFields.valueUnit;
  if (claimedValueUnit !== undefined) {
    const combined = claimedValueUnit.unit ? `${claimedValueUnit.value} ${claimedValueUnit.unit}` : claimedValueUnit.value;
    if (contains(combined) || contains(claimedValueUnit.value)) {
      deterministic.valueUnit = claimedValueUnit;
    } else {
      residuals.push("valueUnit");
    }
  }

  return { deterministic, residuals };
}

/**
 * A judge answer for a residual field that must NOT reach the judge — same
 * shape/spirit as killSwitch.ts's short-circuit: no network call, logged by the
 * caller, resolves to cannot_be_determined. Used for the quota-denied path.
 */
function noCallAnswer(field: ApplicabilityField, error: string): JudgeFieldAnswer {
  return {
    field,
    outcome: "cannot_be_determined",
    record: {
      model: DEFAULT_JUDGE_MODEL,
      promptVersion: PROMPT_VERSION,
      question: "",
      error,
    },
  };
}

export async function runReview(input: RunReviewInput, db: pg.Pool): Promise<RunReviewResult> {
  const { organizationId, reviewId, claimText, ordinal, materiality, decontextualizedForm, claimFields, evidenceIds } = input;

  // Step 1 — load evidence. Verify each id actually belongs to this review
  // (never trust caller-supplied ids blindly); resolve pending rows lazily.
  const rows: ResolvedRow[] = [];
  let hadAddressableSource = false;
  for (const evidenceId of evidenceIds) {
    const owner = await db.query("SELECT id FROM evidence WHERE id = $1 AND review_id = $2", [evidenceId, reviewId]);
    if (!owner.rowCount) {
      logEvent({
        event: "review_flow_evidence_skipped",
        error_cause: "evidence_not_in_review",
        organization_id: organizationId,
        review_id: reviewId,
      });
      continue;
    }
    const resolved = await resolveEvidenceRow(evidenceId, db);
    if (resolved.status !== "retrieved") continue; // unavailable rows contribute nothing to applicability
    hadAddressableSource = true;
    const payload = await db.query("SELECT payload_hash FROM evidence WHERE id = $1", [evidenceId]);
    const { deterministic, residuals } = deterministicPass(claimFields, resolved.resolvedText);
    rows.push({ evidenceId, resolved, payloadHash: payload.rows[0].payload_hash, deterministic, residuals });
  }

  // Step 3 — judge only for residue, quota-gated ONCE for the whole review.
  const totalResiduals = rows.reduce((n, r) => n + r.residuals.length, 0);
  let quotaDeniedReason: string | null = null;
  if (totalResiduals > 0) {
    const quota = await checkQuota(organizationId, db);
    if (!quota.allowed) {
      quotaDeniedReason = quota.reason;
      // No judge client is constructed, no network call — every residual field
      // resolves to cannot_be_determined below, exactly like killSwitch.ts.
      logEvent({
        event: "review_flow_quota_denied",
        error_cause: quota.reason,
        organization_id: organizationId,
        review_id: reviewId,
        path: "judge-involved",
      });
    }
  }

  interface RowOutcome {
    evidenceId: string;
    locator: string;
    resolvedTextHash: string;
    applicabilityJson: string;
    relation: EvidenceRelation["relation"];
    method: "quoted_or_computed" | "entailed";
    evaluatorVersion: string;
  }
  const outcomes: RowOutcome[] = [];
  const rejectedCandidates: RunReviewRejectedCandidate[] = [];

  for (const row of rows) {
    // Steps 3-4 — judge residue for this row, then assemble EvidenceFields.
    const judgeAnswers: JudgeFieldAnswer[] = [];
    const judgeRecordByField: Partial<Record<ApplicabilityField, JudgeCallRecord>> = {};
    const judgePresentFields = new Set<ApplicabilityField>();

    for (const field of row.residuals) {
      let answer: JudgeFieldAnswer;
      if (quotaDeniedReason !== null) {
        answer = noCallAnswer(field, `quota_${quotaDeniedReason}`);
      } else {
        answer = await extractField(row.resolved.resolvedText ?? "", field, {
          organizationId,
          evidenceLocator: row.resolved.locator ?? undefined,
        });
      }
      judgeAnswers.push(answer);
      judgeRecordByField[field] = answer.record;
      if (answer.outcome === "present") judgePresentFields.add(field);

      // The true signal a real DeepSeek call happened is a token count on the
      // record — a kill-switch/config-error/quota short-circuit never has one.
      // Only real calls produce a usage event.
      if (answer.record.inputTokens !== undefined) {
        await insertUsageEvent(db, usageEventFromJudgeCall(answer.record, { organizationId, reviewId }));
      }
    }

    const judgeEvidence = assembleEvidenceFields(judgeAnswers);
    // Deterministic and judge answers never overlap (step 3 only ran for fields
    // step 2 left unresolved), so the overlay is safe.
    const evidenceFields: EvidenceFields = { ...judgeEvidence, ...row.deterministic };

    // Step 5 — applicability, per resolved row.
    const applicability = assessApplicability(claimFields, evidenceFields);

    // Step 6 — relations, per stateMachine.ts's caller precondition: ONLY an
    // applicable row may produce a relation; an inapplicable row (wrong entity,
    // wrong period, ...) produces nothing and no evidence_match row at all — but
    // it does surface as a rejectedCandidate so the card can explain the
    // rejection (§ Product contract's single-finding and two-block cards). The
    // locator value mirrors the one computed for applicable rows below.
    if (!applicability.applicable) {
      const locator = row.resolved.locator ?? `inline:${row.payloadHash}`;
      rejectedCandidates.push({
        evidenceId: row.evidenceId,
        locator,
        mismatchedFields: [...applicability.mismatched],
        details: applicability.fields
          .filter((f) => f.status === "mismatched" && f.detail !== undefined)
          .map((f) => ({ field: f.field, detail: f.detail! })),
      });
      continue;
    }

    // method: entailed if ANY field that actually contributed to the result
    // came from the judge; quoted_or_computed if every contributing field was
    // deterministic.
    const usedFields = new Set<ApplicabilityField>(applicability.matched);
    if (applicability.valueConflicts) usedFields.add("valueUnit");
    const method: "quoted_or_computed" | "entailed" = [...usedFields].some((f) => judgePresentFields.has(f))
      ? "entailed"
      : "quoted_or_computed";
    const usedFieldWithJudge = [...usedFields].find((f) => judgeRecordByField[f] !== undefined);
    const evaluatorVersion =
      method === "entailed" && usedFieldWithJudge !== undefined
        ? `${judgeRecordByField[usedFieldWithJudge]!.model}:${PROMPT_VERSION}`
        : "deterministic-only";

    const relation: EvidenceRelation["relation"] = applicability.valueConflicts ? "contradicts" : "supports";
    // resolved_text_hash: sha256 of the canonicalized text; for a PDF row (no
    // text) reuse the raw-bytes hash already stored on the evidence row — don't
    // rehash. locator for an inline-payload row (no URL ever existed) falls
    // back to an inline:<hash> locator so evidence_match.locator (NOT NULL)
    // is always satisfied by something meaningful.
    const resolvedTextHash = row.resolved.resolvedText !== null ? sha256(row.resolved.resolvedText) : row.payloadHash;
    const locator = row.resolved.locator ?? `inline:${row.payloadHash}`;

    outcomes.push({
      evidenceId: row.evidenceId,
      locator,
      resolvedTextHash,
      applicabilityJson: JSON.stringify(applicability),
      relation,
      method,
      evaluatorVersion,
    });
  }

  // Step 7 — state assignment.
  const relations: EvidenceRelation[] = outcomes.map((o) => ({ relation: o.relation, evidenceId: o.evidenceId }));
  const assigned = assignState(relations, hadAddressableSource, true);

  // Step 8 — persist claim + evidence_match rows in a single transaction.
  const client = await db.connect();
  let claimId: string;
  try {
    await client.query("BEGIN");
    const claimResult = await client.query(
      `INSERT INTO claim (review_id, ordinal, text, decontextualized_form, materiality, state, no_source, state_reason, policy_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'orchestrator-v1')
       RETURNING id`,
      [
        reviewId,
        ordinal,
        claimText,
        decontextualizedForm ?? null,
        materiality ?? false,
        assigned.state,
        !hadAddressableSource,
        assigned.reason,
      ],
    );
    claimId = claimResult.rows[0].id as string;

    for (const o of outcomes) {
      await client.query(
        `INSERT INTO evidence_match (claim_id, evidence_id, locator, resolved_text_hash, applicability_json, relation, method, evaluator_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [claimId, o.evidenceId, o.locator, o.resolvedTextHash, o.applicabilityJson, o.relation, o.method, o.evaluatorVersion],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return {
    claimId,
    state: assigned.state,
    stateReason: assigned.reason,
    noSource: !hadAddressableSource,
    matches: outcomes.map((o) => ({ evidenceId: o.evidenceId, relation: o.relation, method: o.method })),
    rejectedCandidates,
  };
}
