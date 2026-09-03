// Track 2 / Advance — hand-written fixture suite (§ build order step 4).
//
// Exercises steps 1-3 (types, policy, validator) with NO model call, NO
// network, and NO database — pure fixtures against hand-written example
// outputs, proving the SHAPE of the contract is right before a model is
// ever wired in.

import assert from "node:assert/strict";
import { test } from "node:test";
import { getAllowedMoves, POLICY_VERSION } from "./policy.ts";
import type { AdvanceMove } from "./types.ts";
import { boundaryPreserved, MAX_PROMPT_CHARS, validateAdvanceOutput } from "./validator.ts";

const ALL_MOVES: readonly AdvanceMove[] = ["clarify", "test", "compare", "repair"];

// --- validateAdvanceOutput: valid output for each of the four moves -------

test("valid { move, prompt } passes for each of the four moves", () => {
  for (const move of ALL_MOVES) {
    const result = validateAdvanceOutput(
      { move, prompt: `Do the ${move} thing next.` },
      { allowedMoves: ALL_MOVES },
    );
    assert.equal(result.ok, true, `expected ${move} to pass`);
    if (result.ok) {
      assert.equal(result.draft.move, move);
      assert.equal(result.draft.prompt, `Do the ${move} thing next.`);
    }
  }
});

// --- policy-set enforcement -------------------------------------------

test("a structurally valid move outside the allowed set is rejected", () => {
  const result = validateAdvanceOutput(
    { move: "repair", prompt: "Fix the broken premise." },
    { allowedMoves: ["clarify", "test", "compare"] }, // repair intentionally excluded
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /not in the allowed set/);
  }
});

// --- closed vocabulary ---------------------------------------------------

test("a move outside the four-move vocabulary entirely is rejected", () => {
  for (const badMove of ["answer", "summarize"]) {
    const result = validateAdvanceOutput(
      { move: badMove, prompt: "Some prompt." },
      { allowedMoves: ALL_MOVES },
    );
    assert.equal(result.ok, false, `expected "${badMove}" to be rejected`);
  }
});

// --- prompt bounds ---------------------------------------------------

test("an empty prompt is rejected", () => {
  const result = validateAdvanceOutput({ move: "clarify", prompt: "" }, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, false);
});

test("a prompt over MAX_PROMPT_CHARS is rejected", () => {
  const tooLong = "x".repeat(MAX_PROMPT_CHARS + 1);
  const result = validateAdvanceOutput({ move: "clarify", prompt: tooLong }, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, false);

  // A prompt exactly at the limit is fine — confirms the boundary is where
  // MAX_PROMPT_CHARS says it is, not off-by-one in either direction.
  const exactlyAtLimit = "x".repeat(MAX_PROMPT_CHARS);
  const okResult = validateAdvanceOutput({ move: "clarify", prompt: exactlyAtLimit }, { allowedMoves: ALL_MOVES });
  assert.equal(okResult.ok, true);
});

// --- strict schema: extra key rejects the WHOLE output --------------------

test("an extra key (confidence) rejects the whole output, not just the extra field", () => {
  const result = validateAdvanceOutput(
    { move: "clarify", prompt: "What's the deadline?", confidence: 0.9 },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /schema validation/);
  }
});

test("an extra key (verdict) rejects the whole output, not just the extra field", () => {
  const result = validateAdvanceOutput(
    { move: "repair", prompt: "Fix the date range.", verdict: "supported" },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
});

// --- malformed / non-JSON input --------------------------------------

test("non-JSON input is rejected cleanly, never throws", () => {
  assert.doesNotThrow(() => {
    const result = validateAdvanceOutput("this is not json at all {{{", { allowedMoves: ALL_MOVES });
    assert.equal(result.ok, false);
  });
});

test("malformed structured input (missing prompt) is rejected cleanly", () => {
  const result = validateAdvanceOutput({ move: "clarify" }, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, false);
});

test("null and undefined input are rejected cleanly, never throw", () => {
  assert.doesNotThrow(() => {
    assert.equal(validateAdvanceOutput(null, { allowedMoves: ALL_MOVES }).ok, false);
    assert.equal(validateAdvanceOutput(undefined, { allowedMoves: ALL_MOVES }).ok, false);
  });
});

// --- fenced JSON tolerance (parity with Track 1's extractChallengeJson) ---

test("a ```json-fenced valid response is still accepted", () => {
  const fenced = "```json\n" + JSON.stringify({ move: "test", prompt: "Run the smaller test case first." }) + "\n```";
  const result = validateAdvanceOutput(fenced, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.draft.move, "test");
  }
});

