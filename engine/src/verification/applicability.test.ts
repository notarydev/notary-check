import assert from "node:assert";
import { test } from "node:test";
import { assessApplicability } from "./applicability.ts";
import type { ClaimFields, EvidenceFields } from "./applicability.ts";

// The flagship claim, reused across the locked-suite fixtures below. Mirrors
// the plan's own running example: "Acme's revenue grew 17% in FY25."
const CLAIM: ClaimFields = {
  entity: "Acme",
  period: "FY25",
  metric: "revenue",
  operator: "increase",
  valueUnit: { value: "17", unit: "%" },
  comparatorBaseline: "prior year",
  modality: "actual",
  scope: "company-wide",
};

const ALL_FIELDS = ["entity", "period", "metric", "operator", "valueUnit", "comparatorBaseline", "modality", "scope"];

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
  const evidence: EvidenceFields = { ...CLAIM, entity: "  acme ", metric: "Revenue", operator: "Increase" };
  const result = assessApplicability(CLAIM, evidence);
  assert.equal(result.applicable, true);
  assert.deepEqual(result.mismatched, []);
});

test("a claim that asserts no value has nothing to fail on the value field", () => {
  const claim: ClaimFields = { entity: "Acme", period: "FY25", metric: "revenue", operator: "increase" };
  const evidence: EvidenceFields = {
    entity: "Acme",
    period: "FY25",
    metric: "revenue",
    operator: "increase",
    valueUnit: { value: "17", unit: "%" },
  };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, true);
  assert.deepEqual(result.mismatched, []);
});

// ---------------------------------------------------------------------------
// Locked case 9 — semantic paraphrase that supports: representation differs,
// meaning doesn't. Typed, allow-listed normalization (§ Tier A.5) matches
// these; nothing here is fuzzy or semantic.
// ---------------------------------------------------------------------------

test("normalized entity match (locked case 9): corporate-suffix spelling variant still applies", () => {
  const evidence: EvidenceFields = { ...CLAIM, entity: "Acme, Inc." };
  const claim: ClaimFields = { ...CLAIM, entity: "ACME Inc" };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, true);
  assert.ok(result.matched.includes("entity"));
  const entityField = result.fields.find((f) => f.field === "entity");
  assert.equal(entityField?.rule, "entity-corporate-suffix-v1");
});

test("normalized percent match (locked case 9): '12 percent' matches '12%'", () => {
  const claim: ClaimFields = { ...CLAIM, valueUnit: { value: "12", unit: "percent" } };
  const evidence: EvidenceFields = { ...CLAIM, valueUnit: { value: "12", unit: "%" } };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, true);
  assert.equal(result.valueConflicts, false);
  const valueUnit = result.fields.find((f) => f.field === "valueUnit");
  assert.equal(valueUnit?.status, "matched");
});

test("normalized declared-multiplier match (locked case 9): '$12,000,000' matches '$12m'", () => {
  const claim: ClaimFields = { ...CLAIM, valueUnit: { value: "$12,000,000" } };
  const evidence: EvidenceFields = { ...CLAIM, valueUnit: { value: "$12m" } };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, true);
  assert.equal(result.valueConflicts, false);
  const valueUnit = result.fields.find((f) => f.field === "valueUnit");
  // Claimed value normalizes via the numeric-separator rule ("$12,000,000"
  // has no multiplier suffix); evidence normalizes via the declared-multiplier
  // rule ("$12m" does). Both land on "12000000" and match — a single field
  // carries only one side's rule id, so we assert the match, not which rule.
  assert.equal(valueUnit?.status, "matched");
});

// ---------------------------------------------------------------------------
// Locked case 10 — semantic paraphrase that remains indeterminate/excluded:
// representation looks close, but the meaning genuinely differs. Normalization
// must never fold these together.
// ---------------------------------------------------------------------------

test("metric never semantically normalizes (locked case 10): 'gross revenue' vs 'revenue' stays excluded", () => {
  const claim: ClaimFields = { ...CLAIM, metric: "gross revenue" };
  const evidence: EvidenceFields = { ...CLAIM, metric: "revenue" };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, false);
  assert.ok(result.mismatched.includes("metric"));
});

test("entity qualifier difference is not suffix noise (locked case 10): 'Acme plc' vs 'Acme US' stays excluded", () => {
  const claim: ClaimFields = { ...CLAIM, entity: "Acme plc" };
  const evidence: EvidenceFields = { ...CLAIM, entity: "Acme US" };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, false);
  assert.ok(result.mismatched.includes("entity"));
});

