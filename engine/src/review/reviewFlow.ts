// The review orchestrator (§ Architecture, "Orchestrator" row) — wires the
// whole deterministic-first verification pipeline for ONE claim into a single
// callable, DB-backed function. Routes stay thin and call this.
//
// Pipeline order, load-bearing (§ Verification pipeline steps 4-7, "deterministic
// first, judge only for residue"):
//   1. load + resolve evidence rows (source resolution is lazy, on-demand);
//   2. deterministic field pass — literal, case-insensitive substring matching
//      only (§ HANDOFF step 4 explicitly forbids semantic/normalized matching
//      here — use assessApplicability exactly as it exists) — now also
//      recording the exact [start, end) offsets of every literal it finds;
//   3. judge only for the residue, gated once by checkQuota;
//   4. assemble per-row EvidenceFields (deterministic overlay, judge residue);
//   5. assessApplicability per resolved row;
//   6. relations (only for applicable rows — stateMachine.ts's caller precondition);
//   7. RE-DEREFERENCE the row's locator against the retained canonical text,
//      then assignState (no_source / CONTRADICTED / SUPPORTED / UNSUPPORTED /
//      INDETERMINATE);
//   8. persist claim + evidence_match rows in a single transaction;
//   9. ACT / CHALLENGE — org-flag-gated, material-claims-only, quota-gated:
//      0-2 typed QUESTIONS about the finding step 7 already resolved, written
//      to challenge_item and to no other table.
//
// Step 9 is a second OUTPUT of this invocation, never a second WRITER
// (§ Act / Challenge layer, authority invariant). It runs on values that
// were computed and committed before it starts, it cannot reach assignState —
// runActChallenge and judge/challengeGeneration.ts neither import nor
// reference the state machine, asserted statically in
// judge/challengeIsolation.test.ts — and any failure inside it degrades to zero
// challenge items over an intact Verify finding.
//
// The judge never decides the final state: it only extracts per-field values
// from the residue, and the deterministic layer compares them
// (assessApplicability) and assigns the state (assignState). Nothing added here
// changes that: every change below propagates FAILURE and INCOMPLETENESS
// signals, and none of them gives a model output any new authority.
//
// THREE CONFIRMED BUGS ARE CLOSED IN THIS FILE.
//
// 1. LOCATORS WERE NOT LOCATORS. `evidence_match.locator` held a URL, or an
//    `inline:<hash>` string. Neither identifies a PASSAGE, so the
//    claim-evidence relation was not inspectable and a source that later
//    changed could not be checked against what was actually assessed. Field
//    extractors could already return a source span and this orchestrator
//    neither validated nor persisted it. Now every contributing field carries a
//    real coordinate (evidence/locators.ts), the row's primary locator is
//    persisted as structured JSON, and — the part that actually matters — that
//    locator is RE-DEREFERENCED against the retained canonical text before the
//    row is allowed to produce a positive or contradictory relation. Resolution
//    that happened once at write time and was trusted forever after is not
//    resolution.
//
// 2. "RETRIEVED" WAS TREATED AS "READABLE". Step 1 accepted any row whose
//    retrieval_status was `retrieved` as an addressable source and always
//    passed checksCompleted = true to assignState. A fetched-but-unparseable
//    PDF (and, before parsePdf.ts, EVERY PDF) therefore drove the claim to
//    UNSUPPORTED — "the evidence did not support the claim" — when the truth
//    was "Notary could not inspect the evidence". checksCompleted is now
//    DERIVED from the four material conditions § step 8 distinguishes
//    INDETERMINATE by, and an uninspectable source routes to INDETERMINATE.
//
// 3. A CLAIM HAD NO LIFECYCLE. There was no way for a caller to tell "this
//    claim was checked and nothing was wrong" from "this claim's checks could
//    not run". Every claim now carries a ClaimLifecycleState (review/lifecycle.ts),
//    returned AND persisted, kept strictly orthogonal to `claim.state`.

import { createHash } from "node:crypto";
import type pg from "pg";
import type { Locator, LocatorProvenance, LocatorContentKind } from "../evidence/locators.ts";
import { buildTextLocator, locatorDisplayString, resolveLocator, unresolvableLocator } from "../evidence/locators.ts";
import type { ResolvedEvidence } from "../ingestion/resolveEvidence.ts";
import { resolveEvidenceRow } from "../ingestion/resolveEvidence.ts";
import type { ChallengeItem } from "../judge/challengeGeneration.ts";
import { generateChallenges } from "../judge/challengeGeneration.ts";
import { CHALLENGE_PROMPT_VERSION, MAX_CHALLENGES_PER_INVOCATION } from "../judge/challengePrompts.ts";
import { extractField, assembleEvidenceFields, parseValueUnit } from "../judge/fieldExtraction.ts";
import { assessAmbiguity } from "../verification/immaterialAmbiguity.ts";
import type { JudgeFieldAnswer } from "../judge/fieldExtraction.ts";
import type { JudgeClient } from "../judge/judgeClient.ts";
import type { JudgeCallRecord } from "../judge/judgeClient.ts";
import { DEFAULT_JUDGE_MODEL } from "../judge/judgeClient.ts";
import { PROMPT_VERSION } from "../judge/promptTemplates.ts";
import { logEvent } from "../observability/log.ts";
import { checkQuota } from "../quotas/quotaCheck.ts";
import { insertUsageEvent, usageEventFromMoveCall, usageEventFromChallengeCall, usageEventFromJudgeCall } from "../quotas/usage.ts";
import { getAllowedMoves } from "../act/policy.ts";
import { generateMoves } from "../act/liveGenerate.ts";
import { persistMoveInvocation } from "../act/persist.ts";
import type { Move, InvocationContext, ActEvidenceConstraint } from "../act/types.ts";
import type { ApplicabilityField, ClaimFields, EvidenceFields } from "../verification/applicability.ts";
import { assessApplicability } from "../verification/applicability.ts";
import type { EvidenceRelation } from "../verification/stateMachine.ts";
import { assignState } from "../verification/stateMachine.ts";
import type { ClaimLifecycleState, NotCheckableReason } from "./lifecycle.ts";

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
  /**
   * Skip the PER-CLAIM Move call because the caller runs Move once per
   * invocation instead (POST /v1/reviews/:id/detect ->
   * runMovesForInvocation).
   *
   * WHY THIS EXISTS. Both paths were wired at once and both ran. Observed live
   * 2026-09-04 on a five-claim answer: six per-claim Move calls fired, the
   * invocation-level call fired too, and the connector then discarded the
   * per-claim results in favour of the invocation-level ones. So the engine
   * paid for six model calls to produce output that was thrown away, and the
   * "0-2 moves per invocation" cardinality contract was bypassed —
   * ten moves were generated across five invocations, mostly
   * near-duplicates of each other, before the connector trimmed to two.
   *
   * Defaults to FALSE so a caller hitting this route directly (without the
   * detect call) still gets Move, exactly as before. The connector sets it
   * true because it always calls detect.
   */
  skipClaimMoves?: boolean;
  /**
   * MOVE — the user's own original request/question for this turn,
   * verbatim, when the caller actually has it (server/src/server.ts's MCP
   * tool field is optional: "pass this whenever you have it"). Absent or
   * empty means Move is skipped entirely for this claim — never a guess,
   * see liveGenerate.ts's no_user_request short-circuit. Deliberately NOT
   * part of ClaimFields or claimText: this is about the USER's turn, not
   * about the claim being verified.
   */
  userRequest?: string;
}