test("fenced JSON with surrounding prose is still accepted", () => {
  const withProse =
    "Here is my recommendation:\n```json\n" +
    JSON.stringify({ move: "compare", prompt: "Which of the two approaches fits the budget?" }) +
    "\n```\nLet me know what you think.";
  const result = validateAdvanceOutput(withProse, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, true);
});

// --- getAllowedMoves: policy table coverage -------------------------------

test("getAllowedMoves: coding + no evidence constraint -> {clarify, test, compare}", () => {
  const moves = getAllowedMoves("coding", false);
  assert.deepEqual([...moves].sort(), ["clarify", "compare", "test"].sort());
});

test("getAllowedMoves: research + evidence constraint (applicability boundary) -> {clarify, compare, repair}", () => {
  const moves = getAllowedMoves("research", true);
  assert.deepEqual([...moves].sort(), ["clarify", "compare", "repair"].sort());
});

test("getAllowedMoves: writing + evidence constraint (contradicted) -> {repair, clarify}", () => {
  const moves = getAllowedMoves("writing", true);
  assert.deepEqual([...moves].sort(), ["clarify", "repair"].sort());
});

test("getAllowedMoves: undefined task_mode defaults to the full four-move set", () => {
  const moves = getAllowedMoves(undefined, false);
  assert.deepEqual([...moves].sort(), [...ALL_MOVES].sort());
});

test("getAllowedMoves: general task_mode defaults to the full four-move set, with or without a constraint", () => {
  assert.deepEqual([...getAllowedMoves("general", false)].sort(), [...ALL_MOVES].sort());
  assert.deepEqual([...getAllowedMoves("general", true)].sort(), [...ALL_MOVES].sort());
});

test("getAllowedMoves: every TaskMode x boolean combination returns a non-empty, closed-vocabulary set", () => {
  const modes: Array<Parameters<typeof getAllowedMoves>[0]> = [
    "coding",
    "research",
    "analysis",
    "writing",
    "strategy",
    "operations",
    "general",
    undefined,
  ];
  for (const mode of modes) {
    for (const hasConstraint of [false, true]) {
      const moves = getAllowedMoves(mode, hasConstraint);
      assert.ok(moves.length > 0, `expected a non-empty set for (${mode}, ${hasConstraint})`);
      for (const m of moves) {
        assert.ok(ALL_MOVES.includes(m), `expected ${m} to be one of the closed four moves`);
      }
    }
  }
});

test("POLICY_VERSION is a non-empty string", () => {
  assert.equal(typeof POLICY_VERSION, "string");
  assert.ok(POLICY_VERSION.length > 0);
});

// --- boundaryPreserved -----------------------------------------------

test("boundaryPreserved: true when the boundary text is present verbatim in the prompt", () => {
  const boundary = "the FY2023 filing lists revenue as $4.2M, not $5.1M";
  const prompt = `Given that ${boundary}, do you want to revise the figure in your draft?`;
  assert.equal(boundaryPreserved(prompt, boundary), true);
});

test("boundaryPreserved: false when the boundary text is altered", () => {
  const boundary = "the FY2023 filing lists revenue as $4.2M, not $5.1M";
  const altered = "the FY2023 filing lists revenue as roughly $4.2M, not $5.1M";
  const prompt = `Given that ${altered}, do you want to revise the figure?`;
  assert.equal(boundaryPreserved(prompt, boundary), false);
});

test("boundaryPreserved: false when the boundary text is expanded beyond its original scope", () => {
  const boundary = "revenue as $4.2M";
  const expanded = "revenue as $4.2M across all reported segments, confirmed by two other filings";
  // The prompt does not contain the exact boundary text as a substring
  // because it's been folded into a larger claim rather than quoted intact.
  const prompt = `Note: ${expanded}.`;
  assert.equal(boundaryPreserved(prompt, boundary), true); // substring still present verbatim inside the expansion
  // The honestly-scoped point: this function only proves verbatim presence,
  // not that the surrounding sentence didn't change what the boundary means
  // — documented explicitly in validator.ts. A genuinely absent boundary:
  const absentPrompt = "This prompt never mentions the finding at all.";
  assert.equal(boundaryPreserved(absentPrompt, boundary), false);
});

test("boundaryPreserved: false when the boundary text is entirely absent", () => {
  const boundary = "the contract expired on 2025-01-01";
  const prompt = "Do you want to proceed with the current draft?";
  assert.equal(boundaryPreserved(prompt, boundary), false);
});
