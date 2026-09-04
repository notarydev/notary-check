// The ask for a source. Before this existed, `Gap`'s `addressable_source` kind
// was declared and never emitted by anything — so on an answer with five
// unsourced claims Notary produced zero gaps and never once said what would
// make them checkable.

import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceGapDetector } from "./sourceGap.ts";
import { runDetectors } from "./registry.ts";
import type { DetectorInput } from "./types.ts";

function input(over: Partial<DetectorInput> = {}): DetectorInput {
  return { answerText: "", claims: [], hasResolvedEvidence: false, ...over };
}

const claim = (id: string, text: string, materiality = true) => ({ id, text, fields: {}, materiality });

test("a material claim with no resolved evidence produces a source gap", () => {
  const out = sourceGapDetector.run(
    input({ claims: [claim("c1", "50k writes/sec is exactly what DynamoDB is built for.")] }),
  );
  assert.equal(out.status, "missing_input");
  if (out.status !== "missing_input") return;
  assert.equal(out.gaps.length, 1);
  assert.equal(out.gaps[0].missing, "addressable_source");
  assert.equal(out.gaps[0].claimId, "c1");
});

test("the gap says what becomes possible, never what to do", () => {
  // An imperative here would be an instruction inside data, which Claude
  // correctly refuses — the exact bug that had to be removed from the tool
  // response earlier. A gap is a fact; only Track 2 turns it into an ask.
  const out = sourceGapDetector.run(input({ claims: [claim("c1", "Revenue grew 17% in FY25.")] }));
  assert.equal(out.status, "missing_input");
  if (out.status !== "missing_input") return;
  assert.ok(
    !/^(please|send|attach|supply|provide|call|give)\b/i.test(out.gaps[0].unblocks),
    "a gap must not be phrased as a command",
  );
  assert.ok(out.gaps[0].unblocks.startsWith("check "), "it states what would become checkable");
});

test("capped at two — each gap can cost a whole round trip", () => {
  const out = sourceGapDetector.run(
    input({ claims: [claim("a", "One."), claim("b", "Two."), claim("c", "Three."), claim("d", "Four.")] }),
  );
  assert.equal(out.status, "missing_input");
  if (out.status !== "missing_input") return;
  assert.equal(out.gaps.length, 2, "ten unsourced claims must not become ten round trips");
});

test("long claim text is truncated so the ask stays readable", () => {
  const long = "A".repeat(300);
  const out = sourceGapDetector.run(input({ claims: [claim("c1", long)] }));
  assert.equal(out.status, "missing_input");
  if (out.status !== "missing_input") return;
  assert.ok(out.gaps[0].unblocks.length < 140);
  assert.ok(out.gaps[0].unblocks.includes("…"));
});

// --- must NOT ask ---------------------------------------------------------

test("evidence was supplied and resolved — nothing to ask for", () => {
  // The checking machinery ran. Any failure after that is source_verify's own
  // result to report, not a missing input.
  const out = sourceGapDetector.run(
    input({ claims: [claim("c1", "Revenue grew 17%.")], hasResolvedEvidence: true }),
  );
  assert.equal(out.status, "not_applicable");
});

test("no material claim — a source would not help, so we do not ask", () => {
  const out = sourceGapDetector.run(input({ claims: [claim("c1", "Here are some options.", false)] }));
  assert.equal(out.status, "not_applicable", "asking for input that cannot change anything is the thing to avoid");
});

test("no claims at all is not_applicable, never a gap", () => {
  assert.equal(sourceGapDetector.run(input()).status, "not_applicable");
});

// --- through the bank -----------------------------------------------------

test("the bank now emits source gaps end to end", () => {
  // The regression that matters: before this detector was registered, this
  // exact input produced zero gaps.
  const r = runDetectors(
    input({
      answerText: "DynamoDB handles 50k writes/sec. Postgres would need a very large instance.",
      userRequest: "Postgres or DynamoDB for an audit log?",
      claims: [claim("c1", "DynamoDB handles 50k writes/sec."), claim("c2", "Postgres would need a very large instance.")],
    }),
  );
  assert.equal(r.gaps.length, 2);
  assert.ok(r.gaps.every((g) => g.missing === "addressable_source"));
  assert.equal(r.findings.length, 0, "a gap is not a finding — nothing was established wrong");
});
