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
import { buildTextLocator, findExactSpan, locatorDisplayString, resolveLocator, unresolvableLocator } from "../evidence/locators.ts";
import type { ResolvedEvidence } from "../ingestion/resolveEvidence.ts";
import { resolveEvidenceRow } from "../ingestion/resolveEvidence.ts";
import type { ChallengeItem } from "../judge/challengeGeneration.ts";
import { generateChallenges } from "../judge/challengeGeneration.ts";
import { CHALLENGE_PROMPT_VERSION, MAX_CHALLENGES_PER_INVOCATION } from "../judge/challengePrompts.ts";
import { extractField, assembleEvidenceFields } from "../judge/fieldExtraction.ts";
import { parseValueUnit } from "../verification/valueUnit.ts";
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
import { runActChallenge, runMovesForClaim } from "./actForClaim.ts";
import type {
  RunReviewInput,
  RunReviewMatch,
  RunReviewRejectedCandidate,
  RunReviewEvidenceStatus,
  RunReviewResult,
  RunReviewOptions,
} from "./types.ts";

// Re-exported so a caller that needs the contract can take it from either the
// orchestrator or types.ts. routes/reviews.ts imports only runReview today;
// this keeps the contract reachable without a second import line if that
// changes.
export type {
  RunReviewInput,
  RunReviewMatch,
  RunReviewRejectedCandidate,
  RunReviewEvidenceStatus,
  RunReviewResult,
  RunReviewOptions,
};

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
  // MATCH THE WAY THE LOCATOR MATCHES.
  //
  // This was `haystack.includes(needle.toLowerCase())` — byte-exact apart from
  // case, and real sources are not. HTML-to-text extraction collapses runs of
  // whitespace, inserts non-breaking spaces and breaks lines mid-phrase, so
  // "$0.09/GB" written as "$0.09 / GB", or "Google Cloud" broken across a line,
  // failed to match text that plainly contained it. Every such miss became a
  // RESIDUAL, and every residual is a model call.
  //
  // That is where the volume came from: a real answer cost 270 judge calls
  // against 5 sources, and a large share of them were asking a model to find
  // something a string search should already have found.
  //
  // findExactSpan is the same function the locator uses, so a field that
  // matches here is guaranteed to produce a resolvable locator below —
  // previously the two could disagree, which is its own class of bug.
  //
  // This does not weaken anything. The deterministic pass has always been
  // literal matching, and whitespace is not a word: treating "egress  pricing"
  // and "egress\npricing" as different strings was a defect in the comparison,
  // never a safety property. Nothing semantic is matched here, and a miss still
  // falls through to the judge exactly as before.
  const contains = (needle: string): boolean =>
    resolvedText !== null && findExactSpan(resolvedText, needle) !== null;

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
/**
 * Marks a residual field we deliberately did not ask about, because the row's
 * entity was absent and the row therefore cannot be applicable. Distinct from
 * every other non-answer so the processing loop can tell "we chose not to ask"
 * from "the judge could not tell", which are different facts with different
 * consequences for the claim's state.
 */
const SKIPPED_ENTITY_ABSENT = "skipped_entity_absent";

/**
 * Reads and writes the judge's per-source field observations.
 *
 * The cache key is (evidence, field, prompt version, model) and deliberately
 * NOT the claim — because extractField() never receives one. The judge is blind
 * to what is being asserted, so its answer about a source is the same answer for
 * every claim ever checked against that source. Reusing it is not an
 * approximation; it is the identical question.
 *
 * A cache hit deliberately carries NO token counts. The call was paid for once
 * and metered once; reporting tokens again would bill the same DeepSeek call
 * twice in the usage ledger and make spend caps fire early.
 *
 * Never throws. A cache is an optimisation, and losing one must degrade to
 * doing the work rather than failing the review.
 */
async function readObservation(
  db: pg.Pool,
  evidenceId: string,
  field: ApplicabilityField,
): Promise<JudgeFieldAnswer | null> {
  try {
    const row = await db.query(
      `SELECT outcome, value, source_span, candidates FROM evidence_field_observation
        WHERE evidence_id = $1 AND field = $2 AND prompt_version = $3 AND model = $4`,
      [evidenceId, field, PROMPT_VERSION, DEFAULT_JUDGE_MODEL],
    );
    const r = row.rows[0];
    if (r === undefined) return null;
    return {
      field,
      outcome: r.outcome as JudgeFieldAnswer["outcome"],
      value: r.value ?? undefined,
      sourceSpan: r.source_span ?? undefined,
      candidates: (r.candidates as string[] | null) ?? undefined,
      record: { model: DEFAULT_JUDGE_MODEL, promptVersion: PROMPT_VERSION, question: "", answer: "cached" },
    };
  } catch {
    return null;
  }
}