test("fiscal label never becomes calendar math (locked case 10): 'FY25' vs 'calendar 2025' stays excluded", () => {
  const claim: ClaimFields = { ...CLAIM, period: "FY25" };
  const evidence: EvidenceFields = { ...CLAIM, period: "calendar 2025" };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, false);
  assert.ok(result.mismatched.includes("period"));
});

test("same value, different metric entirely stays excluded (locked case 10): market growth vs Acme revenue growth", () => {
  const claim: ClaimFields = {
    ...CLAIM,
    metric: "Acme revenue",
    valueUnit: { value: "17", unit: "%" },
  };
  const evidence: EvidenceFields = {
    ...CLAIM,
    metric: "market",
    valueUnit: { value: "17", unit: "%" },
  };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, false);
  assert.ok(result.mismatched.includes("metric"));
  assert.ok(result.matched.includes("valueUnit"), "the attractive value still matched");
});

test("same fact, different wording, resolves to matching metric+operator (the bug this split fixes)", () => {
  // The two phrasings "revenue grew 12%" and "revenue growth was 12%" both
  // resolve to the same structured fields — metric "revenue" + operator
  // "increase" — so they compare equal via plain string equality. With the old
  // single "measure" field the wording differences could not be reconciled
  // deterministically; the split makes the shared fact the thing that matches.
  const claim: ClaimFields = { ...CLAIM, valueUnit: { value: "12", unit: "%" } };
  const evidence: EvidenceFields = { ...CLAIM, valueUnit: { value: "12", unit: "%" } };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, true);
  assert.ok(result.matched.includes("metric"));
  assert.ok(result.matched.includes("operator"));
});

test("operator disagreement (grew vs declined) is a contradiction, not an exclusion", () => {
  // Same entity/period/metric/baseline, but the evidence asserts the opposite
  // direction of change — "revenue grew" vs "revenue declined". This is NOT a
  // reason the candidate fails to apply (that would silently downgrade a real
  // contradiction to "no evidence found"): it is the reason the candidate
  // CONTRADICTS, exactly like a differing value does (see the module-level
  // comment on why operator gets the same treatment as valueUnit).
  const claim: ClaimFields = { ...CLAIM };
  const evidence: EvidenceFields = { ...CLAIM, operator: "decrease" };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, true);
  assert.deepEqual(result.mismatched, []);
  assert.equal(result.valueConflicts, true);
  const operatorField = result.fields.find((f) => f.field === "operator");
  assert.equal(operatorField?.status, "value_conflict");
});

test("operator the evidence never addresses at all is unestablished, not a contradiction", () => {
  // Distinguish "evidence disagrees" (contradiction, above) from "evidence
  // never says" (genuinely unaddressed, still excludes the candidate exactly
  // like any other unestablished field).
  const claim: ClaimFields = { ...CLAIM };
  const evidence: EvidenceFields = { ...CLAIM };
  delete evidence.operator;
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, false);
  assert.ok(result.mismatched.includes("operator"));
  assert.equal(result.valueConflicts, false);
});

// ---------------------------------------------------------------------------
// Locked test case 2's paraphrased variant — the live bug found this session
// (§ HANDOFF.md "2026-09-02 — live-endpoint verification pass"). An operator
// PARAPHRASE ("declined" recognized by the judge as "decrease") combined with
// a differing value must still resolve to a contradiction, exactly like the
// exact-wording flagship case, not to an inapplicable/excluded candidate.
// ---------------------------------------------------------------------------

test("paraphrased contradiction (locked case 2 variant): operator paraphrase + differing value both contradict", () => {
  // Claim: "Acme Inc revenue grew 17% in FY25" (operator "increase", value 17).
  // Evidence (already through judge extraction + Tier A.5 normalization):
  // "Acme Inc revenue declined 12 percent in fiscal 2025" resolves to operator
  // "decrease", value "12" — same entity/period/metric/baseline, opposite
  // direction AND a differing value.
  const claim: ClaimFields = { ...CLAIM, entity: "Acme Inc" };
  const evidence: EvidenceFields = {
    ...CLAIM,
    entity: "Acme Inc",
    operator: "decrease",
    valueUnit: { value: "12", unit: "%" },
  };
  const result = assessApplicability(claim, evidence);
  assert.equal(result.applicable, true, "must remain applicable, not excluded");
  assert.deepEqual(result.mismatched, []);
  assert.equal(result.valueConflicts, true);
  const operatorField = result.fields.find((f) => f.field === "operator");
  const valueField = result.fields.find((f) => f.field === "valueUnit");
  assert.equal(operatorField?.status, "value_conflict");
  assert.equal(valueField?.status, "value_conflict");
});
