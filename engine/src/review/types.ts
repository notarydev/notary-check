// The public shape of one review run — everything runReview() accepts and
// returns, and nothing that computes it.
//
// WHY SEPARATE FROM reviewFlow.ts. These interfaces ARE the contract between
// the engine and its callers: routes/reviews.ts serialises RunReviewResult
// onto the wire, and server/src/engineClient.ts re-declares the same shape on
// the other side. Anyone who needs to know what a review produces should be
// able to read that in one screenful without also reading the 850-line
// orchestrator that produces it — and, more practically, a change to the
// contract should show up in a diff that touches this file, so it is visible
// as a contract change rather than buried in an orchestration edit.
//
// Nothing here imports anything that runs. If a value ever needs computing to
// describe the contract, it belongs in reviewFlow.ts, not here.

import type { Locator, LocatorProvenance, LocatorContentKind } from "../evidence/locators.ts";
import type { ChallengeItem } from "../judge/challengeGeneration.ts";
import type { JudgeClient } from "../judge/judgeClient.ts";
import type { Move } from "../act/types.ts";
import type { ApplicabilityField, ClaimFields } from "../verification/applicability.ts";
import type { EvidenceRelation } from "../verification/stateMachine.ts";
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
