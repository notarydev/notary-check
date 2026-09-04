// The rule that lets a robust conflict survive an ambiguous field.
//
// The negative cases are the ones that matter. This rule can only ever move a
// claim from INDETERMINATE toward CONTRADICTED, so every false positive here
// is Notary asserting a contradiction it has not earned — the most expensive
// error the product can make.

import assert from "node:assert/strict";
import { test } from "node:test";
import { assessAmbiguity } from "./immaterialAmbiguity.ts";

test("the live case: 500 feet against 151 and 305 — neither matches", () => {
  const v = assessAmbiguity("500 feet", ["151 feet 1 inch", "305 feet 1 inch"]);
  assert.equal(v.material, false);
  if (v.material === false) assert.equal(v.reason, "all_candidates_conflict");
});

test("a matching candidate keeps the ambiguity material", () => {
  // The case that must never regress: one reading supports the claim, so which
  // reading is meant decides the verdict.
  const v = assessAmbiguity("17%", ["17%", "12%"]);
  assert.equal(v.material, true);
  if (v.material) assert.equal(v.reason, "candidate_matches");
});

test("no candidates behaves exactly as before", () => {
  // An older prompt version, or a model that omits the key.
  assert.equal(assessAmbiguity("500 feet", undefined).material, true);
  assert.equal(assessAmbiguity("500 feet", []).material, true);
});

test("a claim asserting nothing can never produce a robust conflict", () => {
  assert.equal(assessAmbiguity(undefined, ["151 feet", "305 feet"]).material, true);
});

test("mismatched units are incomparable, not a conflict", () => {
  // "500 feet" against a candidate in metres tells us nothing without a
  // conversion this module deliberately does not perform. Treating it as a
  // conflict would assert CONTRADICTED on arithmetic we never did.
  const v = assessAmbiguity("500 feet", ["93 meters", "46 meters"]);
  assert.equal(v.material, true);
  if (v.material) assert.equal(v.reason, "incomparable");
});

test("one conflicting and one incomparable candidate stays material", () => {
  // Unanimity is required. A single candidate we cannot compare is enough to
  // keep the stricter outcome.
  const v = assessAmbiguity("500 feet", ["151 feet", "93 meters"]);
  assert.equal(v.material, true);
});

test("non-numeric values compare as strings, strictly", () => {
  assert.equal(assessAmbiguity("Acme Corp", ["Beta Corp", "Gamma Inc"]).material, false);
  assert.equal(assessAmbiguity("Acme Corp", ["Acme Corp", "Beta Corp"]).material, true);
});

test("a substring match counts as a match, not a conflict", () => {
  // "revenue" against "gross revenue" is not a difference we can stand behind.
  const v = assessAmbiguity("revenue", ["gross revenue", "net revenue"]);
  assert.equal(v.material, true);
  if (v.material) assert.equal(v.reason, "candidate_matches");
});

test("a single conflicting candidate is enough when it is the only one", () => {
  const v = assessAmbiguity("500", ["305"]);
  assert.equal(v.material, false);
});

test("equal numbers written differently still match", () => {
  const v = assessAmbiguity("1500", ["1,500", "2,000"]);
  assert.equal(v.material, true);
});

test("empty-string candidates are incomparable", () => {
  assert.equal(assessAmbiguity("500 feet", ["", "305 feet"]).material, true);
});

test("a square measure never reduces to its linear unit", () => {
  // The risk in collapsing compound units: "meters squared" must NOT be
  // treated as "meters", or an area would be compared against a length.
  const v = assessAmbiguity("500 meters", ["93 meters squared", "46 meters squared"]);
  assert.equal(v.material, true);
  if (v.material) assert.equal(v.reason, "incomparable");
});

test("compound units on both sides still compare", () => {
  const v = assessAmbiguity("500 feet 2 inches", ["151 feet 1 inch", "305 feet 1 inch"]);
  assert.equal(v.material, false);
});

test("the same compound measurement matches rather than conflicts", () => {
  const v = assessAmbiguity("151 feet", ["151 feet 1 inch", "305 feet 1 inch"]);
  assert.equal(v.material, true, "151 ft and 151 ft 1 in are the same measurement");
});

test("the REAL judge output, verbatim — with conversion parentheticals", () => {
  // Captured from a live v3 judge call on the Statue of Liberty passage. The
  // idealised fixture above passed while this failed, because the real strings
  // carry "(46 meters)" and the unit comparison treated that as part of the
  // unit. Fixtures that are cleaner than production hide exactly this.
  const v = assessAmbiguity("500 feet", ["151 feet 1 inch (46 meters)", "305 feet 1 inch (93 meters)"]);
  assert.equal(v.material, false, "neither reading is 500 feet, so the conflict is robust");
});

test("a parenthetical does not let genuinely different units compare", () => {
  const v = assessAmbiguity("500 feet", ["93 meters (305 feet)", "46 meters (151 feet)"]);
  assert.equal(v.material, true, "the primary unit is metres; we do not convert");
});