export interface RunReviewMatch {
  evidenceId: string;
  relation: "supports" | "contradicts";
  method: "quoted_or_computed" | "entailed";
  /** The exact, re-dereferenced locator this match rests on. */
  locator: Locator;
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
  /** A SOURCE-level identifier (URL, or a caller-excerpt marker) — deliberately
   * not a passage locator: an inapplicable row produced no passage worth
   * pointing at, and inventing one would misrepresent the rejection. */
  locator: string | null;
  /** From ApplicabilityResult.mismatched — the fields that excluded the row. */
  mismatchedFields: string[];
  /** From ApplicabilityResult.fields, only the status === "mismatched" entries. */
  details: Array<{ field: string; detail: string }>;
}

/**
 * Per-bound-evidence-row status, surfaced so a caller can say WHICH source
 * could not be inspected rather than only that something could not be. This is
 * the response-shape half of bug 3's fetched/parsed/usable split.
 */
export interface RunReviewEvidenceStatus {
  evidenceId: string;
  /** The bytes arrived (or were supplied inline). */
  fetched: boolean;
  /** Readable canonical text was produced from them. */
  parsed: boolean;
  /** A locator into that text resolved for at least one contributing field. */
  locatorResolved: boolean;
  /** All of the above, and the row was actually eligible to establish fields. */
  usableForClaim: boolean;
  /** resolveEvidence's own status: retrieved / unavailable / revoked. */
  retrievalStatus: string;
  parseStatus: string;
  parseError: string | null;
  /** fetched vs caller_supplied — never inferred from the presence of a URL. */
  provenance: LocatorProvenance | null;
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
  /**
   * WHERE this claim got to, as opposed to what the evidence showed. Only
   * `completed` licenses a caller to read `state` as a finding about the world.
   */
  lifecycle: ClaimLifecycleState;
  /** Why the lifecycle is not `completed`; null when it is. */
  lifecycleDetail: NotCheckableReason | null;
  /** Whether the defined checks actually ran to completion — the flag passed to
   * assignState, exposed so a caller need not re-derive it. */
  checksCompleted: boolean;
  evidenceStatuses: RunReviewEvidenceStatus[];
  /**
   * ACT / CHALLENGE — the "What to pressure-test" register (§ Act /
   * Challenge layer). Deliberately LAST in this shape, and deliberately a
   * separate field from everything above it: these are non-authoritative
   * QUESTIONS about the finding, never part of it. Empty whenever the org's
   * flag is off, the claim is not material, the invocation budget is spent, or
   * the call failed — and an empty list degrades nothing, because the evidence
   * record above is the authoritative output and Act is subordinate to it.
   */
  challenges: ChallengeItem[];
  /**
   * MOVE — 0-2 next moves (§ docs/guide/proposals/
   * system-definition-synthesis.md Part 11), run CONCURRENTLY with Act/
   * Challenge, both strictly AFTER Verify's claim + evidence_match rows are
   * already committed (step 8, above). Structurally separate from
   * `challenges`: different system, different authority level (Move
   * proposes a next HUMAN move about the broader task; Challenge questions
   * THIS claim's already-resolved finding), never merged into one array.
   * Empty whenever no user_request was supplied, no legal move exists for
   * this claim's state, the kill switch is active, quota is exhausted, or
   * the call failed — an empty list degrades nothing, same subordination
   * Verify/Act already hold.
   */
  moves: Move[];
}

/**
 * Test/caller seams. Kept OUT of RunReviewInput on purpose: that type is the
 * request DTO the route builds from a client body, and a transport handle has
 * no business being expressible there.
 */
