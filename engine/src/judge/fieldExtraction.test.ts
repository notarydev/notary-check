// Unit tests for the Chain-of-Verification field extractor
// (engine/src/judge/fieldExtraction.ts). All judge responses are mocked — no
// real network. Focus: blind answering (the claim's value can never reach the
// model), evidence delimiting, strict four-outcome parsing (and the rejection
// of anything outside it, including confidence figures), and the pure
// assembleEvidenceFields helper.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ApplicabilityField, EvidenceFields } from "../verification/applicability.ts";
import { delimitEvidenceForModel } from "../ingestion/delimitEvidence.ts";
import { DEFAULT_JUDGE_MODEL, type JudgeCallInput, type JudgeCallRecord, type JudgeCallResult, type JudgeClient } from "./judgeClient.ts";
import {
  assembleEvidenceFields,
  extractField,
  parseJudgeAnswer,
  safeParseModelOutput,
  type JudgeFieldAnswer,
} from "./fieldExtraction.ts";

/** A mocked judge client. Passing a string answer produces an `ok` result whose
 * record carries the full provenance, mirroring judgeClient.ts. Passing a
 * JudgeCallResult lets tests inject errors directly. */
function fakeClient(respond: (input: JudgeCallInput) => string | JudgeCallResult): {
  client: JudgeClient;
  calls: JudgeCallInput[];
} {
  const calls: JudgeCallInput[] = [];
  const client: JudgeClient = {
    async call(input: JudgeCallInput): Promise<JudgeCallResult> {
      calls.push(input);
      const answer = respond(input);
      if (typeof answer === "string") {
        return {
          status: "ok",
          record: {
            model: input.model ?? DEFAULT_JUDGE_MODEL,
            promptVersion: input.promptVersion,
            question: input.question,
            evidenceLocator: input.evidenceLocator,
            answer,
          },
        };
      }
      return answer;
    },
  };
  return { client, calls };
}

const EVIDENCE = "Acme Corporation's revenue grew 12% in fiscal 2025.";

const originalKey = process.env.DEEPSEEK_API_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});

test("present: extracts the value and source_span; only present carries a value", async () => {
  const { client } = fakeClient(() =>
    JSON.stringify({
      reasoning: "1. The passage names Acme Corporation. 2. The revenue is attributed to it.",
      outcome: "present",
      value: "Acme Corporation",
      source_span: "Acme Corporation's revenue",
    }),
  );
  const answer = await extractField(EVIDENCE, "entity", { client });
  assert.equal(answer.outcome, "present");
  assert.equal(answer.value, "Acme Corporation");
  assert.equal(answer.sourceSpan, "Acme Corporation's revenue");
  // Provenance is persisted, never dropped.
  assert.equal(answer.record.model, DEFAULT_JUDGE_MODEL);
  assert.equal(answer.record.answer, JSON.stringify({ reasoning: "1. The passage names Acme Corporation. 2. The revenue is attributed to it.", outcome: "present", value: "Acme Corporation", source_span: "Acme Corporation's revenue" }));
});

test("absent: a value the model sneaks in on a non-present outcome is dropped (only present carries a value)", async () => {
  const { client } = fakeClient(() =>
    JSON.stringify({ reasoning: "No comparator is stated.", outcome: "absent", value: "prior year" }),
  );
  const answer = await extractField(EVIDENCE, "comparatorBaseline", { client });
  assert.equal(answer.outcome, "absent");
  assert.equal(answer.value, undefined);
});

test("ambiguous and cannot_be_determined pass through without a value", async () => {
  const { client: clientA } = fakeClient(() =>
    JSON.stringify({ reasoning: "Two periods compete.", outcome: "ambiguous" }),
  );
  const ambiguous = await extractField(EVIDENCE, "period", { client: clientA });
  assert.equal(ambiguous.outcome, "ambiguous");
  assert.equal(ambiguous.value, undefined);

  const { client: clientC } = fakeClient(() =>
    JSON.stringify({ reasoning: "The passage is empty.", outcome: "cannot_be_determined" }),
  );
  const cannot = await extractField(EVIDENCE, "metric", { client: clientC });
  assert.equal(cannot.outcome, "cannot_be_determined");
  assert.equal(cannot.value, undefined);
});

test("the evidence is delimited as data before it reaches the model (locked case 17 guard)", async () => {
  const { client, calls } = fakeClient(() => JSON.stringify({ reasoning: "x", outcome: "absent" }));
  await extractField(EVIDENCE, "modality", { client });

  const userTurn = calls[0].messages[1].content;
  // A real per-call nonce fence, and the raw evidence inside it.
  assert.match(userTurn, /<<<EVIDENCE:[0-9a-f]{16}:START>>>/);
  assert.match(userTurn, /<<<EVIDENCE:[0-9a-f]{16}:END>>>/);
  assert.ok(userTurn.includes(EVIDENCE));
  // The exact delimited output (any nonce) is what the model sees — never raw
  // undelimited evidence sitting bare in the prompt.
  assert.ok(userTurn.startsWith("Extract one property"));
});

test("blind answering: the claim's asserted value can never reach the model", async () => {
  // The flagship claim's split fields are metric "revenue" + operator
  // "increase" — together the claim asserts the fact "revenue growth". That
  // composite phrase, plus "37%" (a stand-in for the value field), is the leak
  // sentinel: neither appears in the evidence ("...grew 12%...") nor in the
  // prompt instructions (the operator criterion mentions "increase" and the
  // evidence contains "revenue", so neither single value is a usable sentinel),
  // so if either ever reached the model it would have to have been passed in
  // from the claim — the blind-answering violation.
  const { client, calls } = fakeClient(() => JSON.stringify({ reasoning: "x", outcome: "absent" }));
  for (const field of ["entity", "period", "metric", "operator", "valueUnit", "comparatorBaseline", "modality", "scope"] as ApplicabilityField[]) {
    await extractField(EVIDENCE, field, { client });
  }
  const allText = calls.map((c) => c.messages.map((m) => m.content).join("\n")).join("\n");
  assert.ok(!allText.includes("revenue growth"), "claim's metric+operator fact must not reach the model");
  assert.ok(!allText.includes("37%"), "claim's value must not reach the model");
});

