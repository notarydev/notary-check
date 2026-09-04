// Act / Move — hand-written fixture suite (§ build order step 3-4;
// Part 11 § Move cardinality and the six-layer guardrail architecture).
//
// Exercises steps 1-3 (types, policy, validator) with NO model call, NO
// network, and NO database — pure fixtures against hand-written example
// outputs, proving the SHAPE of the contract (including all six guardrail
// layers) is right before a model is ever wired in. One case per layer,
// plus the 7 adversarial-style structural cases from Part 11 that a real
// model call would also need to survive.

import assert from "node:assert/strict";
import { test } from "node:test";
import { getAllowedMoves, POLICY_VERSION } from "./policy.ts";
import type { MoveKind } from "./types.ts";
import {
  boundaryPreserved,
  findAuthorityViolation,
  looksLikeRequest,
  MAX_PROMPT_CHARS,
  MAX_SHORT_LABEL_CHARS,
  MAX_SUGGESTIONS,
  validateMoveOutput,
} from "./validator.ts";

const ALL_MOVES: readonly MoveKind[] = ["clarify", "test", "compare", "repair"];

function item(overrides: Partial<{ id: string; short_label: string; move: string; prompt: string }> = {}) {
  return {
    id: overrides.id ?? "s1",
    short_label: overrides.short_label ?? "Check this before proceeding",
    move: overrides.move ?? "clarify",
    prompt: overrides.prompt ?? "Ask which environment this needs to run in.",
  };
}

// --- basic shape: 0, 1, 2 moves ---------------------------------

test("zero moves is a valid, non-error result", () => {
  const result = validateMoveOutput({ moves: [] }, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.moves.length, 0);
});

test("one valid move passes for each of the four moves", () => {
  for (const move of ALL_MOVES) {
    const result = validateMoveOutput(
      { moves: [item({ move, prompt: `Test whether the ${move} case still holds.` })] },
      { allowedMoves: ALL_MOVES },
    );
    assert.equal(result.ok, true, `expected ${move} to pass`);
    if (result.ok) {
      assert.equal(result.moves[0].move, move);
    }
  }
});

test("two distinct valid moves pass together", () => {
  const result = validateMoveOutput(
    {
      moves: [
        item({ id: "a", short_label: "Ambiguous architecture choice", move: "clarify", prompt: "Ask which deployment target this needs to support." }),
        item({ id: "b", short_label: "Failure mode untested", move: "test", prompt: "Run the failure-mode test before shipping this." }),
      ],
    },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.moves.length, 2);
});

