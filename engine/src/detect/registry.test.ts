// The bank's own guarantees, independent of any individual detector:
// isolation, deterministic ordering, and the three-outcome distinction.

import assert from "node:assert/strict";
import { test } from "node:test";
import { runDetectors } from "./registry.ts";
import type { DetectorInput } from "./types.ts";

const ACME = { entity: "Acme", period: "FY25", metric: "revenue", operator: "increase" };

function input(over: Partial<DetectorInput> = {}): DetectorInput {
  return { answerText: "", claims: [], ...over };
}

test("a clean answer produces no findings and no gaps", () => {
  const r = runDetectors(input({ answerText: "Here are three approaches to the retry problem." }));
  assert.equal(r.findings.length, 0);
  assert.equal(r.gaps.length, 0);
});

test("findings from several detectors are collected together and ordered by rank", () => {
  const r = runDetectors(
    input({
      answerText: "I've fixed it and all tests pass.",
      executionResults: [{ ref: "t1", text: "# fail 2" }],
      claims: [
        { id: "a", text: "Revenue grew 17% in FY25.", fields: { ...ACME, valueUnit: { value: "17", unit: "%" } }, materiality: true, hasResolvedEvidence: false },
        { id: "b", text: "Revenue grew 12% in FY25.", fields: { ...ACME, valueUnit: { value: "12", unit: "%" } }, materiality: true, hasResolvedEvidence: false },
      ],
    }),
  );
  assert.equal(r.findings.length, 2, "both detectors contribute");
  // self_report ranks 15, self_contradiction 20 — a false success claim is
  // acted on sooner than an internal inconsistency.
  assert.equal(r.findings[0].detector, "self_report");
  assert.equal(r.findings[1].detector, "self_contradiction");
});

test("a gap and a finding can coexist — they are different outputs", () => {
  const r = runDetectors(
    input({
      // success claim with no output -> gap from self_report
      answerText: "I've fixed it and all tests pass.",
      claims: [
        { id: "a", text: "Revenue grew 17% in FY25.", fields: { ...ACME, valueUnit: { value: "17", unit: "%" } }, materiality: true, hasResolvedEvidence: false },
        { id: "b", text: "Revenue grew 12% in FY25.", fields: { ...ACME, valueUnit: { value: "12", unit: "%" } }, materiality: true, hasResolvedEvidence: false },
      ],
    }),
  );
  // self_report wants execution output; sourceGap wants a source for each of
  // the two claims. Different detectors, different missing inputs, all facts.
  assert.ok(r.gaps.some((g) => g.missing === "execution_result"), "self_report wants execution output");
  assert.ok(r.gaps.some((g) => g.missing === "addressable_source"), "sourceGap wants a source");
  assert.equal(r.findings.length, 1, "self_contradiction still fires independently");
});

test("every detector reports an outcome, including not_applicable", () => {
  const r = runDetectors(input({ answerText: "A short neutral statement with nothing to check." }));
  assert.equal(r.outcomes.length, 3, "one row per registered detector, always");
  assert.ok(
    r.outcomes.every((o) => o.status === "not_applicable"),
    "no claims and no tool output means nothing is applicable — and nothing to ask for either",
  );
});

test("no finding carries anything that could be read as a verdict", () => {
  // The structural half of the authority boundary: a detector that wanted to
  // assign a verification state has nowhere to put it.
  const r = runDetectors(
    input({
      answerText: "I've fixed it and all tests pass.",
      executionResults: [{ ref: "t1", text: "# fail 2" }],
    }),
  );
  for (const f of r.findings) {
    const keys = Object.keys(f);
    for (const banned of ["state", "verdict", "confidence", "score", "supported"]) {
      assert.ok(!keys.includes(banned), `Finding must not carry "${banned}"`);
    }
  }
});