async function writeObservation(db: pg.Pool, evidenceId: string, answer: JudgeFieldAnswer): Promise<void> {
  // Only real, completed calls are stored. A quota denial, a kill-switch
  // short-circuit or a transport error is a fact about THIS RUN, not about the
  // source, and caching one would make a temporary failure permanent.
  if (answer.record.inputTokens === undefined) return;
  try {
    await db.query(
      `INSERT INTO evidence_field_observation
         (evidence_id, field, prompt_version, model, outcome, value, source_span, candidates)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (evidence_id, field, prompt_version, model) DO NOTHING`,
      [
        evidenceId,
        answer.field,
        answer.record.promptVersion,
        answer.record.model,
        answer.outcome,
        answer.value ?? null,
        answer.sourceSpan ?? null,
        answer.candidates === undefined ? null : JSON.stringify(answer.candidates),
      ],
    );
  } catch {
    // A lost cache write costs a repeat call later. Never a failed review.
  }
}

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

  // ── ALL judge calls for ALL rows, in ONE parallel wave, before any row is
  //    processed ────────────────────────────────────────────────────────────
  //
  // WHAT THIS REPLACES. The judge used to be called inside the row loop, so
  // the eight sources of one claim were eight sequential waits, each ~2 round
  // trips deep. Measured on a real answer: 16 claims x 8 sources = 358 judge
  // calls and 129 seconds of a blocked Claude turn, of which almost all was
  // waiting rather than working.
  //
  // WHY IT IS SAFE TO HOIST. extractField() takes the source text and a field
  // name. It does NOT take the claim — the judge is deliberately blind to what
  // is being asserted, which is the property that stops it agreeing with a
  // claim it has been shown. So no answer here depends on any other, on the
  // order they are asked in, or on anything the row loop does. They are
  // independent questions about independent documents.
  //
  // The row loop below is unchanged and still serial: it does the ordering-
  // sensitive work (per-row ambiguity state, locator resolution, applicability)
  // with zero network in it.
  //
  // Per row, entity is still asked FIRST and alone (E-LAT-a) — a row whose
  // entity the judge cannot find can never be applicable, so the rest of that
  // row is skipped rather than paid for.
  const answersByRow = new Map<string, Map<ApplicabilityField, JudgeFieldAnswer>>();
  await Promise.all(
    rows.map(async (row) => {
      const answerByField = new Map<ApplicabilityField, JudgeFieldAnswer>();
      answersByRow.set(row.evidenceId, answerByField);

      if (quotaDeniedReason !== null) {
        for (const field of row.residuals) answerByField.set(field, noCallAnswer(field, `quota_${quotaDeniedReason}`));
        return;
      }

      const text = row.resolved.resolvedText ?? "";
      const judgeOptions = {
        organizationId,
        evidenceLocator: sourceDisplayLocator(row.resolved, row.payloadHash) ?? undefined,
      };
      const others = row.residuals.filter((f) => f !== "entity");

      const ask = async (field: ApplicabilityField): Promise<JudgeFieldAnswer> => {
        const cached = await readObservation(db, row.evidenceId, field);
        if (cached !== null) return cached;
        const fresh = await extractField(text, field, judgeOptions);
        await writeObservation(db, row.evidenceId, fresh);
        return fresh;
      };

      if (row.residuals.includes("entity")) {
        const entityAnswer = await ask("entity");
        answerByField.set("entity", entityAnswer);
        // Only `absent` forecloses. `cannot_be_determined` already drives
        // INDETERMINATE on its own and `ambiguous` may still prove immaterial —
        // neither is ours to decide here.
        if (entityAnswer.outcome === "absent") {
          for (const field of others) answerByField.set(field, noCallAnswer(field, SKIPPED_ENTITY_ABSENT));
          logEvent({
            event: "judge_fields_skipped_entity_absent",
            organization_id: organizationId,
            review_id: reviewId,
            skipped_field_count: others.length,
          });
          return;
        }
      }

      const settled = await Promise.all(others.map((f) => ask(f)));
      others.forEach((f, i) => answerByField.set(f, settled[i]));
    }),
  );

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

    const answerByField = answersByRow.get(row.evidenceId) ?? new Map<ApplicabilityField, JudgeFieldAnswer>();

    for (const field of row.residuals) {
      const answer = answerByField.get(field) ?? noCallAnswer(field, "missing_answer");

      // A field the claim ASSERTS that the judge could not settle is one of the
      // four material conditions § step 8 separates INDETERMINATE by. Before
      // this, an abstention was indistinguishable from a completed check that
      // found nothing, so it fell through to UNSUPPORTED.
      // A field skipped because entity was absent is NOT an abstention. The row
      // is already inapplicable on entity alone, and letting the skip set
      // hadAbstainedRequiredField would flip the claim to INDETERMINATE
      // ("checks did not complete") when the checks completed fine and simply
      // did not apply. That would be a state change dressed up as an
      // optimisation.
      if (answer.record.error === SKIPPED_ENTITY_ABSENT) {
        judgeRecordByField[field] = answer.record;
        continue;
      }

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