test("more than MAX_SUGGESTIONS items is rejected", () => {
  const result = validateMoveOutput(
    {
      moves: [
        item({ id: "a" }),
        item({ id: "b", short_label: "Second thing" }),
        item({ id: "c", short_label: "Third thing" }),
      ],
    },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
  assert.equal(MAX_SUGGESTIONS, 2);
});

// --- layer 2: policy-set enforcement -------------------------------------

test("a structurally valid move outside the allowed set is rejected", () => {
  const result = validateMoveOutput(
    { moves: [item({ move: "repair", prompt: "Fix the broken premise now." })] },
    { allowedMoves: ["clarify", "test", "compare"] }, // repair intentionally excluded
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not in the allowed set/);
});

test("a move outside the four-move vocabulary entirely is rejected", () => {
  for (const badMove of ["answer", "summarize", "research"]) {
    const result = validateMoveOutput(
      { moves: [item({ move: badMove, prompt: "Please look into it further." })] },
      { allowedMoves: ALL_MOVES },
    );
    assert.equal(result.ok, false, `expected "${badMove}" to be rejected`);
  }
});

// --- layer 3: cardinality / structural bounds --------------------------

test("an empty prompt is rejected", () => {
  const result = validateMoveOutput({ moves: [item({ prompt: "" })] }, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, false);
});

test("an empty short_label is rejected", () => {
  const result = validateMoveOutput({ moves: [item({ short_label: "" })] }, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, false);
});

test("a prompt over MAX_PROMPT_CHARS is rejected; exactly at the limit passes", () => {
  const tooLong = "Test whether " + "x".repeat(MAX_PROMPT_CHARS);
  const result = validateMoveOutput({ moves: [item({ prompt: tooLong })] }, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, false);

  const exactly = "Test " + "x".repeat(MAX_PROMPT_CHARS - 5);
  assert.equal(exactly.length, MAX_PROMPT_CHARS);
  const okResult = validateMoveOutput({ moves: [item({ prompt: exactly })] }, { allowedMoves: ALL_MOVES });
  assert.equal(okResult.ok, true);
});

test("a short_label over MAX_SHORT_LABEL_CHARS is rejected — its own, tighter limit than prompt", () => {
  assert.ok(MAX_SHORT_LABEL_CHARS < MAX_PROMPT_CHARS, "short_label limit must be tighter than prompt's");
  const tooLong = "x".repeat(MAX_SHORT_LABEL_CHARS + 1);
  const result = validateMoveOutput({ moves: [item({ short_label: tooLong })] }, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, false);
});

test("duplicate move ids are rejected", () => {
  const result = validateMoveOutput(
    {
      moves: [
        item({ id: "dup", short_label: "First framing" }),
        item({ id: "dup", short_label: "Second framing" }),
      ],
    },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /duplicate move id/);
});

test("duplicate (move, short_label) pairs are rejected — code checks structural dedup, not semantic distinctness", () => {
  const result = validateMoveOutput(
    {
      moves: [
        item({ id: "a", move: "test", short_label: "Check the failure mode" }),
        item({ id: "b", move: "test", short_label: "check the FAILURE mode" }), // same after normalization
      ],
    },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /duplicate \(move, short_label\)/);
});

test("two items with the SAME move but genuinely different labels are both allowed — code does not forbid same-move pairs", () => {
  const result = validateMoveOutput(
    {
      moves: [
        item({ id: "a", move: "test", short_label: "Test the auth path" }),
        item({ id: "b", move: "test", short_label: "Test the rate limiter" }),
      ],
    },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, true);
});

// --- strict schema: extra key rejects the WHOLE response, not just the item ---

test("an extra key (confidence) on an item rejects the whole response", () => {
  const result = validateMoveOutput(
    { moves: [{ ...item(), confidence: 0.9 }] },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /schema validation/);
});

test("an extra key (verdict) on an item rejects the whole response", () => {
  const result = validateMoveOutput(
    { moves: [{ ...item(), verdict: "supported" }] },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
});

test("an extra top-level key on the response envelope rejects the whole response", () => {
  const result = validateMoveOutput(
    { moves: [item()], reasoning: "I think this is the best move" },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
});

// --- malformed / non-JSON input ------------------------------------------

test("non-JSON input is rejected cleanly, never throws", () => {
  assert.doesNotThrow(() => {
    const result = validateMoveOutput("this is not json at all {{{", { allowedMoves: ALL_MOVES });
    assert.equal(result.ok, false);
  });
});

test("null and undefined input are rejected cleanly, never throw", () => {
  assert.doesNotThrow(() => {
    assert.equal(validateMoveOutput(null, { allowedMoves: ALL_MOVES }).ok, false);
    assert.equal(validateMoveOutput(undefined, { allowedMoves: ALL_MOVES }).ok, false);
  });
});

// --- fenced JSON tolerance (parity with Verify's extractChallengeJson) ---

test("a ```json-fenced valid response is still accepted", () => {
  const fenced = "```json\n" + JSON.stringify({ moves: [item({ move: "test", prompt: "Run the smaller test case first." })] }) + "\n```";
  const result = validateMoveOutput(fenced, { allowedMoves: ALL_MOVES });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.moves[0].move, "test");
});

// --- layer 4: content safety / authority (adversarial-style cases) --------

test("layer 4: a stated verification claim is rejected", () => {
  const result = validateMoveOutput(
    { moves: [item({ prompt: "Compare the totals, since the evidence proves the figure is wrong." })] },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /authority check: verification_claim/);
});

test("layer 4: a confidence figure is rejected", () => {
  const result = validateMoveOutput(
    { moves: [item({ prompt: "Compare these two — I'm 87% confident option A is better." })] },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /confidence_or_score/);
});

test("layer 4: a completed-action claim is rejected", () => {
  const result = validateMoveOutput(
    { moves: [item({ prompt: "I already checked the logs, so just confirm the fix works." })] },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /completed_action/);
});

test("layer 4: an autonomous-action instruction is rejected", () => {
  const result = validateMoveOutput(
    { moves: [item({ prompt: "Search for the latest pricing and send this to the team." })] },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /autonomous_action/);
});

test("findAuthorityViolation is directly testable and returns undefined for clean text", () => {
  assert.equal(findAuthorityViolation("Compare these two approaches on deployment complexity."), undefined);
  assert.equal(findAuthorityViolation("The evidence proves this is wrong."), "verification_claim");
});

// --- layer 6: action-language (adversarial-style cases) -------------------

test("layer 6: a stated conclusion instead of a request is rejected (replacement-answer)", () => {
  const result = validateMoveOutput(
    { moves: [item({ prompt: "The correct architecture is the event-driven one, not the polling one." })] },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /does not read as a request/);
});

test("layer 6: a genuine request passes", () => {
  assert.equal(looksLikeRequest("Compare these two approaches specifically on deployment complexity."), true);
  assert.equal(looksLikeRequest("The authentication layer is causing the failure."), false);
});

// --- layer 5: Track-1 boundary preservation --------------------------

test("boundaryPreserved: true when the boundary text is present verbatim in the prompt", () => {
  const boundary = "the FY2023 filing lists revenue as $4.2M, not $5.1M";
  const prompt = `Given that ${boundary}, do you want to revise the figure in your draft?`;
  assert.equal(boundaryPreserved(prompt, boundary), true);
});

test("boundaryPreserved: false when the boundary text is altered (a paraphrase, or an omission — both read the same to a substring check, documented as this function's honest limit)", () => {
  const boundary = "the FY2023 filing lists revenue as $4.2M, not $5.1M";
  const altered = "the FY2023 filing lists revenue as roughly $4.2M, not $5.1M";
  const prompt = `Given that ${altered}, do you want to revise the figure?`;
  assert.equal(boundaryPreserved(prompt, boundary), false);
});

test("boundaryPreserved: false when the boundary text is entirely absent — this is a PERMITTED case (omission is allowed), not by itself evidence of a violation", () => {
  const boundary = "the contract expired on 2025-01-01";
  const prompt = "Do you want to proceed with the current draft?";
  assert.equal(boundaryPreserved(prompt, boundary), false);
  // The validator deliberately does NOT reject on this alone -- confirmed by
  // the fact that a real item omitting the boundary still validates:
  const result = validateMoveOutput(
    { moves: [item({ prompt: "Ask whether the current draft still needs revision." })] },
    { allowedMoves: ALL_MOVES },
  );
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

// --- adversarial-style structural cases from Part 11, checkable without a model ---

test("adversarial: an item using a move outside a single-move allowed set (allowedMoves={test}) is rejected, even paired with a valid item", () => {
  const result = validateMoveOutput(
    {
      moves: [
        item({ id: "a", move: "test", prompt: "Test the failure mode directly." }),
        item({ id: "b", move: "repair", prompt: "Fix the premise now.", short_label: "Sneaks in repair" }),
      ],
    },
    { allowedMoves: ["test"] },
  );
  assert.equal(result.ok, false, "whole response must be rejected when ANY item violates policy, not just the offending item");
});

test("adversarial: a 'fifth move' the model might invent for an out-of-scope request is rejected", () => {
  const result = validateMoveOutput(
    { moves: [item({ move: "escalate", prompt: "Escalate this to a human reviewer." })] },
    { allowedMoves: ALL_MOVES },
  );
  assert.equal(result.ok, false);
});
