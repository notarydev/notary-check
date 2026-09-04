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
  return { answerText: "", claims: [], ...over };
}

/** Ungrounded by default — the case this detector exists for. */
const claim = (id: string, text: string, materiality = true) => ({
  id,
  text,
  fields: {},
  materiality,
  hasResolvedEvidence: false,
});

/** The same claim, but one that had a source that resolved. */
const grounded = (id: string, text: string) => ({ ...claim(id, text), hasResolvedEvidence: true });

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
  // response earlier. A gap is a fact; only Act turns it into an ask.
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

test("every material claim had a source that resolved — nothing to ask for", () => {
  // The checking machinery ran on all of them. Any failure after that is
  // source_verify's own result to report, not a missing input.
  const out = sourceGapDetector.run(
    input({ claims: [grounded("c1", "Revenue grew 17%."), grounded("c2", "Margin held at 40%.")] }),
  );
  assert.equal(out.status, "not_applicable");
});

// --- the review-level bug, as a regression -------------------------------

test("one grounded claim does NOT suppress the gap for the ungrounded ones", () => {
  // THE BUG. This detector used to read a single review-wide boolean
  // (`evidenceIds.length > 0`), so one cited claim beside four uncited ones
  // produced zero gaps and Notary said nothing about any of them — silently
  // destroying its most valuable observation, that a particular claim is not
  // grounded. The engine already tracked per-claim no_source; the precision
  // was being flattened at this boundary.
  const out = sourceGapDetector.run(
    input({
      claims: [
        grounded("cited", "Revenue grew 17% in FY25."),
        claim("bare1", "Margin expanded because of the pricing change."),
        claim("bare2", "Churn fell to 3%."),
      ],
    }),
  );
  assert.equal(out.status, "missing_input", "the ungrounded claims still need a source");
  if (out.status !== "missing_input") return;
  assert.deepEqual(
    out.gaps.map((g) => g.claimId),
    ["bare1", "bare2"],
    "gaps are raised for exactly the ungrounded claims, and never for the grounded one",
  );
});

test("the grounded claim is never the one we ask about, even when it sorts first", () => {
  const out = sourceGapDetector.run(
    input({ claims: [grounded("a", "Cited."), claim("b", "Uncited."), claim("c", "Also uncited.")] }),
  );
  assert.equal(out.status, "missing_input");
  if (out.status !== "missing_input") return;
  assert.ok(
    out.gaps.every((g) => g.claimId !== "a"),
    "asking for a source we already have is the one ask that is always wrong",
  );
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
