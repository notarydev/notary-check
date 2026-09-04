import assert from "node:assert";
import { test } from "node:test";
import {
  compareField,
  compareValueUnit,
  normalizeEntity,
  normalizePeriodLabel,
  normalizeSafeSyntax,
  normalizeValueUnit,
  NORMALIZATION_RULES,
  resolveEntityAlias,
  resolveFiscalCalendarMapping,
} from "./normalization.ts";

test("normalizeSafeSyntax collapses case, whitespace, and Unicode form", () => {
  const a = normalizeSafeSyntax("  Revenue   Growth ");
  const b = normalizeSafeSyntax("revenue growth");
  assert.equal(a.normalized, b.normalized);
  assert.equal(a.ruleId, NORMALIZATION_RULES.SAFE_SYNTAX_V1);
});

test("normalizeEntity folds corporate-suffix spelling variants", () => {
  const a = normalizeEntity("Acme, Inc.");
  const b = normalizeEntity("ACME Inc");
  assert.equal(a.normalized, b.normalized);
  assert.equal(a.ruleId, NORMALIZATION_RULES.ENTITY_SUFFIX_V1);
});

test("normalizeEntity never folds different qualifiers into the same entity", () => {
  const a = normalizeEntity("Acme plc");
  const b = normalizeEntity("Acme US");
  assert.notEqual(a.normalized, b.normalized);
});

test("resolveEntityAlias is an unwired stub (v1 scope boundary)", () => {
  assert.equal(resolveEntityAlias("acme"), null);
  assert.equal(resolveEntityAlias("ibm"), null);
});

test("normalizePeriodLabel folds FY-notation variants to one label", () => {
  const a = normalizePeriodLabel("FY25");
  const b = normalizePeriodLabel("fiscal 2025");
  assert.equal(a.normalized, b.normalized);
  assert.equal(a.ruleId, NORMALIZATION_RULES.PERIOD_FISCAL_LABEL_V1);
});

test("normalizePeriodLabel never performs calendar-date math", () => {
  const fy = normalizePeriodLabel("FY25");
  const calendar = normalizePeriodLabel("calendar 2025");
  assert.notEqual(fy.normalized, calendar.normalized);
});

test("resolveFiscalCalendarMapping is an unwired stub (v1 scope boundary)", () => {
  assert.equal(resolveFiscalCalendarMapping("FY25"), null);
});

test("normalizeValueUnit folds percent-word notation to '%'", () => {
  const a = normalizeValueUnit({ value: "12", unit: "percent" });
  const b = normalizeValueUnit({ value: "12", unit: "%" });
  assert.equal(a.unit?.normalized, b.unit?.normalized);
  assert.equal(a.unit?.ruleId, NORMALIZATION_RULES.VALUE_PERCENT_V1);
});

test("normalizeValueUnit strips numeric grouping separators", () => {
  const a = normalizeValueUnit({ value: "12,000,000" });
  const b = normalizeValueUnit({ value: "12000000" });
  assert.equal(a.value.normalized, b.value.normalized);
  assert.equal(a.value.ruleId, NORMALIZATION_RULES.VALUE_NUMERIC_SEPARATOR_V1);
});

test("normalizeValueUnit expands an explicitly declared multiplier suffix", () => {
  const a = normalizeValueUnit({ value: "$12m" });
  const b = normalizeValueUnit({ value: "$12,000,000" });
  assert.equal(a.value.normalized, b.value.normalized);
  assert.equal(a.value.ruleId, NORMALIZATION_RULES.VALUE_DECLARED_MULTIPLIER_V1);
});

test("normalizeValueUnit never erases a genuine value difference", () => {
  const a = normalizeValueUnit({ value: "17", unit: "%" });
  const b = normalizeValueUnit({ value: "12", unit: "%" });
  assert.notEqual(a.value.normalized, b.value.normalized);
});

test("compareField never normalizes metric semantically", () => {
  const result = compareField("metric", "gross revenue", "revenue");
  assert.equal(result.status, "mismatched");
});

