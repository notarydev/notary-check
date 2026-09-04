// The detector bank's shared vocabulary.
//
// WHY THIS MODULE EXISTS. Verify used to have exactly one detector —
// claim-versus-evidence — so its output could BE the claim's verification
// state. With several detectors that stops working: source-verify can say
// SUPPORTED while arithmetic says the numbers don't reconcile, and both are
// right about different things. "Is there a problem?" is no longer readable
// off `claim.state`.
//
// So detectors emit FINDINGS beside the claim, and exactly one detector —
// source-verify — additionally writes `claim.state`. That asymmetry is the
// authority boundary in structural form, and it is why `Finding` deliberately
// has no field that could hold a verification state.
//
// THE TWO OUTPUTS, and the line between them:
//
//   Finding  — something is wrong, and it is BLATANTLY wrong. A fact.
//   Gap      — a detector could have run but an input was missing. Also a fact.
//
// Both are facts, which is why both live here in Verify's vocabulary. What
// to DO about either of them — the move, the ask, the button — is
// Act's, and nothing in this file expresses an action.
//
// "BLATANT" IS THE BAR, not "computed". Some things are computable and still
// arguable; those are not findings. If a reasonable person shown the evidence
// would debate it, it does not belong here.

import type { ClaimFields } from "../verification/applicability.ts";

/**
 * Who is entitled to believe this, and on what basis. Every finding declares
 * one — nothing Notary surfaces is allowed to be ownerless.
 */
export type EpistemicOwner =
  /** Derived from material we resolved and can re-resolve. The strongest. */
  | "computed"
  /**
   * Deterministic comparison, but over input that cannot be independently
   * re-resolved — a prior conversational statement Claude restated, for
   * instance. The comparison is exact; the input is hearsay. Such a finding
   * may FLAG but must never assign a verification state, because
   * canonical § 17.2 requires addressable evidence with a resolved locator
   * for any positive or contradictory state.
   */
  | "computed_unverified";

export type DetectorId =
  | "source_verify"
  | "self_contradiction"
  | "self_report"
  | "arithmetic"
  | "requirement"
  | "overreach"
  | "drift";

export type FindingType =
  | "source_contradiction"
  | "internal_conflict"
  | "self_report_mismatch"
  | "arithmetic_conflict"
  | "requirement_unmet"
  | "overreach"
  | "conflict_candidate";

/**
 * What a finding rests on. A heterogeneous bank needs one uniform answer to
 * "why does Notary believe this?" — `evidence_locator` only ever worked for
 * the evidence-shaped detectors, and a requirement or a self-report mismatch
 * has no locator at all.
 */
export interface FindingBasis {
  kind: "evidence" | "answer_internal" | "request" | "execution" | "prior_context";
  /** Evidence id, claim id pair, tool-call id — whatever identifies the material. */
  ref?: string;
  /** The exact text the finding rests on, when there is one and it is short. */
  excerpt?: string;
}

/** One structured disagreement between two things that should agree. */
export interface FieldDelta {
  field: string;
  claimed: string;
  observed: string;
  relation: "conflict" | "missing" | "weaker" | "stronger";
}

/**
 * One thing that is blatantly wrong.
 *
 * Deliberately absent, and the absence is the contract: no `state`, no
 * `verdict`, no `confidence`, no `score`. A detector that wanted to assign a
 * verification state would have nowhere to put it.
 */
export interface Finding {
  id: string;
  detector: DetectorId;
  type: FindingType;
  owner: EpistemicOwner;
  /** Which claim this concerns, when it concerns one. Arithmetic over the whole answer may not. */
  claimId?: string;
  /** One compact sentence stating what was established. Shown to the user, and to Act. */
  boundaryText: string;
  /** The structured disagreement. This is what lets Act tell "wrong period" from "wrong number". */
  fieldDeltas: FieldDelta[];
  basis: FindingBasis;
  /**
   * Fixed per-detector consequence rank, for ordering when several fire.
   * Lower sorts first. Not a severity score shown to anyone — canonical bans
   * severity levels and colour-coded triage in the UI; this exists only so
   * two findings have a deterministic order.
   */
  rank: number;
  /** Which generation of the detector produced this. A finding is immutable; its detector is not. */
  detectorVersion: string;
}

/** What a detector needs but did not get. Also a fact, not a request. */
export interface Gap {
  detector: DetectorId;
  claimId?: string;
  missing: "addressable_source" | "user_request" | "prior_context" | "execution_result";
  /** What becomes checkable if this arrives. Act turns this into an ask; this is not itself an ask. */
  unblocks: string;
}

/**
 * A detector's three possible outcomes. The third is the one that is easy to
 * forget and expensive to omit: without it we cannot tell "this task has no
 * code to run" from "this task has code and no test output", and we would ask
 * a literature-review user for a test run.
 */
export type DetectorOutcome =
  | { status: "ran"; findings: Finding[] }
  | { status: "not_applicable" }
  | { status: "missing_input"; gaps: Gap[] };

/** Everything a detector may read. Deliberately narrow — see runDetectors. */
export interface DetectorInput {
  answerText: string;
  userRequest?: string;
  claims: Array<{ id: string; text: string; fields: ClaimFields; materiality: boolean }>;
  /** Tool output present in the same turn, when the caller supplied it. */
  executionResults?: Array<{ ref: string; text: string }>;
  priorContext?: Array<{ kind: string; text: string }>;
  /** True when at least one source was bound and resolved for this review. */
  hasResolvedEvidence: boolean;
}

export interface Detector {
  id: DetectorId;
  version: string;
  /** Fixed consequence rank for every finding this detector emits. */
  rank: number;
  run(input: DetectorInput): DetectorOutcome;
}
