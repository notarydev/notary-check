// Per-claim LIFECYCLE state — where a claim got to in the pipeline, kept
// strictly separate from its verification `state` (what the evidence showed).
//
// WHY THIS TYPE EXISTS. These two questions were conflated, and the conflation
// silently produced clean-looking reviews out of failures:
//
//   - extractClaims.ts degraded EVERY model/parse failure to an empty array,
//     so "the extractor broke" and "this answer genuinely asserts nothing
//     checkable" were the same value;
//   - the MCP layer then turned an empty claim list straight into the
//     `no_issue` card, and skipped any claim whose submission returned
//     undefined with no finding recorded at all — so a mixed review in which
//     one claim's submission failed still rendered as "no issue found".
//
// A verification state answers "what did the evidence show". A lifecycle state
// answers "did we actually get to look". Only a claim whose lifecycle is
// `completed` may have its `state` read as a finding about the world; every
// other lifecycle value means the finding is about the PIPELINE, and a caller
// that renders it as "clean" is lying.
//
// HARD BOUNDARY: nothing here participates in state assignment. `claim.state`
// is assigned by verification/stateMachine.ts and by nothing else — this module
// adds no path by which a model output, a lifecycle value, or a caller can set
// it. Lifecycle is orthogonal bookkeeping ABOUT the run, which is exactly why
// it can be trusted to report the run's own failures.

/**
 * The stages a single claim passes through. Each stage is owned by exactly one
 * layer, named here so the ownership is not re-derived at each call site:
 *
 *   not_extracted — extraction layer (extraction/extractClaims.ts). The
 *                   extraction call itself failed; there is no claim list. NOT
 *                   the same as an empty claim list from a successful call.
 *   extracted     — extraction layer. Decomposed out of the answer, not yet
 *                   submitted for verification.
 *   submitted     — caller/API layer. Accepted by the engine; verification in
 *                   flight.
 *   completed     — review orchestrator (review/reviewFlow.ts). Verification
 *                   ran to completion; `claim.state` is meaningful.
 *   not_checkable — review orchestrator. Verification ran but could NOT
 *                   complete: an unresolved locator, a parser failure, a quota
 *                   denial, or a required field the judge abstained on. The
 *                   accompanying `state` is INDETERMINATE, never UNSUPPORTED.
 *   failed        — any layer. The claim's own processing errored.
 */
export type ClaimLifecycleState =
  | "not_extracted"
  | "extracted"
  | "submitted"
  | "completed"
  | "not_checkable"
  | "failed";

/**
 * Machine-readable reasons a claim is `not_checkable`. Each corresponds to one
 * of the material conditions § Verification pipeline step 8 distinguishes
 * INDETERMINATE by — a check that could not complete, as opposed to a completed
 * check that found no support.
 */
export type NotCheckableReason =
  | "quota_denied"
  | "evidence_not_parsed"
  | "locator_unresolved"
  | "required_field_unresolved";

/**
 * The lifecycle states in which a caller MAY read `claim.state` as a finding
 * about the world. Deliberately a single-element set, and deliberately a
 * function rather than a comment: a consumer deciding whether a review is
 * "clean" should call this, not re-implement the rule.
 */
export function stateIsMeaningful(lifecycle: ClaimLifecycleState): boolean {
  return lifecycle === "completed";
}

/**
 * True when a claim's lifecycle means something did not finish, and therefore
 * that no caller may render this claim — or a review containing it — as clean.
 */
export function lifecycleIndicatesIncompleteWork(lifecycle: ClaimLifecycleState): boolean {
  return lifecycle === "not_extracted" || lifecycle === "not_checkable" || lifecycle === "failed";
}
