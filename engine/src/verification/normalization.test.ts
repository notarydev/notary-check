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

test("compareField never normalizes measure semantically", () => {
  const result = compareField("measure", "gross revenue", "revenue");
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
