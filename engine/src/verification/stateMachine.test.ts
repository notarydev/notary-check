import assert from "node:assert";
import { test } from "node:test";
import { assignState } from "./stateMachine.ts";
import type { EvidenceRelation } from "./stateMachine.ts";
import { assessApplicability } from "./applicability.ts";
import type { ClaimFields, EvidenceFields } from "./applicability.ts";

const supports = (evidenceId: string): EvidenceRelation => ({ relation: "supports", evidenceId });
const contradicts = (evidenceId: string): EvidenceRelation => ({ relation: "contradicts", evidenceId });

test("exact support (locked case 1): SUPPORTED", () => {
  const result = assignState([supports("e-1")], true);
  assert.equal(result.state, "SUPPORTED");
  assert.equal(result.reason, "supporting_applicable_relation");
});

test("flagship 17% vs 12% contradiction (locked case 2): CONTRADICTED", () => {
  const result = assignState([contradicts("e-2")], true);
  assert.equal(result.state, "CONTRADICTED");
  assert.equal(result.reason, "contradicting_applicable_relation");
});

test("precedence: a contradiction outranks a support", () => {
  const result = assignState([supports("e-1"), contradicts("e-2")], true);
  assert.equal(result.state, "CONTRADICTED");
});

test("no support after all defined checks complete (locked case 3): UNSUPPORTED", () => {
  const result = assignState([], true);
  assert.equal(result.state, "UNSUPPORTED");
  assert.equal(result.reason, "no_support_after_completed_checks");
});

test("no addressable source at all (locked case 4): no_source + INDETERMINATE", () => {
  const result = assignState([], false);
  assert.equal(result.state, "INDETERMINATE");
  assert.equal(result.reason, "no_source");
});

test("no_source outranks any relations — first branch of the precedence", () => {
  // If there was no addressable source, relations cannot have been produced;
  // the first branch wins regardless of what is passed in.
  const result = assignState([supports("e-1")], false);
  assert.equal(result.state, "INDETERMINATE");
  assert.equal(result.reason, "no_source");
});

test("trailing else: checks that did not complete resolve to INDETERMINATE", () => {
  const result = assignState([], true, false);
  assert.equal(result.state, "INDETERMINATE");
  assert.equal(result.reason, "checks_did_not_complete");
});

test("end to end: the flagship contradiction reaches CONTRADICTED through both pure modules", () => {
  const claim: ClaimFields = {
    entity: "Acme",
    period: "FY25",
    measure: "revenue growth",
    valueUnit: { value: "17", unit: "%" },
    comparatorBaseline: "prior year",
    modality: "actual",
    scope: "company-wide",
  };
  const evidence: EvidenceFields = { ...claim, valueUnit: { value: "12", unit: "%" } };

  const applicability = assessApplicability(claim, evidence);
  assert.equal(applicability.applicable, true);
  assert.equal(applicability.valueConflicts, true);

  // An applicable candidate whose value conflicts produces a contradicts
  // relation; step 8's precedence then assigns CONTRADICTED.
  const relations: EvidenceRelation[] = applicability.valueConflicts
    ? [{ relation: "contradicts", evidenceId: "e-annual-report" }]
    : [{ relation: "supports", evidenceId: "e-annual-report" }];

  const result = assignState(relations, true);
  assert.equal(result.state, "CONTRADICTED");
});
