// Self-contradiction detector. The negative cases matter more than the
// positive one — this detector reads the answer alone, so it fires on the
// broadest set of turns of anything in the bank (~39% have material), and a
// false positive here is Notary being wrong about ordinary careful writing.

import assert from "node:assert/strict";
import { test } from "node:test";
import { selfContradictionDetector } from "./selfContradiction.ts";
import type { DetectorInput } from "./types.ts";
import type { ClaimFields } from "../verification/applicability.ts";

function input(claims: Array<{ text: string; fields: ClaimFields }>): DetectorInput {
  return {
    answerText: claims.map((c) => c.text).join(" "),
    claims: claims.map((c, i) => ({ id: `c${i}`, text: c.text, fields: c.fields, materiality: true, hasResolvedEvidence: false })),
  };
}

const ACME = { entity: "Acme", period: "FY25", metric: "revenue", operator: "increase" };

test("catches the same measure asserted with two different values", () => {
  const out = selfContradictionDetector.run(
    input([
      { text: "Acme's revenue grew 17% in FY25.", fields: { ...ACME, valueUnit: { value: "17", unit: "%" } } },
      { text: "Acme's revenue grew 12% in FY25.", fields: { ...ACME, valueUnit: { value: "12", unit: "%" } } },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].type, "internal_conflict");
  assert.equal(out.findings[0].owner, "computed");
  assert.ok(out.findings[0].fieldDeltas.some((d) => d.field === "valueUnit"));
});

test("catches an opposite direction on the same measure", () => {
  const out = selfContradictionDetector.run(
    input([
      { text: "Revenue grew in FY25.", fields: { ...ACME, operator: "increase" } },
      { text: "Revenue declined in FY25.", fields: { ...ACME, operator: "decrease" } },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 1, "an operator conflict on the same measure is a contradiction");
});

// --- the false positives this must NOT produce ---------------------------

test("a narrowed scope is a qualification, not a contradiction", () => {
  // The single most important negative case. "Excluding one-time items" is
  // how careful writing works; treating it as self-contradiction would make
  // Notary wrong about good answers, which is worse than missing bad ones.
  const out = selfContradictionDetector.run(
    input([
      { text: "Revenue grew 17% in FY25.", fields: { ...ACME, valueUnit: { value: "17", unit: "%" } } },
      {
        text: "Excluding one-time items, revenue grew 12% in FY25.",
        fields: { ...ACME, valueUnit: { value: "12", unit: "%" }, scope: "excluding one-time items" },
      },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 0, "a general claim and a scoped claim are not comparable");
});

test("a different baseline is not a contradiction", () => {
  const out = selfContradictionDetector.run(
    input([
      {
        text: "Revenue grew 17% year over year.",
        fields: { ...ACME, valueUnit: { value: "17", unit: "%" }, comparatorBaseline: "prior year" },
      },
      {
        text: "Revenue grew 4% quarter over quarter.",
        fields: { ...ACME, valueUnit: { value: "4", unit: "%" }, comparatorBaseline: "prior quarter" },
      },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 0, "different baselines measure different things");
});

test("a hedged claim and an asserted claim are not compared", () => {
  const out = selfContradictionDetector.run(
    input([
      { text: "Revenue may grow 17%.", fields: { ...ACME, valueUnit: { value: "17", unit: "%" }, modality: "may" } },
      { text: "Revenue grew 12%.", fields: { ...ACME, valueUnit: { value: "12", unit: "%" } } },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 0, "a forecast and a reported figure are different assertions");
});

test("claims about different subjects are never compared", () => {
  const out = selfContradictionDetector.run(
    input([
      { text: "Acme's revenue grew 17%.", fields: { ...ACME, valueUnit: { value: "17", unit: "%" } } },
      {
        text: "Beta Corp's revenue grew 12%.",
        fields: { ...ACME, entity: "Beta Corp", valueUnit: { value: "12", unit: "%" } },
      },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 0, "different entities block before any value comparison");
});

test("different metrics are never compared", () => {
  const out = selfContradictionDetector.run(
    input([
      { text: "Revenue grew 17%.", fields: { ...ACME, valueUnit: { value: "17", unit: "%" } } },
      { text: "Headcount grew 12%.", fields: { ...ACME, metric: "headcount", valueUnit: { value: "12", unit: "%" } } },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 0);
});

test("agreeing claims produce nothing", () => {
  const out = selfContradictionDetector.run(
    input([
      { text: "Revenue grew 17% in FY25.", fields: { ...ACME, valueUnit: { value: "17", unit: "%" } } },
      { text: "FY25 revenue was up 17%.", fields: { ...ACME, valueUnit: { value: "17", unit: "%" } } },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 0, "restating the same figure is not a conflict");
});

test("a claim missing identity fields is skipped, not guessed at", () => {
  const out = selfContradictionDetector.run(
    input([
      { text: "It grew a lot.", fields: {} },
      { text: "Revenue grew 17% in FY25.", fields: { ...ACME, valueUnit: { value: "17", unit: "%" } } },
    ]),
  );
  assert.equal(out.status, "not_applicable", "one identifiable claim is not enough to contradict anything");
});

test("no claims at all is not_applicable, never missing_input", () => {
  // There is no ask that would fix "this answer contains no claims", so this
  // must never become a gap — otherwise we would ask users for input that
  // cannot help.
  const out = selfContradictionDetector.run(input([]));
  assert.equal(out.status, "not_applicable");
});

// --- the live false positive -----------------------------------------------
//
// Production, 2026-09-05: two rows of a pricing table were reported as a
// self-contradiction —
//
//   "| **GCP** (Premium Tier) | $0.12 | 1 GB/month | ..."
//   "| **GCP** (Standard Tier) | $0.085 | 200 GB/month | ..."
//
// They are two products, not a conflict. Claude acted on the finding and ran an
// unnecessary search, which is worse than saying nothing.
//
// The guard was always here — couldCompare refuses to compare claims whose
// scopes differ. It could not fire because the tier lived in the claim TEXT and
// never reached the scope FIELD. The extraction prompt now states that a tier,
// plan or variant IS a scope; this asserts the detector half.

test("two pricing tiers of the same product are not a contradiction", () => {
  const out = selfContradictionDetector.run(
    input([
      {
        text: "| **GCP** (Premium Tier) | $0.12 | 1 GB/month |",
        fields: { entity: "GCP", period: "FY25", metric: "egress pricing", scope: "Premium Tier", valueUnit: { value: "0.12", unit: "/GB" } },
      },
      {
        text: "| **GCP** (Standard Tier) | $0.085 | 200 GB/month |",
        fields: { entity: "GCP", period: "FY25", metric: "egress pricing", scope: "Standard Tier", valueUnit: { value: "0.085", unit: "/GB" } },
      },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 0, "differing scopes must never be compared — they measure different things");
});

test("but the same tier with two different prices IS still a contradiction", () => {
  // The guard must not become a blanket excuse. Same scope, same everything,
  // conflicting values — this must still fire, or the fix has disarmed the
  // detector rather than corrected it.
  const out = selfContradictionDetector.run(
    input([
      {
        text: "GCP Premium Tier egress is $0.12/GB.",
        fields: { entity: "GCP", period: "FY25", metric: "egress pricing", scope: "Premium Tier", valueUnit: { value: "0.12", unit: "/GB" } },
      },
      {
        text: "GCP Premium Tier egress is $0.15/GB.",
        fields: { entity: "GCP", period: "FY25", metric: "egress pricing", scope: "Premium Tier", valueUnit: { value: "0.15", unit: "/GB" } },
      },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 1, "a real conflict within one scope must still be caught");
});
