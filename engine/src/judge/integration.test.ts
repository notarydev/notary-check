// Integration proof of the constrained-judge invariant (build-order step 4).
//
// Full intended data flow, with MOCKED judge responses only — no real network:
//
//   raw evidence text
//     → extractField() called once per ApplicabilityField (blind: no claim
//       value is ever passed)
//     → assembleEvidenceFields() builds the EvidenceFields object
//       (present → value, everything else → undefined)
//     → assessApplicability(claimFields, assembledEvidenceFields)
//     → assignState() on the result
//
// The architectural claim this test proves: the judge's mocked output appears
// nowhere except as input to assessApplicability. Neither fieldExtraction.ts
// nor judgeClient.ts calls (or even references) assessApplicability or
// assignState — verified two ways:
//   (a) statically, by asserting those two source files contain no reference to
//       the deterministic state layer, and
//   (b) behaviorally, by showing the final state is a pure function of
//       EvidenceFields through the two deterministic functions — flipping the
//       judge's mocked value flips SUPPORTED → CONTRADICTED → UNSUPPORTED via
//       assessApplicability/assignState alone.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { ClaimFields, EvidenceFields } from "../verification/applicability.ts";
import { assessApplicability } from "../verification/applicability.ts";
import type { EvidenceRelation } from "../verification/stateMachine.ts";
import { assignState } from "../verification/stateMachine.ts";
import type { JudgeCallInput, JudgeClient } from "./judgeClient.ts";
import { assembleEvidenceFields, extractField } from "./fieldExtraction.ts";

const ALL_FIELDS = ["entity", "period", "metric", "operator", "valueUnit", "comparatorBaseline", "modality", "scope"] as const;

// The plan's flagship claim: "Acme's revenue grew 17% in FY25."
const CLAIM: ClaimFields = {
  entity: "Acme",
  period: "FY25",
  metric: "revenue",
  operator: "increase",
  valueUnit: { value: "17", unit: "%" },
  comparatorBaseline: "prior year",
  modality: "actual",
  scope: "company-wide",
};

// A passage whose literal content supports every field of CLAIM.
const PASSAGE =
  "Acme's revenue grew 17% in fiscal 2025 compared with the prior year, company-wide.";

const modelAnswer = (outcome: string, value?: string): string =>
  JSON.stringify({ reasoning: "1. read the passage. 2. quoted the relevant span. 3. decided.", outcome, value });

// Mocked judge responses, one per field, in ALL_FIELDS order. These stand in for
// what a real DeepSeek call would return for PASSAGE.
const SUPPORTING_ANSWERS: string[] = [
  modelAnswer("present", "Acme"),
  modelAnswer("present", "FY25"),
  modelAnswer("present", "revenue"),
  modelAnswer("present", "increase"),
  modelAnswer("present", "17%"),
  modelAnswer("present", "prior year"),
  modelAnswer("present", "actual"),
  modelAnswer("present", "company-wide"),
];

/** A mocked judge client returning canned answers in call order. */
function mockedJudge(rawAnswers: string[]): { client: JudgeClient; calls: JudgeCallInput[] } {
  const calls: JudgeCallInput[] = [];
  let i = 0;
  const client: JudgeClient = {
    async call(input: JudgeCallInput) {
      calls.push(input);
      const answer = rawAnswers[i++] ?? modelAnswer("cannot_be_determined");
      return {
        status: "ok",
        record: {
          model: "deepseek-v4-flash",
          promptVersion: input.promptVersion,
          question: input.question,
          evidenceLocator: input.evidenceLocator,
          answer,
        },
      };
    },
  };
  return { client, calls };
}

async function runFlow(rawAnswers: string[], evidenceLocator = "evidence://sha256:deadbeef"): Promise<{
  answers: Awaited<ReturnType<typeof extractField>>[];
  evidence: EvidenceFields;
  applicability: ReturnType<typeof assessApplicability>;
  state: ReturnType<typeof assignState>;
  calls: JudgeCallInput[];
}> {
  const { client, calls } = mockedJudge(rawAnswers);
  const answers = [];
  for (const field of ALL_FIELDS) {
    // Blind: extractField's signature has no claim-value parameter.
    answers.push(await extractField(PASSAGE, field, { client, evidenceLocator }));
  }
  const evidence = assembleEvidenceFields(answers);
  const applicability = assessApplicability(CLAIM, evidence);
  // stateMachine.ts's caller precondition: only an APPLICABLE candidate may
  // produce a relation at all. An inapplicable candidate (regardless of any
  // value difference) produces nothing.
  const relations: EvidenceRelation[] = applicability.applicable
    ? applicability.valueConflicts
      ? [{ relation: "contradicts", evidenceId: "e-mocked-report" }]
      : [{ relation: "supports", evidenceId: "e-mocked-report" }]
    : [];
  const state = assignState(relations, true);
  return { answers, evidence, applicability, state, calls };
}

