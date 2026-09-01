// Kill-switch tests (engine/src/judge/killSwitch.ts wired into
// fieldExtraction.extractField). No database, no network — a mocked judge
// client with a call counter proves the switch short-circuits BEFORE the judge
// is ever invoked. Deterministic checks are untouched by design (the switch
// lives only on the judge path).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ApplicabilityField } from "../verification/applicability.ts";
import { extractField } from "./fieldExtraction.ts";
import { isJudgeDisabled } from "./killSwitch.ts";
import type { JudgeCallInput, JudgeClient, JudgeCallResult } from "./judgeClient.ts";

const ALL_FIELDS: ApplicabilityField[] = [
  "entity",
  "period",
  "measure",
  "valueUnit",
  "comparatorBaseline",
  "modality",
  "scope",
];

/** A judge client that counts every call and always answers "absent". */
function countingClient(): { client: JudgeClient; calls: () => number } {
  let calls = 0;
  const client: JudgeClient = {
    async call(_input: JudgeCallInput): Promise<JudgeCallResult> {
      calls += 1;
      return {
        status: "ok",
        record: {
          model: "deepseek-v4-flash",
          promptVersion: "v",
          question: "q",
          answer: JSON.stringify({ reasoning: "x", outcome: "absent" }),
        },
      };
    },
  };
  return { client, calls: () => calls };
}

const ORIG = process.env.NOTARY_JUDGE_KILL_SWITCH;
afterEach(() => {
  if (ORIG === undefined) delete process.env.NOTARY_JUDGE_KILL_SWITCH;
  else process.env.NOTARY_JUDGE_KILL_SWITCH = ORIG;
});

test("isJudgeDisabled: defaults to false (judge enabled), true for 'true'/'1'", () => {
  delete process.env.NOTARY_JUDGE_KILL_SWITCH;
  assert.equal(isJudgeDisabled(), false);
  process.env.NOTARY_JUDGE_KILL_SWITCH = "";
  assert.equal(isJudgeDisabled(), false);
  process.env.NOTARY_JUDGE_KILL_SWITCH = "false";
  assert.equal(isJudgeDisabled(), false);
  process.env.NOTARY_JUDGE_KILL_SWITCH = "0";
  assert.equal(isJudgeDisabled(), false);
  process.env.NOTARY_JUDGE_KILL_SWITCH = "true";
  assert.equal(isJudgeDisabled(), true);
  process.env.NOTARY_JUDGE_KILL_SWITCH = "1";
  assert.equal(isJudgeDisabled(), true);
});

test(
  "with the kill switch ON, extractField returns cannot_be_determined for every field and the judge client's call is NEVER invoked",
  async () => {
    process.env.NOTARY_JUDGE_KILL_SWITCH = "true";
    const { client, calls } = countingClient();

    for (const field of ALL_FIELDS) {
      const answer = await extractField("Acme grew 12% in FY25.", field, { client });
      assert.equal(answer.outcome, "cannot_be_determined", `field ${field} must collapse to cannot_be_determined`);
      assert.equal(answer.record.error, "judge_kill_switch_active");
      assert.equal(answer.value, undefined);
    }

    assert.equal(calls(), 0, "the judge client must never be invoked while the kill switch is on");
  },
);

test(
  "with the kill switch OFF, the same client IS invoked — the switch is the thing doing the blocking",
  async () => {
    delete process.env.NOTARY_JUDGE_KILL_SWITCH;
    const { client, calls } = countingClient();

    const answer = await extractField("Acme grew 12% in FY25.", "entity", { client });
    assert.equal(answer.outcome, "absent", "with the switch off the mocked judge answer flows through");
    assert.equal(calls(), 1);
  },
);
