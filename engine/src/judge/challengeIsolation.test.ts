// Architectural invariant for Track 2, checked STATICALLY over source text —
// the same precedent integration.test.ts already sets for the Track 1 judge
// modules ("the judge modules never call or reference the deterministic state
// layer"), extended to the Challenge layer.
//
// Why a source-scanning test rather than only a behavioural one: the property
// being protected is "there is no code path by which Track 2 could assign a
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

test("static: the Track 2 modules never call or import the deterministic state layer", async () => {
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

test("static: the Track 2 modules can reach no database and no network of their own", async () => {
  for (const path of CHALLENGE_MODULES) {
    const src = await readFile(new URL(path, import.meta.url), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    // No pg handle: Track 2 cannot write a claim, an evidence row, or a
    // manifest entry, because it holds no connection with which to try.
    assert.ok(
      importLines.every((l) => !/["']pg["']/.test(l)),
      `${path} must hold no database handle`,
    );
    // No retrieval of its own: the ONLY network egress available to Track 2 is
    // judgeClient.ts's tool-free chat completion. "It silently searches for or
    // adds evidence" is a named Track 2 failure mode (synthesis doc Part 6);
    // this is that failure mode made unreachable rather than merely forbidden.
    assert.ok(!/\bfetch\s*\(/.test(src), `${path} must perform no fetch of its own`);
    assert.ok(
      importLines.every((l) => !l.includes("safeFetch") && !l.includes("resolveEvidence")),
      `${path} must not import any retrieval module`,
    );
  }
});

test("static: no Track 2 source file names a verdict-bearing output field", async () => {
  const src = await readFile(new URL("./challengeGeneration.ts", import.meta.url), "utf8");
  // Guard the SCHEMA specifically: the words appear in prose and in the
  // prompt's prohibitions, so scan only the zod object definitions.
  const schemaBlock = /const CHALLENGE_ITEM_SCHEMA[\s\S]*?const CHALLENGE_OUTPUT_SCHEMA[\s\S]*?\.strict\(\);/.exec(src);
  assert.ok(schemaBlock, "the challenge schemas must be findable");
  for (const forbidden of ["verdict", "confidence", "score", "answer", "transcript"]) {
    assert.ok(
      !schemaBlock[0].includes(forbidden),
      `the Track 2 output schema must define no "${forbidden}" field`,
    );
  }
  // And both levels must be strict, which is what turns an extra key into a
  // rejection rather than a silent drop.
  assert.equal((schemaBlock[0].match(/\.strict\(\)/g) ?? []).length, 2);
});

test("static: reviewFlow's Track 2 stage writes only challenge_item and usage_event", async () => {
  const src = await readFile(new URL("../review/reviewFlow.ts", import.meta.url), "utf8");
  const stage = src.slice(src.indexOf("async function runTrack2Challenge"));
  assert.ok(stage.length > 0, "the Track 2 stage must be findable");
  // The stage may SELECT freely; it may INSERT/UPDATE/DELETE nothing but its
  // own table. usage_event is written through insertUsageEvent, not raw SQL.
  const writes = stage.match(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/g) ?? [];
  assert.deepEqual(writes, ["INSERT INTO challenge_item"]);
  assert.ok(!stage.includes("assignState("), "the Track 2 stage must never assign a state");
  assert.ok(!/\bclaim\b\s+SET/.test(stage), "the Track 2 stage must never update the claim row");
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
