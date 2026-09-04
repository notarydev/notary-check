// Architectural invariant for Act, checked STATICALLY over source text —
// the same precedent integration.test.ts already sets for the Verify judge
// modules ("the judge modules never call or reference the deterministic state
// layer"), extended to the Challenge layer.
//
// Why a source-scanning test rather than only a behavioural one: the property
// being protected is "there is no code path by which Act could assign a
// state", and a behavioural test can only show that the paths someone thought
// to exercise did not do so. Reading the source proves the reference does not
// exist at all — a future edit that imports assignState into the challenge
// modules fails here immediately, before anything about its behaviour matters.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  CHALLENGE_ACTIONS,
  CHALLENGE_TYPES,
  MAX_CHALLENGES_PER_CLAIM,
  MAX_CHALLENGES_PER_INVOCATION,
} from "./challengePrompts.ts";

const CHALLENGE_MODULES = ["./challengeGeneration.ts", "./challengePrompts.ts"] as const;

test("static: the Act modules never call or import the deterministic state layer", async () => {
  for (const path of CHALLENGE_MODULES) {
    const src = await readFile(new URL(path, import.meta.url), "utf8");
    assert.ok(!src.includes("assignState("), `${path} must never call assignState`);
    assert.ok(!src.includes("assessApplicability("), `${path} must never call assessApplicability`);
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    assert.ok(
      importLines.every((l) => !l.includes("stateMachine")),
      `${path} must never import the state machine`,
    );
    assert.ok(
      importLines.every((l) => !l.includes("applicability")),
      `${path} must never import the applicability layer`,
    );
  }
});

test("static: the Act modules can reach no database and no network of their own", async () => {
  for (const path of CHALLENGE_MODULES) {
    const src = await readFile(new URL(path, import.meta.url), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    // No pg handle: Act cannot write a claim, an evidence row, or a
    // manifest entry, because it holds no connection with which to try.
    assert.ok(
      importLines.every((l) => !/["']pg["']/.test(l)),
      `${path} must hold no database handle`,
    );
    // No retrieval of its own: the ONLY network egress available to Act is
    // judgeClient.ts's tool-free chat completion. "It silently searches for or
    // adds evidence" is a named Act failure mode (synthesis doc Part 6);
    // this is that failure mode made unreachable rather than merely forbidden.
    assert.ok(!/\bfetch\s*\(/.test(src), `${path} must perform no fetch of its own`);
    assert.ok(
      importLines.every((l) => !l.includes("safeFetch") && !l.includes("resolveEvidence")),
      `${path} must not import any retrieval module`,
    );
  }
});

test("static: no Act source file names a verdict-bearing output field", async () => {
  const src = await readFile(new URL("./challengeGeneration.ts", import.meta.url), "utf8");
  // Guard the SCHEMA specifically: the words appear in prose and in the
  // prompt's prohibitions, so scan only the zod object definitions.
  const schemaBlock = /const CHALLENGE_ITEM_SCHEMA[\s\S]*?const CHALLENGE_OUTPUT_SCHEMA[\s\S]*?\.strict\(\);/.exec(src);
  assert.ok(schemaBlock, "the challenge schemas must be findable");
  for (const forbidden of ["verdict", "confidence", "score", "answer", "transcript"]) {
    assert.ok(
      !schemaBlock[0].includes(forbidden),
      `the Act output schema must define no "${forbidden}" field`,
    );
  }
  // And both levels must be strict, which is what turns an extra key into a
  // rejection rather than a silent drop.
  assert.equal((schemaBlock[0].match(/\.strict\(\)/g) ?? []).length, 2);
});

test("static: review/actForClaim.ts writes only challenge_item and usage_event", async () => {
  // Act moved out of reviewFlow.ts into its own module, so this scans the WHOLE
  // file rather than slicing a function out of the orchestrator — which is a
  // stronger check than the slice it replaces: every line of Act, both layers,
  // is now in scope, not just the one function someone remembered to name.
  const raw = await readFile(new URL("../review/actForClaim.ts", import.meta.url), "utf8");
  // Scan CODE, not prose. This file's own header comment explains that Act
  // cannot reach assignState(), and a naive substring scan would read that
  // sentence as the violation it describes. Stripping comments first is also
  // what makes the check honest: it now proves the call does not exist, rather
  // than proving nobody wrote the word.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    src.includes("export async function runActChallenge") && src.includes("export async function runMovesForClaim"),
    "both Act stages must be in this file — if one moved, this test is scanning the wrong source and is no longer protecting anything",
  );
  // Act may SELECT freely; it may INSERT/UPDATE/DELETE nothing but its own
  // table. usage_event is written through insertUsageEvent, and the Move
  // layer's rows through persist.ts — neither is raw SQL here.
  const writes = src.match(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/g) ?? [];
  assert.deepEqual(writes, ["INSERT INTO challenge_item"]);
  assert.ok(!src.includes("assignState("), "Act must never assign a state");
  assert.ok(!src.includes("assessApplicability("), "Act must never run the applicability check");
  assert.ok(!/\bclaim\b\s+SET/.test(src), "Act must never update the claim row");
});

test("the caps match the product contract exactly", () => {
  assert.equal(MAX_CHALLENGES_PER_CLAIM, 2);
  assert.equal(MAX_CHALLENGES_PER_INVOCATION, 4);
  assert.deepEqual(CHALLENGE_TYPES, [
    "ambiguity",
    "missing_assumption",
    "alternative_interpretation",
    "evidence_request",
    "adversarial_test",
  ]);
  assert.deepEqual(CHALLENGE_ACTIONS, [
    "clarify_claim",
    "add_source",
    "open_evidence",
    "ask_host",
    "draft_test",
    "leave_unchanged",
  ]);
});