test("invalid JSON maps to cannot_be_determined, never a crash", async () => {
  const { client } = fakeClient(() => "this is not json at all");
  const answer = await extractField(EVIDENCE, "entity", { client });
  assert.equal(answer.outcome, "cannot_be_determined");
  assert.match(answer.record.error ?? "", /not a valid JSON object/);
});

test("a response that tries to sneak in a confidence figure is rejected → cannot_be_determined", async () => {
  const { client } = fakeClient(() =>
    JSON.stringify({ reasoning: "x", outcome: "present", value: "12%", confidence: 0.99 }),
  );
  const answer = await extractField(EVIDENCE, "valueUnit", { client });
  assert.equal(answer.outcome, "cannot_be_determined");
  assert.match(answer.record.error ?? "", /failed schema validation/);
});

test("an outcome outside the four vocabulary is rejected → cannot_be_determined", async () => {
  const { client } = fakeClient(() => JSON.stringify({ reasoning: "x", outcome: "partially_supported" }));
  const answer = await extractField(EVIDENCE, "entity", { client });
  assert.equal(answer.outcome, "cannot_be_determined");
});

test("present without a value is rejected → cannot_be_determined", async () => {
  const { client } = fakeClient(() => JSON.stringify({ reasoning: "x", outcome: "present" }));
  const answer = await extractField(EVIDENCE, "entity", { client });
  assert.equal(answer.outcome, "cannot_be_determined");
});

test("missing step-by-step reasoning is rejected → cannot_be_determined", async () => {
  const { client } = fakeClient(() => JSON.stringify({ outcome: "absent" }));
  const answer = await extractField(EVIDENCE, "entity", { client });
  assert.equal(answer.outcome, "cannot_be_determined");
});

test("a client error result maps to cannot_be_determined with the error preserved", async () => {
  const { client } = fakeClient(() => ({
    status: "error" as const,
    record: { model: DEFAULT_JUDGE_MODEL, promptVersion: "v", question: "q", error: "judge_http_500" },
  }));
  const answer = await extractField(EVIDENCE, "entity", { client });
  assert.equal(answer.outcome, "cannot_be_determined");
  assert.equal(answer.record.error, "judge_http_500");
});

test("a client that throws maps to cannot_be_determined — extractField never crashes", async () => {
  const client: JudgeClient = {
    async call(): Promise<never> {
      throw new Error("provider down");
    },
  };
  const answer = await extractField(EVIDENCE, "entity", { client });
  assert.equal(answer.outcome, "cannot_be_determined");
  assert.match(answer.record.error ?? "", /provider down/);
});

test("no DEEPSEEK_API_KEY configured and no injected client → cannot_be_determined, not a crash", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  const answer = await extractField(EVIDENCE, "entity");
  assert.equal(answer.outcome, "cannot_be_determined");
  assert.match(answer.record.error ?? "", /DEEPSEEK_API_KEY/);
});

test("safeParseModelOutput tolerates a ```json fence around the object", () => {
  const result = safeParseModelOutput('```json\n{"reasoning":"x","outcome":"present","value":"Acme"}\n```');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.value, "Acme");
});

test("parseJudgeAnswer deterministically upgrades modality 'absent' to present/actual", () => {
  const raw = JSON.stringify({ reasoning: "no marker stated", outcome: "absent" });
  const result = parseJudgeAnswer(raw, "modality", {} as JudgeCallRecord);
  assert.equal(result.outcome, "present");
  assert.equal(result.value, "actual");
});

test("parseJudgeAnswer leaves non-modality 'absent' outcomes untouched", () => {
  const raw = JSON.stringify({ reasoning: "no baseline stated", outcome: "absent" });
  const result = parseJudgeAnswer(raw, "comparatorBaseline", {} as JudgeCallRecord);
  assert.equal(result.outcome, "absent");
  assert.equal(result.value, undefined);
});

test("parseJudgeAnswer leaves an explicit modality marker untouched", () => {
  const raw = JSON.stringify({ reasoning: "states 'estimated'", outcome: "present", value: "estimated" });
  const result = parseJudgeAnswer(raw, "modality", {} as JudgeCallRecord);
  assert.equal(result.outcome, "present");
  assert.equal(result.value, "estimated");
});

test("assembleEvidenceFields: present → value, everything else → undefined, valueUnit parsed", () => {
  const answers: JudgeFieldAnswer[] = [
    { field: "entity", outcome: "present", value: "Acme", record: {} as JudgeCallRecord },
    { field: "period", outcome: "present", value: "FY25", record: {} as JudgeCallRecord },
    { field: "valueUnit", outcome: "present", value: "17%", record: {} as JudgeCallRecord },
    { field: "metric", outcome: "absent", record: {} as JudgeCallRecord },
    { field: "comparatorBaseline", outcome: "ambiguous", record: {} as JudgeCallRecord },
    { field: "modality", outcome: "cannot_be_determined", record: {} as JudgeCallRecord },
  ];
  const evidence = assembleEvidenceFields(answers);
  assert.deepEqual(evidence, {
    entity: "Acme",
    period: "FY25",
    valueUnit: { value: "17", unit: "%" },
  } as EvidenceFields);
  assert.equal(evidence.metric, undefined);
  assert.equal(evidence.scope, undefined);
});