export interface RunReviewOptions {
  /** Injected Act judge client; defaults to a real DeepSeek client. */
  challengeClient?: JudgeClient;
  /** Injected Move judge client; defaults to a real DeepSeek client. */
  moveClient?: JudgeClient;
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

/**
 * Fields whose extracted value is a CLASSIFICATION from a closed vocabulary,
 * not a quotation from the source.
 *
 * `operator` is extracted as exactly one of increase/decrease/no_change, and
 * promptTemplates.ts explicitly authorises recognising "declined" as
 * "decrease" — so the literal string "decrease" is, by design, usually NOT in
 * the evidence. `modality` is the same: fieldExtraction.ts deterministically
 * upgrades an absent modality to "actual", a value no source needed to write.
 *
 * These two are therefore exempt from the literal-span requirement below, and
 * their locators record `derived_value_has_no_literal_span` so the exemption is
 * visible in the stored record rather than implied by its absence. The exemption
 * is narrow and safe: a closed-vocabulary field can never establish support on
 * its own — a supports relation needs every asserted field applicable, and the
 * ROW's primary locator must still dereference against the retained text before
 * any relation is emitted at all.
 */
const CLOSED_VOCABULARY_FIELDS: ReadonlySet<ApplicabilityField> = new Set<ApplicabilityField>(["operator", "modality"]);

/** sha256 hex digest of a string. */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

interface ResolvedRow {
  evidenceId: string;
  resolved: ResolvedEvidence;
  /** payload_hash on the evidence row (raw-bytes hash for PDF rows). */
  payloadHash: string | null;
  /** Fields the deterministic pass resolved to the claim's own value. */
  deterministic: EvidenceFields;
  /** The literal string each deterministic field was found by, for locating it. */
  deterministicNeedles: Partial<Record<ApplicabilityField, string>>;
  /** Fields the claim asserts but the deterministic pass left unresolved. */
  residuals: ApplicabilityField[];
}

/**
 * Step 2 — deterministic field pass. For each field the claim asserts, an
 * exact, case-insensitive substring search for the claim's literal string value
 * inside the row's resolved_text. Found verbatim → the field resolves to the
 * claim's own value (evidence[field] = claim[field], so assessApplicability's
 * existing exact comparator reuses the claim value unchanged). NOT found →
 * UNRESOLVED, a candidate for the judge. A row with no resolved_text has every
 * field unresolved — though such a row no longer reaches this function at all,
 * since it is now excluded as unusable upstream.
 *
 * valueUnit is searched as `${value} ${unit}` AND as `value` alone as a
 * fallback, since a source might write "17%" with no space.
 *
 * It also records WHICH literal string matched, per field. That string is the
 * needle a real locator is built from in step 6 — the pass already knows the
 * exact text it found, and throwing that away was how the system ended up with
 * a URL where a passage coordinate belonged.
 */
function deterministicPass(claimFields: ClaimFields, resolvedText: string | null): {
  deterministic: EvidenceFields;
  deterministicNeedles: Partial<Record<ApplicabilityField, string>>;
  residuals: ApplicabilityField[];
} {
  const deterministic: EvidenceFields = {};
  const deterministicNeedles: Partial<Record<ApplicabilityField, string>> = {};
  const residuals: ApplicabilityField[] = [];
  const haystack = resolvedText?.toLowerCase() ?? null;
  const contains = (needle: string): boolean => haystack !== null && haystack.includes(needle.toLowerCase());

  for (const field of STRING_FIELDS) {
    const claimed = claimFields[field];
    if (claimed === undefined) continue; // never ask about a field the claim doesn't assert
    if (contains(claimed)) {
      deterministic[field] = claimed;
      deterministicNeedles[field] = claimed;
    } else {
      residuals.push(field);
    }
  }

  const claimedValueUnit = claimFields.valueUnit;
  if (claimedValueUnit !== undefined) {
    const combined = claimedValueUnit.unit ? `${claimedValueUnit.value} ${claimedValueUnit.unit}` : claimedValueUnit.value;
    if (contains(combined)) {
      deterministic.valueUnit = claimedValueUnit;
      deterministicNeedles.valueUnit = combined;
    } else if (contains(claimedValueUnit.value)) {
      deterministic.valueUnit = claimedValueUnit;
      deterministicNeedles.valueUnit = claimedValueUnit.value;
    } else {
      residuals.push("valueUnit");
    }
  }

  return { deterministic, deterministicNeedles, residuals };
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

/** The source-level identifier for a row, for rejected candidates and logging.
 * Never a passage coordinate. A caller-supplied excerpt says so, so that a row
 * carrying BOTH a pasted excerpt and a URL is not reported under that URL as
 * though the system had fetched it. */
function sourceDisplayLocator(resolved: ResolvedEvidence, payloadHash: string | null): string | null {
  if (resolved.provenance === "caller_supplied") {
    const hash = resolved.canonicalTextHash ?? payloadHash;
    return hash !== null ? `caller-excerpt:${hash.slice(0, 16)}` : "caller-excerpt";
  }
  if (resolved.locator !== null) return resolved.locator;
  const hash = resolved.canonicalTextHash ?? payloadHash;
  return hash !== null ? `text:${hash.slice(0, 16)}` : null;
}

export async function runReview(
  input: RunReviewInput,
  db: pg.Pool,
  options: RunReviewOptions = {},
): Promise<RunReviewResult> {
  const { organizationId, reviewId, claimText, ordinal, materiality, decontextualizedForm, claimFields, evidenceIds, userRequest } = input;

  // Step 1 — load evidence. Verify each id actually belongs to this review
  // (never trust caller-supplied ids blindly); resolve pending rows lazily.
  const rows: ResolvedRow[] = [];
  const evidenceStatuses: RunReviewEvidenceStatus[] = [];
  let hadAddressableSource = false;
  // Bug 3's core signal: a row whose bytes arrived but whose content could not
  // be read. It is NOT an addressable source and it IS an incomplete check.
  let hadUnparseableEvidence = false;

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
    const payload = await db.query("SELECT payload_hash FROM evidence WHERE id = $1", [evidenceId]);
    const payloadHash = (payload.rows[0]?.payload_hash as string | null) ?? null;

    // A revoked row contributes NOTHING and is not an incomplete check: its
    // payload was deliberately destroyed, which is an answer, not a failure.
    // resolveEvidenceRow already refuses to return its text (bug 4).
    if (resolved.status === "revoked") {
      evidenceStatuses.push({
        evidenceId,
        fetched: false,
        parsed: false,
        locatorResolved: false,
        usableForClaim: false,
        retrievalStatus: "revoked",
        parseStatus: resolved.parseStatus,
        parseError: null,
        provenance: null,
      });
      logEvent({
        event: "review_flow_evidence_skipped",
        error_cause: "evidence_revoked",
        organization_id: organizationId,
        review_id: reviewId,
      });
      continue;
    }

    if (resolved.status === "unavailable") {
      evidenceStatuses.push({
        evidenceId,
        fetched: false,
        parsed: false,
        locatorResolved: false,
        usableForClaim: false,
        retrievalStatus: "unavailable",
        parseStatus: resolved.parseStatus,
        parseError: resolved.parseError,
        provenance: resolved.provenance,
      });
      continue; // an unreachable source contributes nothing to applicability
    }

    // THE FIX FOR BUG 3, in one condition. `status === "retrieved"` used to be
    // the whole test. It answers "did the bytes arrive", which is not the
    // question — the question is "is there readable, locatable content". A
    // fetched PDF with no extractable text passes the old test and fails this
    // one, and must: counting it as addressable is what converted "could not
    // inspect" into "did not support".
    if (!resolved.usableForClaim) {
      hadUnparseableEvidence = true;
      evidenceStatuses.push({
        evidenceId,
        fetched: true,
        parsed: false,
        locatorResolved: false,
        usableForClaim: false,
        retrievalStatus: resolved.status,
        parseStatus: resolved.parseStatus,
        parseError: resolved.parseError,
        provenance: resolved.provenance,
      });
      logEvent({
        event: "review_flow_evidence_unusable",
        error_cause: `parse_status_${resolved.parseStatus}`,
        organization_id: organizationId,
        review_id: reviewId,
      });
      continue;
    }

    hadAddressableSource = true;
    const { deterministic, deterministicNeedles, residuals } = deterministicPass(claimFields, resolved.resolvedText);
    rows.push({ evidenceId, resolved, payloadHash, deterministic, deterministicNeedles, residuals });
    evidenceStatuses.push({
      evidenceId,
      fetched: true,
      parsed: true,
      // Provisional: set for real once a locator is actually built and
      // dereferenced for this row, below.
      locatorResolved: false,
      usableForClaim: true,
      retrievalStatus: resolved.status,
      parseStatus: resolved.parseStatus,
      parseError: resolved.parseError,
      provenance: resolved.provenance,
    });
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
    locator: Locator;
    locatorDisplay: string;
    fieldLocators: Array<{ field: ApplicabilityField; source: "deterministic" | "judge"; locator: Locator }>;
    resolvedTextHash: string;
    applicabilityJson: string;
    /** The fields applicability actually matched — Act read-only context. */
    matchedFields: string[];
    relation: EvidenceRelation["relation"];
    method: "quoted_or_computed" | "entailed";
    evaluatorVersion: string;
  }
  const outcomes: RowOutcome[] = [];
  const rejectedCandidates: RunReviewRejectedCandidate[] = [];
  // Bug 3's other two conditions, accumulated across rows.
  let hadAbstainedRequiredField = false;
  // Fields whose ambiguity was found immaterial — every candidate reading
  // conflicts with the claim, so the field is settled as a conflict rather
  // than left unresolved. Per evidence row, cleared with it.
  const immaterialAmbiguityFields = new Set<ApplicabilityField>();
  let hadUnresolvedLocator = false;

  for (const row of rows) {
    // Per row. A field whose ambiguity was immaterial against ONE passage says
    // nothing about the next one — the candidate readings differ per source,
    // so carrying the decision across rows would apply a conclusion drawn from
    // evidence the next row never contained.
    immaterialAmbiguityFields.clear();

    // usableForClaim guarantees non-empty text; this narrows the type.
    const canonicalText = row.resolved.resolvedText ?? "";
    const canonicalHash = row.resolved.canonicalTextHash ?? sha256(canonicalText);
    const contentKind: Exclude<LocatorContentKind, "json"> =
      row.resolved.contentKind === "json" || row.resolved.contentKind === null
        ? "plaintext"
        : row.resolved.contentKind;
    const provenance: LocatorProvenance = row.resolved.provenance ?? "fetched";
    // For a caller-supplied excerpt this URL is provenance metadata ONLY — the
    // locator records it as `associatedUrl` alongside provenance
    // "caller_supplied", never as the thing the offsets were proved against.
    const associatedUrl = row.resolved.locator;
    const pageRanges = row.resolved.pageRanges ?? undefined;

    const locateLiteral = (needle: string): Locator =>
      buildTextLocator({
        canonicalText,
        contentKind,
        provenance,
        needle,
        associatedUrl,
        hash: canonicalHash,
        pageRanges,
      });

    const fieldLocators = new Map<ApplicabilityField, { source: "deterministic" | "judge"; locator: Locator }>();

    // Deterministic fields: the pass already found the literal, so the locator
    // is guaranteed to resolve. Built from the SAME needle the pass matched on.
    for (const [field, needle] of Object.entries(row.deterministicNeedles) as Array<[ApplicabilityField, string]>) {
      fieldLocators.set(field, { source: "deterministic", locator: locateLiteral(needle) });
    }

    // Steps 3-4 — judge residue for this row, then assemble EvidenceFields.
    const judgeAnswers: JudgeFieldAnswer[] = [];
    const judgeRecordByField: Partial<Record<ApplicabilityField, JudgeCallRecord>> = {};
    const judgePresentFields = new Set<ApplicabilityField>();

    for (const field of row.residuals) {
      let answer: JudgeFieldAnswer;
      if (quotaDeniedReason !== null) {
        answer = noCallAnswer(field, `quota_${quotaDeniedReason}`);
      } else {
        answer = await extractField(canonicalText, field, {
          organizationId,
          evidenceLocator: sourceDisplayLocator(row.resolved, row.payloadHash) ?? undefined,
        });
      }

      // A field the claim ASSERTS that the judge could not settle is one of the
      // four material conditions § step 8 separates INDETERMINATE by. Before
      // this, an abstention was indistinguishable from a completed check that
      // found nothing, so it fell through to UNSUPPORTED.
      if (answer.outcome === "ambiguous" || answer.outcome === "cannot_be_determined") {
        // ...UNLESS the ambiguity cannot change the verdict. Observed live:
        // "The Statue of Liberty is 500 feet tall" against a passage giving
        // both 151 feet and 305 feet. Two readings, neither of them 500 — the
        // ambiguity is real and completely immaterial, and this used to end
        // the check at INDETERMINATE / checks_did_not_complete.
        //
        // assessAmbiguity is pure code with no model access. The judge only
        // reported which readings it saw and was told not to choose between
        // them; the decision that they all conflict is made here.
        const verdict = assessAmbiguity(
          claimFields[answer.field as keyof typeof claimFields] as string | undefined,
          answer.candidates,
        );
        if (verdict.material) {
          hadAbstainedRequiredField = true;
        } else {
          // Every reading conflicts. Record it as a settled conflict on this
          // field so the candidate stays APPLICABLE and the contradiction can
          // be seen, rather than the whole check dying on an unresolved field.
          immaterialAmbiguityFields.add(answer.field);
          logEvent({
            event: "ambiguity_immaterial",
            organization_id: organizationId,
            review_id: input.reviewId,
            field: String(answer.field),
            candidate_count: verdict.candidateCount,
          });
        }
      }

      if (answer.outcome === "present") {
        // LOCATOR RESOLUTION FOR A JUDGE-DERIVED FIELD. The judge is asked for
        // a source_span and extracts values "as written"; either should be
        // findable in the retained text. Try the span first (it is the model's
        // own citation), then the extracted value.
        const candidates = [answer.sourceSpan, answer.value].filter(
          (c): c is string => typeof c === "string" && c.trim().length > 0,
        );
        let located: Locator | null = null;
        for (const candidate of candidates) {
          const locator = locateLiteral(candidate);
          if (locator.kind !== "unresolvable") {
            located = locator;
            break;
          }
        }

        if (located !== null) {
          fieldLocators.set(field, { source: "judge", locator: located });
        } else if (CLOSED_VOCABULARY_FIELDS.has(field)) {
          // Exempt by construction — see CLOSED_VOCABULARY_FIELDS. Recorded as
          // an explicit unresolvable locator with that exact reason, so the
          // stored record shows WHY there is no span rather than omitting one.
          fieldLocators.set(field, {
            source: "judge",
            locator: unresolvableLocator("derived_value_has_no_literal_span", contentKind, provenance, associatedUrl),
          });
        } else {
          // The judge reported a value it cannot point at in the retained text.
          // That is not an establishable field: allowing it through would let a
          // model assertion stand in for evidence, which is the one thing this
          // codebase must never do. Drop the answer (so it never reaches
          // EvidenceFields) and record the incompleteness.
          hadUnresolvedLocator = true;
          logEvent({
            event: "review_flow_locator_unresolved",
            error_cause: `judge_value_not_found_in_canonical_text:${field}`,
            organization_id: organizationId,
            review_id: reviewId,
          });
          judgeRecordByField[field] = answer.record;
          if (answer.record.inputTokens !== undefined) {
            await insertUsageEvent(db, usageEventFromJudgeCall(answer.record, { organizationId, reviewId }));
          }
          continue; // deliberately NOT pushed into judgeAnswers
        }
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

    // Fields whose ambiguity was found immaterial carry a REPRESENTATIVE
    // reading into the comparison. Every candidate was checked and every one
    // conflicts with the claim, so which representative is chosen cannot
    // change the relation — the first is as good as any.
    //
    // This is what turns "unresolved field, therefore inapplicable, therefore
    // no relation at all" into a visible conflict. It is deliberately done
    // HERE rather than inside assembleEvidenceFields, which has one job and a
    // strict rule (present -> value, everything else -> undefined) that should
    // stay true of the judge's own output.
    for (const answer of judgeAnswers) {
      if (!immaterialAmbiguityFields.has(answer.field)) continue;
      const representative = answer.candidates?.[0];
      if (representative === undefined) continue;
      if (answer.field === "valueUnit") {
        judgeEvidence.valueUnit = parseValueUnit(representative);
      } else {
        judgeEvidence[answer.field] = representative;
      }
    }

    // Deterministic and judge answers never overlap (step 3 only ran for fields
    // step 2 left unresolved), so the overlay is safe.
    const evidenceFields: EvidenceFields = { ...judgeEvidence, ...row.deterministic };

    // Step 5 — applicability, per resolved row.
    const applicability = assessApplicability(claimFields, evidenceFields);

    // Step 6 — relations, per stateMachine.ts's caller precondition: ONLY an
    // applicable row may produce a relation; an inapplicable row (wrong entity,
    // wrong period, ...) produces nothing and no evidence_match row at all — but
    // it does surface as a rejectedCandidate so the card can explain the
    // rejection (§ Product contract's single-finding and two-block cards).
    if (!applicability.applicable) {
      rejectedCandidates.push({
        evidenceId: row.evidenceId,
        locator: sourceDisplayLocator(row.resolved, row.payloadHash),
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
    // A conflicting field (value and/or operator — applicability.ts's
    // value_conflict status) contributed to the result just as much as a
    // matched one; derive which field(s) actually conflicted from
    // applicability.fields rather than assuming it was always valueUnit, since
    // an operator conflict alone (same value, opposite direction) also sets
    // valueConflicts.
    if (applicability.valueConflicts) {
      for (const f of applicability.fields) {
        if (f.status === "value_conflict") usedFields.add(f.field);
      }
    }
    const method: "quoted_or_computed" | "entailed" = [...usedFields].some((f) => judgePresentFields.has(f))
      ? "entailed"
      : "quoted_or_computed";
    const usedFieldWithJudge = [...usedFields].find((f) => judgeRecordByField[f] !== undefined);
    const evaluatorVersion =
      method === "entailed" && usedFieldWithJudge !== undefined
        ? `${judgeRecordByField[usedFieldWithJudge]!.model}:${PROMPT_VERSION}`
        : "deterministic-only";

    // STEP 7a — THE ROW'S PRIMARY LOCATOR, and its re-dereference.
    //
    // Pick it from the fields that ACTUALLY CONTRIBUTED to the result, in a
    // stable field order, preferring a deterministic span over a judge one (a
    // literal this system matched itself is a better citation than one a model
    // proposed). A closed-vocabulary field's unresolvable locator is never
    // eligible to be the primary — the primary must be a real passage.
    const orderedFields: ApplicabilityField[] = [...STRING_FIELDS, "valueUnit"];
    const contributing = orderedFields.filter((f) => usedFields.has(f) && fieldLocators.has(f));
    const primaryEntry =
      contributing
        .map((f) => fieldLocators.get(f)!)
        .find((e) => e.source === "deterministic" && e.locator.kind !== "unresolvable") ??
      contributing.map((f) => fieldLocators.get(f)!).find((e) => e.locator.kind !== "unresolvable");

    if (primaryEntry === undefined) {
      // Nothing about this row can be pointed at in the retained text. It may
      // not produce a positive or contradictory match — an unlocatable relation
      // is exactly the unverifiable assertion this product exists to refuse.
      hadUnresolvedLocator = true;
      logEvent({
        event: "review_flow_locator_unresolved",
        error_cause: "no_contributing_field_resolved_to_a_span",
        organization_id: organizationId,
        review_id: reviewId,
      });
      continue;
    }

    // THE RE-DEREFERENCE. Not "was a locator computed", but "does it STILL
    // resolve, right now, against the text this row currently holds". This is
    // the check whose absence was the bug: resolution used to happen once at
    // write time and every later consumer simply trusted it.
    const resolution = resolveLocator(primaryEntry.locator, canonicalText);
    if (!resolution.resolved) {
      hadUnresolvedLocator = true;
      logEvent({
        event: "review_flow_locator_unresolved",
        error_cause: `re_resolution_failed:${resolution.reason}`,
        organization_id: organizationId,
        review_id: reviewId,
      });
      continue;
    }

    const status = evidenceStatuses.find((s) => s.evidenceId === row.evidenceId);
    if (status !== undefined) status.locatorResolved = true;

    const relation: EvidenceRelation["relation"] = applicability.valueConflicts ? "contradicts" : "supports";

    outcomes.push({
      evidenceId: row.evidenceId,
      locator: primaryEntry.locator,
      locatorDisplay: locatorDisplayString(primaryEntry.locator),
      fieldLocators: contributing.map((f) => ({ field: f, ...fieldLocators.get(f)! })),
      // The hash of the CANONICAL TEXT the locator is anchored to. Previously
      // this fell back to the raw-bytes payload_hash for a PDF, which is a hash
      // of a different thing entirely and could never validate an offset.
      resolvedTextHash: canonicalHash,
      applicabilityJson: JSON.stringify(applicability),
      matchedFields: [...applicability.matched],
      relation,
      method,
      evaluatorVersion,
    });
  }

  // Step 7b — state assignment.
  //
  // checksCompleted IS NOW DERIVED, not hardcoded true. The four conditions are
  // exactly the material ones § Verification pipeline step 8 separates
  // INDETERMINATE ("checks that could not complete") from UNSUPPORTED
  // ("defined checks completed with no support") by.
  //
  // Deliberately NOT included: a bound source that failed to FETCH. An
  // unreachable URL is already represented — it contributes no relation, and if
  // it was the only source the claim lands no_source. Folding it in here would
  // make any dead link in a citation list turn an otherwise-complete review
  // INDETERMINATE, which is a different (and unrequested) product decision.
  const checksCompleted =
    quotaDeniedReason === null && !hadUnparseableEvidence && !hadAbstainedRequiredField && !hadUnresolvedLocator;

  const relations: EvidenceRelation[] = outcomes.map((o) => ({ relation: o.relation, evidenceId: o.evidenceId }));
  const assigned = assignState(relations, hadAddressableSource, checksCompleted);

  // The lifecycle, in the precedence the reasons were discovered. `completed`
  // includes the no_source case on purpose: the pipeline DID run to completion,
  // and "there was nothing to check against" is a genuine verification outcome
  // (state INDETERMINATE, reason no_source), not a pipeline failure.
  const lifecycleDetail: NotCheckableReason | null =
    quotaDeniedReason !== null
      ? "quota_denied"
      : hadUnparseableEvidence
        ? "evidence_not_parsed"
        : hadUnresolvedLocator
          ? "locator_unresolved"
          : hadAbstainedRequiredField
            ? "required_field_unresolved"
            : null;
  const lifecycle: ClaimLifecycleState = checksCompleted ? "completed" : "not_checkable";

  // Step 8 — persist claim + evidence_match rows in a single transaction.
  const client = await db.connect();
  let claimId: string;
  try {
    await client.query("BEGIN");
    const claimResult = await client.query(
      `INSERT INTO claim (review_id, ordinal, text, decontextualized_form, materiality, state, no_source, state_reason, policy_version, lifecycle_state, lifecycle_detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'orchestrator-v1', $9, $10)
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
        lifecycle,
        lifecycleDetail,
      ],
    );
    claimId = claimResult.rows[0].id as string;

    for (const o of outcomes) {
      await client.query(
        `INSERT INTO evidence_match (claim_id, evidence_id, locator, locator_json, locator_resolved, locator_resolved_at, resolved_text_hash, applicability_json, relation, method, evaluator_version)
         VALUES ($1, $2, $3, $4, true, now(), $5, $6, $7, $8, $9)`,
        [
          claimId,
          o.evidenceId,
          o.locatorDisplay,
          JSON.stringify({ primary: o.locator, fields: o.fieldLocators }),
          o.resolvedTextHash,
          o.applicabilityJson,
          o.relation,
          o.method,
          o.evaluatorVersion,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // ── STEP 9 — ACT / CHALLENGE, and MOVE ────────────────────────────
  //
  // Both run AFTER step 8, and the ordering is a correctness property, not a
  // convenience. Act/Challenge's entire input is the RESOLVED finding —
  // the state assignState() just produced, the applicability comparison, and
  // the passages that survived re-dereference. Running it earlier would mean
  // generating questions about a finding that did not exist yet. The plan
  // permits "concurrently with (or immediately after)"; immediately after is
  // the honest reading of "reads the SAME claim/evidence boundary Verify
  // already resolved", and it also means Act can never race the claim row
  // it must reference.
  //
  // Move is run CONCURRENTLY WITH Act/Challenge (Promise.all, not
  // sequential awaits) rather than gated behind it — the two are independent
  // outputs of the same already-committed Verify result, and neither can
  // block or alter it: Verify's claim + evidence_match rows are already
  // committed above, and both runActChallenge and runMovesForClaim take
  // their inputs BY VALUE and never touch claim or evidence_match again. A
  // failure or slowness in either one cannot delay or change what the other
  // produces, or what was already returned as this claim's Verify finding.
  const [challenges, moves] = await Promise.all([
    runActChallenge(
      {
        organizationId,
        reviewId,
        claimId,
        materiality: materiality ?? false,
        claimText,
        decontextualizedForm,
        state: assigned.state,
        stateReason: assigned.reason,
        noSource: !hadAddressableSource,
        matchedFields: outcomes.length > 0 ? outcomes[0].matchedFields : [],
        mismatchDetails: rejectedCandidates.flatMap((c) => c.details),
        excerpts: outcomes.map((o) => ({
          relation: o.relation,
          locatorDisplay: o.locatorDisplay,
          quote: o.locator.kind === "text_offsets" ? o.locator.quote : "",
        })),
      },
      db,
      options.challengeClient,
    ),
    // Skipped entirely when the caller runs Move once per invocation — see
    // RunReviewInput.skipClaimMoves. Resolving to [] rather than gating the
    // Promise.all keeps the tuple shape and the concurrency story unchanged.
    input.skipClaimMoves === true
      ? Promise.resolve([] as Move[])
      : runMovesForClaim(
          {
            organizationId,
            reviewId,
            claimId,
            claimText,
            materiality: materiality ?? false,
            lifecycle,
            state: assigned.state,
            stateReason: assigned.reason,
            userRequest,
          },
          db,
          options.moveClient,
        ),
  ]);

  return {
    claimId,
    state: assigned.state,
    stateReason: assigned.reason,
    noSource: !hadAddressableSource,
    matches: outcomes.map((o) => ({
      evidenceId: o.evidenceId,
      relation: o.relation,
      method: o.method,
      locator: o.locator,
    })),
    rejectedCandidates,
    lifecycle,
    lifecycleDetail,
    checksCompleted,
    evidenceStatuses,
    challenges,
    moves,
  };
}

/** Everything Act is allowed to see about a finished finding, by value. */
interface ActInput {
  organizationId: string;
  reviewId: string;
  claimId: string;
  materiality: boolean;
  claimText: string;
  decontextualizedForm?: string;
  state: string;
  stateReason: string;
  noSource: boolean;
  matchedFields: string[];
  mismatchDetails: Array<{ field: string; detail: string }>;
  excerpts: Array<{ relation: string; locatorDisplay: string; quote: string }>;
}

/**
 * The Act stage: gate, budget, quota, generate, persist.
 *
 * THE GATE ORDER IS THE COST CONTRACT, and each step is ordered by what it
 * costs to evaluate:
 *
 *   1. materiality — a non-material claim gets no challenge layer at all
 *      (§ "at most 2 challenge items per material claim"). Free: already in
 *      memory.
 *   2. the org flag — one indexed primary-key read. A disabled org stops HERE,
 *      before any budget query, any quota sum, and any judge client is
 *      constructed, so "ship dark" costs one cheap SELECT and zero DeepSeek
 *      calls rather than a call whose result is discarded.
 *   3. the invocation budget — 4 items across all claims of this review. Claims
 *      arrive one per request, so the count of sibling items already persisted
 *      IS the invocation's spend so far; a review whose budget is gone makes no
 *      call either.
 *   4. checkQuota — the same gate the field judge and claim extraction use.
 *      Act is a real DeepSeek call and must never become an unmetered path.
 *
 * NEVER THROWS. Act is subordinate by construction, so any failure in it
 * degrades to zero challenge items and an already-committed, fully valid Track
 * 1 finding. A question layer must not be able to fail a verification.
 */
async function runActChallenge(
  input: ActInput,
  db: pg.Pool,
  client?: JudgeClient,
): Promise<ChallengeItem[]> {
  try {
    if (!input.materiality) return [];

    const flag = await db.query("SELECT act_challenge_enabled FROM organization WHERE id = $1", [input.organizationId]);
    if (flag.rows[0]?.act_challenge_enabled !== true) return [];

    // The per-invocation cap, counted across every claim already written for
    // this review — including by earlier requests, since one review's claims
    // are submitted one per call.
    //
    // RACE CLOSED HERE: this used to be a plain db.query() count, followed
    // much later by a separate insert transaction, with a network model call
    // in between. Two concurrent claim submissions for the same review could
    // both read "4 remaining", both call the model, and both insert — the
    // per-review cap was only best-effort under concurrency. Fixed by holding
    // one connection for the whole count -> generate -> insert span and taking
    // a Postgres advisory transaction lock keyed on the review id: a second
    // concurrent call for the SAME review blocks at the lock acquisition
    // (released automatically at COMMIT/ROLLBACK) until the first either
    // commits its inserts or rolls back, so the count it then reads is always
    // current. Different reviews use different lock keys and never block each
    // other. hashtext() collisions are theoretically possible but only ever
    // cause two unrelated reviews to serialize against each other — never an
    // incorrect count — so this stays correct even in that case.
    const conn = await db.connect();
    try {
      await conn.query("BEGIN");
      await conn.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.reviewId]);

      const spent = await conn.query(
        `SELECT count(*)::int AS n
           FROM challenge_item ci
           JOIN claim c ON c.id = ci.claim_id
          WHERE c.review_id = $1`,
        [input.reviewId],
      );
      const remaining = MAX_CHALLENGES_PER_INVOCATION - Number(spent.rows[0]?.n ?? 0);
      if (remaining <= 0) {
        await conn.query("COMMIT");
        logEvent({
          event: "challenge_skipped",
          error_cause: "invocation_cap_reached",
          organization_id: input.organizationId,
          review_id: input.reviewId,
        });
        return [];
      }

      const quota = await checkQuota(input.organizationId, db);
      if (!quota.allowed) {
        await conn.query("COMMIT");
        logEvent({
          event: "challenge_skipped",
          error_cause: `quota_${quota.reason}`,
          organization_id: input.organizationId,
          review_id: input.reviewId,
          path: "judge-involved",
        });
        return [];
      }

      const generated = await generateChallenges(
        {
          claimText: input.claimText,
          decontextualizedForm: input.decontextualizedForm,
          state: input.state,
          stateReason: input.stateReason,
          noSource: input.noSource,
          matchedFields: input.matchedFields,
          mismatchDetails: input.mismatchDetails,
          excerpts: input.excerpts,
        },
        { client, organizationId: input.organizationId, maxItems: remaining },
      );

      // A call that reached the network has a token count on its record, and
      // its cost is real whether or not its output survived parsing. Metering
      // it is therefore keyed on the token count, exactly as the field-judge
      // path is — never on whether items came back.
      if (generated.record.inputTokens !== undefined) {
        await insertUsageEvent(
          db,
          usageEventFromChallengeCall(generated.record, {
            organizationId: input.organizationId,
            reviewId: input.reviewId,
          }),
        );
      }

      if (generated.items.length === 0) {
        await conn.query("COMMIT");
        return [];
      }

      // Persisted on the SAME locked connection/transaction, into
      // challenge_item and nothing else. Note what is absent: the claim row
      // is never touched, nor is evidence_match. A Act write cannot reach
      // either table from here.
      for (const [ordinal, item] of generated.items.entries()) {
        await conn.query(
          `INSERT INTO challenge_item
             (claim_id, ordinal, challenge_type, action, prompt, why_it_matters,
              model, prompt_version, verify_state, verify_state_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            input.claimId,
            ordinal,
            item.challengeType,
            item.action,
            item.prompt,
            item.whyItMatters,
            generated.record.model,
            generated.record.promptVersion ?? CHALLENGE_PROMPT_VERSION,
            input.state,
            input.stateReason,
          ],
        );
      }
      await conn.query("COMMIT");
      return generated.items;
    } catch (err) {
      await conn.query("ROLLBACK");
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    // Subordinate by construction: a Act failure is logged and swallowed,
    // never propagated into a committed Verify result.
    logEvent({
      event: "challenge_failed",
      error_cause: (err as Error)?.message ?? "unknown",
      organization_id: input.organizationId,
      review_id: input.reviewId,
    });
    return [];
  }
}

/** Everything Move is allowed to see about this claim, by value. */
interface MoveInput {
  organizationId: string;
  reviewId: string;
  claimId: string;
  claimText: string;
  materiality: boolean;
  lifecycle: ClaimLifecycleState;
  state: string;
  stateReason: string;
  /** The user's own verbatim request for this turn, when the caller has it. */
  userRequest?: string;
}

/**
 * The MOVE stage: build the bounded InvocationContext, compute the allowed
 * move set, generate (quota/kill-switch gated inside liveGenerate.ts),
 * persist, return. NEVER THROWS — same subordination discipline as
 * runActChallenge: Move is a move layer, and any failure inside it
 * degrades to zero moves over an intact, already-committed Verify
 * finding, never a failed verification.
 *
 * GATE ORDER, cheapest-first, same shape as Act/Challenge's own gate:
 *   1. userRequest — absent/empty means Move has nothing to recommend a
 *      next move ABOUT (types.ts's InvocationContext doc comment); skip
 *      before building anything. Free: already in memory.
 *   2. allowedMoves — policy.ts's getAllowedMoves is pure and always
 *      non-empty for this codebase's TaskMode set, but liveGenerate.ts
 *      short-circuits on an empty set defensively regardless, so this is not
 *      a gate this function needs to duplicate.
 *   3. liveGenerate.ts's own kill-switch and quota gates, consulted inside
 *      generateMoves() itself (organizationId + db passed
 *      through) — the same DeepSeek call site every other judge-involved path
 *      in this codebase gates the same way.
 *
 * Not held under the same advisory lock / per-invocation budget Act/
 * Challenge uses: Move's own cardinality cap (0-2 moves) is entirely
 * WITHIN one call (validator.ts's MAX_SUGGESTIONS), never a cross-claim
 * invocation budget — there is no sibling-row count to serialize against.
 */
async function runMovesForClaim(
  input: MoveInput,
  db: pg.Pool,
  client?: JudgeClient,
): Promise<Move[]> {
  try {
    // Org feature flag (migration 0014), checked FIRST — before the
    // user_request short-circuit, before any budget query, and before any
    // client is constructed. Same ordering discipline as Act/Challenge's
    // own flag read: a disabled org must cost exactly zero extra DeepSeek
    // calls, not one whose result is then discarded.
    //
    // Deliberately writes no act_invocation row. A 'skipped' row means
    // "Move was eligible to run and short-circuited on its own policy" —
    // an org that has the feature turned off was never eligible at all, and
    // recording one row per claim per disabled org would bury the real
    // policy short-circuits in noise.
    const flag = await db.query("SELECT act_moves_enabled FROM organization WHERE id = $1", [input.organizationId]);
    if (flag.rows[0]?.act_moves_enabled !== true) return [];

    const userRequest = input.userRequest?.trim() ?? "";
    if (userRequest.length === 0) {
      // Recorded as a 'skipped' row (not silence) so "Move never ran for
      // this claim because there was no user_request" is distinguishable
      // later from "Move ran and found nothing" or "Move's call
      // failed" — see persist.ts's status derivation and
      // migration 0013's act_invocation.status doc comment.
      await persistMoveInvocation(db, {
        organizationId: input.organizationId,
        reviewId: input.reviewId,
        claimId: input.claimId,
        invocationContextId: input.claimId,
        hasEvidenceConstraint: false,
        allowedMoves: [],
        // Neither `moves` nor `record` set — persist.ts's own status
        // derivation reads this as 'skipped' (no call was attempted at all),
        // distinct from the 'ok' zero-moves case liveGenerate.ts's
        // in-call short-circuits produce (which DO set `moves: []`).
        result: { error: "no_user_request" },
      });
      return [];
    }

    // Case 2 (§ Part 11): a sealed Verify boundary exists whenever this
    // claim is material, its lifecycle actually completed (never surface an
    // incomplete check as a "finding" Move can react to), and the
    // resolved state is not SUPPORTED — i.e. exactly the cases in which
    // server/src/engineClient.ts's own findingFor() would render a finding
    // to the user. boundary_text is built from the same two fields the card
    // already treats as the stable, displayable record of what Verify
    // established (state + state_reason) — never a paraphrase of anything
    // Verify did not itself assert.
    const hasEvidenceConstraint = input.materiality && input.lifecycle === "completed" && input.state !== "SUPPORTED";
    const constraint: ActEvidenceConstraint | undefined = hasEvidenceConstraint
      ? {
          invocation_id: input.claimId,
          material: true,
          boundary_text: `Notary's Verify check resolved the claim "${input.claimText}" to ${input.state} (${input.stateReason}).`,
        }
      : undefined;

    // task_mode is undefined: the current MCP tool input has no field for it
    // (§ this build's known interpretation gap, flagged in the handoff report
    // — the server/src/server.ts schema only grew user_request, not
    // task_mode). getAllowedMoves(undefined, ...) is documented to resolve to
    // the full four-move set, which is the honest default for an unknown
    // task shape rather than a narrowing guess.
    const allowedMoves = getAllowedMoves(undefined, hasEvidenceConstraint);

    const context: InvocationContext = {
      invocation_id: input.claimId,
      user_request: userRequest,
      created_at: new Date().toISOString(),
    };

    const generated = await generateMoves(context, allowedMoves, constraint, {
      client,
      organizationId: input.organizationId,
      db,
    });

    // Same metering discipline as every other judge-involved call site: a
    // call that reached the network has a token count on its record, and its
    // cost is real whether or not its output survived validation.
    if (generated.record?.inputTokens !== undefined) {
      await insertUsageEvent(
        db,
        usageEventFromMoveCall(generated.record, { organizationId: input.organizationId, reviewId: input.reviewId }),
      );
    }

    const persisted = await persistMoveInvocation(db, {
      organizationId: input.organizationId,
      reviewId: input.reviewId,
      claimId: input.claimId,
      invocationContextId: input.claimId,
      hasEvidenceConstraint,
      allowedMoves,
      result: generated,
    });

    return [...persisted.moves];
  } catch (err) {
    // Subordinate by construction, same as Act/Challenge: a Move
    // failure is logged and swallowed, never propagated into a committed
    // Verify result.
    logEvent({
      event: "move_failed",
      error_cause: (err as Error)?.message ?? "unknown",
      organization_id: input.organizationId,
      review_id: input.reviewId,
    });
    return [];
  }
}
