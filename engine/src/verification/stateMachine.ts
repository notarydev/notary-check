// Deterministic claim state assignment (§ Verification pipeline, step 8),
// implemented as a pure function operating on a claim's set of evidence
// relations. Exact precedence from the plan:
//
//   if no relevant addressable source:                 no_source + INDETERMINATE
//   else if any applicable relation contradicts:        CONTRADICTED
//   else if any applicable relation supports:           SUPPORTED
//   else if defined checks completed with no support:   UNSUPPORTED
//   else:                                                INDETERMINATE
//
// CONFLICTED is intentionally ABSENT from the relation type below. That state
// is CAPTURE-tier only (§ Verification pipeline step 8: "CONFLICTED and
// ATTESTED belong to later CAPTURE records") — a separate, later product tier
// explicitly out of scope for this CHECK build (§ docs/build/tier-1-build-and-operating-plan.md, "Do not build
// yet": conflict/attestation workflows before a CAPTURE customer exists). Its
// absence here is deliberate, not forgotten.
//
// PURE, DETERMINISTIC LOGIC: no database, no I/O, no model calls. Relations
// arrive here already classified as supports or contradicts (the deterministic
// comparator produces the candidate's applicability; the VALUE comparison
// decides support vs contradiction); this function only applies the precedence.
//
// CALLER PRECONDITION, load-bearing: only pass a relation for a candidate whose
// ApplicabilityResult.applicable is true. An inapplicable candidate (e.g. wrong
// entity) that also happens to have a differing value is NOT a contradiction —
// it is simply inapplicable, exactly like any other mismatch — and must not
// reach this function as a "contradicts" relation. assessApplicability()'s
// `applicable` and `valueConflicts` are independent flags; check `applicable`
// first, every time, before consulting `valueConflicts` to classify a relation.

export type EvidenceRelationType = "supports" | "contradicts";

export interface EvidenceRelation {
  relation: EvidenceRelationType;
  /** which bound evidence produced this relation (Evidence.id). */
  evidenceId: string;
}

export interface AssignStateResult {
  state: string;
  reason: string;
}

/**
 * Assigns a claim's final verification state by step 8's precedence.
 *
 * @param relations          the claim's applicable evidence relations.
 * @param hadAddressableSource whether any relevant, addressable source existed
 *                            for the claim (§ Verification pipeline step 8,
 *                            first branch; the evidence-binding round-trip,
 *                            step 6, has already run and been exhausted).
 * @param checksCompleted     whether the defined deterministic checks ran to
 *                            completion. The plan's precedence distinguishes
 *                            "defined checks completed with no support"
 *                            (UNSUPPORTED) from the trailing INDETERMINATE
 *                            (checks that could not complete — e.g. an
 *                            unresolved locator or judge abstention upstream).
 *                            Those upstream signals are not representable in
 *                            the relations set, so they arrive as this flag;
 *                            it defaults to true, keeping the documented
 *                            two-argument call form meaningful.
 */
export function assignState(
  relations: EvidenceRelation[],
  hadAddressableSource: boolean,
  checksCompleted: boolean = true,
): AssignStateResult {
  if (!hadAddressableSource) {
    return { state: "INDETERMINATE", reason: "no_source" };
  }
  if (relations.some((r) => r.relation === "contradicts")) {
    return { state: "CONTRADICTED", reason: "contradicting_applicable_relation" };
  }
  if (relations.some((r) => r.relation === "supports")) {
    return { state: "SUPPORTED", reason: "supporting_applicable_relation" };
  }
  if (checksCompleted) {
    return { state: "UNSUPPORTED", reason: "no_support_after_completed_checks" };
  }
  return { state: "INDETERMINATE", reason: "checks_did_not_complete" };
}
