import assert from "node:assert";
import { test } from "node:test";
import { assessApplicability } from "./applicability.ts";
import type { ClaimFields, EvidenceFields } from "./applicability.ts";

// The flagship claim, reused across the locked-suite fixtures below. Mirrors
// the plan's own running example: "Acme's revenue grew 17% in FY25."
const CLAIM: ClaimFields = {
  entity: "Acme",
  period: "FY25",
  measure: "revenue growth",
  valueUnit: { value: "17", unit: "%" },
  comparatorBaseline: "prior year",
  modality: "actual",
  scope: "company-wide",
};

const ALL_FIELDS = ["entity", "period", "measure", "valueUnit", "comparatorBaseline", "modality", "scope"];

test("exact support (locked case 1): every field matches", () => {
  const evidence: EvidenceFields = { ...CLAIM };
  const result = assessApplicability(CLAIM, evidence);
  assert.equal(result.applicable, true);
  assert.equal(result.valueConflicts, false);
  assert.deepEqual(result.mismatched, []);
  assert.deepEqual([...result.matched].sort(), [...ALL_FIELDS].sort());
});

test("flagship 17% vs 12% contradiction (locked case 2): applicable + value conflict", () => {
  const evidence: EvidenceFields = { ...CLAIM, valueUnit: { value: "12", unit: "%" } };
  const result = assessApplicability(CLAIM, evidence);
  // Same entity, period, metric, and baseline; the value conflicts. The
  // candidate is still applicable — a value difference is a contradiction,
  // not an applicability failure.
  assert.equal(result.applicable, true);
  assert.equal(result.valueConflicts, true);
  assert.deepEqual(result.mismatched, []);
  const valueUnit = result.fields.find((f) => f.field === "valueUnit");
  assert.equal(valueUnit?.status, "value_conflict");
});

test("wrong entity with an attractive matching value (locked case 6): excluded", () => {
  // The number matches ("17%"), but the evidence is about the market, not Acme.
  const evidence: EvidenceFields = { ...CLAIM, entity: "market" };
  const result = assessApplicability(CLAIM, evidence);
  assert.equal(result.applicable, false);
  assert.ok(result.mismatched.includes("entity"), "entity must be the mismatched field");
  assert.ok(result.matched.includes("valueUnit"), "the attractive value still matched");
  assert.equal(result.valueConflicts, false);
});

test("wrong period (locked case 7): excluded on the period/time field", () => {
  const evidence: EvidenceFields = { ...CLAIM, period: "FY24" };
  const result = assessApplicability(CLAIM, evidence);
  assert.equal(result.applicable, false);
  assert.ok(result.mismatched.includes("period"), "period must be the mismatched field");
});

test("wrong comparator/baseline (locked case 8): excluded", () => {
  const evidence: EvidenceFields = { ...CLAIM, comparatorBaseline: "prior quarter" };
  const result = assessApplicability(CLAIM, evidence);
  assert.equal(result.applicable, false);
  assert.ok(result.mismatched.includes("comparatorBaseline"));
});

test("wrong denominator/unit (locked case 8): excluded", () => {
  const evidence: EvidenceFields = { ...CLAIM, valueUnit: { value: "17", unit: "percentage points" } };
  const result = assessApplicability(CLAIM, evidence);
  assert.equal(result.applicable, false);
  assert.ok(result.mismatched.includes("valueUnit"));
});

test("a claim field the evidence never addresses is unestablished, not applicable", () => {
  const evidence: EvidenceFields = { ...CLAIM };
  delete evidence.entity;
  const result = assessApplicability(CLAIM, evidence);
  assert.equal(result.applicable, false);
  assert.ok(result.mismatched.includes("entity"));
});

test("matching is deterministic exact comparison (case/whitespace-insensitive), not semantic", () => {
  const evidence: EvidenceFields = { ...CLAIM, entity: "  acme ", measure: "Revenue Growth" };
  const result = assessApplicability(CLAIM, evidence);
  assert.equal(result.applicable, true);
  assert.deepEqual(result.mismatched, []);
});

test("a claim that asserts no value has nothing to fail on the value field", () => {
  const claim: ClaimFields = { entity: "Acme", period: "FY25", measure: "revenue growth" };
  const evidence: EvidenceFields = {
    entity: "Acme",
    period: "FY25",
    measure: "revenue growth",
    valueUnit: { value: "17", unit: "%" },
  };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, true);
  assert.deepEqual(result.mismatched, []);
});