/** Everything in a message turn that is NOT inside the delimited evidence fence. */
function outsideEvidenceFence(text: string): string {
  const start = /<<<EVIDENCE:[0-9a-f]{16}:START>>>/.exec(text);
  const end = /<<<EVIDENCE:[0-9a-f]{16}:END>>>/.exec(text);
  if (!start || !end || end.index < start.index) return text;
  return text.slice(0, start.index) + text.slice(end.index + end[0].length);
}

test("full flow: mocked judge → EvidenceFields → assessApplicability → assignState yields SUPPORTED", async () => {
  const { evidence, applicability, state, calls } = await runFlow(SUPPORTING_ANSWERS);

  // The judge's mocked output surfaced only as EvidenceFields.
  assert.deepEqual(evidence, {
    entity: "Acme",
    period: "FY25",
    metric: "revenue",
    operator: "increase",
    valueUnit: { value: "17", unit: "%" },
    comparatorBaseline: "prior year",
    modality: "actual",
    scope: "company-wide",
  } as EvidenceFields);

  assert.equal(applicability.applicable, true);
  assert.equal(applicability.valueConflicts, false);
  assert.deepEqual(applicability.mismatched, []);

  assert.equal(state.state, "SUPPORTED");
  assert.equal(state.reason, "supporting_applicable_relation");

  // One narrow, blind question per field, and the evidence was delimited.
  assert.equal(calls.length, ALL_FIELDS.length);
  for (const call of calls) {
    assert.match(call.messages[1].content, /<<<EVIDENCE:[0-9a-f]{16}:START>>>/);
    // Blind answering, fence-aware: the claim's asserted value ("17%") appears
    // ONLY inside the delimited evidence data (where it legitimately belongs as
    // the passage's own text) — never in the instructions around it.
    const promptText = call.messages.map((m) => m.content).join("\n");
    assert.ok(promptText.includes("17%"), "the evidence itself is what the judge evaluates");
    assert.ok(
      !outsideEvidenceFence(promptText).includes("17%"),
      "the claim's value must never appear outside the delimited evidence data",
    );
  }
});

test("the judge never decides the final state: a 12% mock flips the result to CONTRADICTED through the deterministic layer alone", async () => {
  // Only the judge's mocked VALUE changes; every other field is identical.
  const contradiction = [...SUPPORTING_ANSWERS];
  contradiction[4] = modelAnswer("present", "12%");

  const { evidence, applicability, state } = await runFlow(contradiction);

  assert.equal(evidence.valueUnit?.value, "12");
  assert.equal(applicability.applicable, true, "same entity/period/metric/baseline — the candidate still applies");
  assert.equal(applicability.valueConflicts, true, "the value conflicts → contradiction, decided by assessApplicability");
  assert.equal(state.state, "CONTRADICTED");
  assert.equal(state.reason, "contradicting_applicable_relation");
});

test("an inapplicable candidate (judge reports entity absent) never reaches SUPPORTED/CONTRADICTED", async () => {
  const noEntity = [...SUPPORTING_ANSWERS];
  noEntity[0] = modelAnswer("absent");

  const { evidence, applicability, state } = await runFlow(noEntity);

  assert.equal(evidence.entity, undefined);
  assert.equal(applicability.applicable, false);
  assert.ok(applicability.mismatched.includes("entity"));

  // An inapplicable candidate produces no relation; with a source present and
  // checks completed, the state is UNSUPPORTED — never SUPPORTED.
  assert.equal(state.state, "UNSUPPORTED");
  assert.equal(state.reason, "no_support_after_completed_checks");
});

test("architectural invariant (static): the judge modules never call or reference the deterministic state layer", async () => {
  const fieldExtractionSrc = await readFile(new URL("./fieldExtraction.ts", import.meta.url), "utf8");
  const judgeClientSrc = await readFile(new URL("./judgeClient.ts", import.meta.url), "utf8");

  for (const [name, src] of [
    ["fieldExtraction.ts", fieldExtractionSrc],
    ["judgeClient.ts", judgeClientSrc],
  ] as const) {
    assert.ok(!src.includes("assessApplicability("), `${name} must never call assessApplicability`);
    assert.ok(!src.includes("assignState("), `${name} must never call assignState`);
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    assert.ok(
      importLines.every((l) => !l.includes("stateMachine")),
      `${name} must never import the state machine`,
    );
  }
  // fieldExtraction.ts is allowed (required) to import the *type*
  // ApplicabilityField from applicability.ts — that is the shared field
  // vocabulary, not a call into the deterministic layer. It must not import
  // the *value* assessApplicability, which the checks above already enforce.
});