test("compareValueUnit: same unit, genuinely different value stays a value mismatch (not silently matched)", () => {
  const result = compareValueUnit({ value: "17", unit: "%" }, { value: "12", unit: "%" });
  assert.equal(result.unitStatus, "matched");
  assert.equal(result.valueEqual, false);
});

test("compareValueUnit: a claimed unit with no evidence unit at all is a hard mismatch", () => {
  const result = compareValueUnit({ value: "17", unit: "%" }, { value: "17" });
  assert.equal(result.unitStatus, "mismatched");
});

// ---------------------------------------------------------------------------
// Optional corporate suffix — locked case 2's actual root cause, 2026-09-03.
//
// The claim side and evidence side are extracted from different texts by
// different prompts and legitimately disagree on how much of a name to
// include ("Acme" vs "Acme Corp"). Both are faithful; neither is wrong. The
// comparator has to bridge them or the system fails whenever a source uses a
// fuller legal name than the answer does — which is the normal case.
//
// The negative cases below matter more than the positive one. This is the
// only entity rule that can make unequal strings match, so each boundary it
// must NOT cross is pinned explicitly.
// ---------------------------------------------------------------------------

test("compareField(entity) matches a bare name against the same name with a corporate suffix", () => {
  assert.equal(compareField("entity", "Acme", "Acme Corp").status, "matched");
  assert.equal(compareField("entity", "Acme Corp", "Acme").status, "matched");
  assert.equal(compareField("entity", "Apple", "Apple Inc.").status, "matched");
  assert.equal(compareField("entity", "Acme", "Acme Corporation").status, "matched");
});

test("compareField(entity) records the rule that fired, so a match is never silent", () => {
  const c = compareField("entity", "Acme", "Acme Corp");
  assert.equal(c.claimed.ruleId, NORMALIZATION_RULES.ENTITY_OPTIONAL_SUFFIX_V1);
  assert.equal(c.evidence.ruleId, NORMALIZATION_RULES.ENTITY_OPTIONAL_SUFFIX_V1);
});

test("compareField(entity) still separates two DIFFERENT suffixes — the dangerous case", () => {
  // "Acme Corp" and "Acme Inc" can be genuinely different legal entities.
  // Both sides carry a suffix, so neither is stripped.
  assert.equal(compareField("entity", "Acme Corp", "Acme Inc").status, "mismatched");
  assert.equal(compareField("entity", "Acme LLC", "Acme Ltd").status, "mismatched");
});

test("compareField(entity) does not strip qualifiers that are not corporate suffixes", () => {
  assert.equal(compareField("entity", "Acme", "Acme Holdings").status, "mismatched");
  assert.equal(compareField("entity", "Acme", "Acme US").status, "mismatched");
  assert.equal(compareField("entity", "Acme", "Acme Europe").status, "mismatched");
});

test("compareField(entity) leaves locked case 6 (wrong entity) untouched", () => {
  // Neither side carries a suffix; nothing is stripped; the flagship
  // wrong-entity distractor still fails, which is the whole point of the
  // applicability gate.
  assert.equal(compareField("entity", "Acme", "market").status, "mismatched");
  assert.equal(compareField("entity", "Acme Corp", "market").status, "mismatched");
});

test("compareField(entity) never reduces a name to nothing", () => {
  // A bare suffix is not an entity. "Corp" must not become "" and match
  // some other empty base.
  assert.equal(compareField("entity", "Corp", "Acme").status, "mismatched");
  assert.equal(compareField("entity", "Inc", "Corp").status, "mismatched");
});

test("the optional-suffix rule applies to entity only, not to other string fields", () => {
  // metric/scope/modality must stay strict — "gross revenue" never equals
  // "revenue" (§ Verification pipeline step 5).
  assert.equal(compareField("metric", "revenue", "revenue corp").status, "mismatched");
  assert.equal(compareField("scope", "retail", "retail inc").status, "mismatched");
});
