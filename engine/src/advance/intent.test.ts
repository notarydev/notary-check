// Intent inference. The default cases matter as much as the positive ones: a
// WRONG task mode narrows the allowed move set in policy.ts and silently
// removes options that should have been available, whereas defaulting to
// "general" keeps the full four-move set. Guessing is worse than abstaining.

import assert from "node:assert/strict";
import { test } from "node:test";
import { inferIntent } from "./intent.ts";
import { getAllowedMoves } from "./policy.ts";

test("classifies obvious coding requests", () => {
  for (const q of [
    "The retry logic has a bug — can you debug it?",
    "Refactor this class to use dependency injection",
    "Write a unit test for the parser",
  ]) {
    const r = inferIntent(q);
    assert.equal(r.taskMode, "coding", `expected coding for: ${q}`);
    assert.equal(r.defaulted, false);
  }
});

test("classifies research, analysis, writing, strategy and operations", () => {
  const cases: Array<[string, string]> = [
    ["What does the literature say about spaced repetition?", "research"],
    ["Analyse the quarterly revenue figures and reconcile the numbers", "analysis"],
    ["Draft an email announcing the launch", "writing"],
    ["Should we build or buy the billing system?", "strategy"],
    ["Production is down after the migration — walk me through a rollback", "operations"],
  ];
  for (const [q, mode] of cases) {
    assert.equal(inferIntent(q).taskMode, mode, `expected ${mode} for: ${q}`);
  }
});

test("an unrecognised request defaults to general, and says so", () => {
  const r = inferIntent("Help me think about this.");
  assert.equal(r.taskMode, "general");
  assert.equal(r.defaulted, true);
  assert.equal(r.basis, "default");
});

test("an absent request defaults to general and is marked defaulted", () => {
  // The caller uses `defaulted` to decide whether the missing intent is worth
  // asking about — so it must be true here, not merely implied by the mode.
  const r = inferIntent(undefined);
  assert.equal(r.taskMode, "general");
  assert.equal(r.defaulted, true);
});

test("a genuine tie defaults rather than coin-flipping", () => {
  // Mentioning both a failing function and a paper is real ambiguity.
  // Narrowing on tie-break order would remove moves that should stay live.
  const r = inferIntent("The parser function is failing, and the paper says the algorithm is peer-reviewed");
  assert.equal(r.taskMode, "general");
  assert.equal(r.defaulted, true);
});

test("records what decided the classification", () => {
  const r = inferIntent("Fix the failing unit test in the auth module");
  assert.equal(r.basis, "lexical");
  assert.ok(typeof r.matched === "string" && r.matched.length > 0, "the deciding signal must be recorded");
});

test("general never narrows the move set", () => {
  // Documented contract with policy.ts: general resolves to all four moves.
  // This test exists so a future change to inferIntent's default cannot
  // silently start narrowing what Track 2 may propose.
  const r = inferIntent("something unclassifiable");
  assert.equal(r.taskMode, "general");
  assert.deepEqual([...getAllowedMoves(r.taskMode, false)].sort(), ["clarify", "compare", "repair", "test"]);
});
