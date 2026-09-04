// Act / Challenge generation — the output-contract and cap tests.
//
// What these prove, all with MOCKED judge responses:
//   (a) a well-formed output maps to the exact four-field ChallengeItem shape;
//   (b) an output that smuggles a verdict / confidence / score / answer field
//       is REJECTED IN FULL — not stripped of the extra key and accepted;
//   (c) the per-claim cap of 2 is enforced by CODE against a model that ignores
//       the prompt and returns 5;
//   (d) a caller-supplied budget below the cap lowers it, and one above it does
//       not raise it;
//   (e) evidence text reaches the model delimited, never raw.

import assert from "node:assert/strict";
import { test } from "node:test";
import { generateChallenges, parseChallengeOutput, truncateToCap } from "./challengeGeneration.ts";
import type { ChallengeFindingContext, ChallengeItem } from "./challengeGeneration.ts";
import type { JudgeCallInput, JudgeClient } from "./judgeClient.ts";

const FINDING: ChallengeFindingContext = {
  claimText: "Acme's revenue grew 17% in FY25.",
  state: "CONTRADICTED",
  stateReason: "contradicting_applicable_relation",
  noSource: false,
  matchedFields: ["entity", "period", "metric"],
  mismatchDetails: [],
  excerpts: [
    {
      relation: "contradicts",
      locatorDisplay: "text:0-52",
      quote: "Acme's revenue increased 12% year over year in fiscal 2025.",
    },
  ],
};

const item = (n: number) => ({
  challenge_type: "ambiguity",
  prompt: `Question ${n}?`,
  why_it_matters: `Reason ${n}.`,
  action: "clarify_claim",
});

function mockedJudge(answer: string): { client: JudgeClient; calls: JudgeCallInput[] } {
  const calls: JudgeCallInput[] = [];
  return {
    calls,
    client: {
      async call(input: JudgeCallInput) {
        calls.push(input);
        return {
          status: "ok" as const,
          record: { model: "deepseek-v4-flash", promptVersion: input.promptVersion, question: input.question, answer },
        };
      },
    },
  };
}

test("a well-formed output maps to the exact four-field ChallengeItem shape", async () => {
  const answer = JSON.stringify({
    reasoning: "the passage's figure and the claim's differ; the metric definition is the live question",
    challenges: [
      {
        challenge_type: "ambiguity",
        prompt: "Is 'revenue' in the cited passage gross or net?",
        why_it_matters: "If the passage reports net revenue, the two figures may not be comparable at all.",
        action: "clarify_claim",
      },
    ],
  });
  const { client } = mockedJudge(answer);
  const result = await generateChallenges(FINDING, { client });

  assert.equal(result.error, undefined);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.items, [
    {
      challengeType: "ambiguity",
      prompt: "Is 'revenue' in the cited passage gross or net?",
      whyItMatters: "If the passage reports net revenue, the two figures may not be comparable at all.",
      action: "clarify_claim",
    },
  ] as ChallengeItem[]);

  // No key in the returned item can carry a verdict-like value: the shape has
  // exactly four keys.
  assert.deepEqual(Object.keys(result.items[0]).sort(), ["action", "challengeType", "prompt", "whyItMatters"]);
});

// (b) THE STRICT-REJECTION TEST — the discipline fieldExtraction.ts applies to
// a sneaked-in "confidence", applied to Act's four forbidden fields.
for (const forbidden of ["verdict", "confidence", "score", "answer"]) {
  test(`an item carrying a sneaked-in "${forbidden}" field rejects the ENTIRE output`, async () => {
    const answer = JSON.stringify({
      reasoning: "r",
      challenges: [{ ...item(1), [forbidden]: forbidden === "confidence" || forbidden === "score" ? 0.92 : "the claim is wrong" }],
    });
    const { client } = mockedJudge(answer);
    const result = await generateChallenges(FINDING, { client });

    assert.equal(result.items.length, 0, "no item survives an output that invented a forbidden field");
    assert.match(result.error ?? "", /schema validation/);
    // And specifically NOT the strip-and-accept failure mode:
    assert.ok(!JSON.stringify(result.items).includes(forbidden));
  });
}

test("one poisoned item rejects its clean siblings too — a partial accept is not available", async () => {
  const answer = JSON.stringify({
    reasoning: "r",
    challenges: [item(1), { ...item(2), verdict: "CONTRADICTED" }],
  });
  const result = await generateChallenges(FINDING, { client: mockedJudge(answer).client });
  assert.equal(result.items.length, 0);
});

test("a forbidden field at the TOP level is rejected too", async () => {
  const answer = JSON.stringify({ reasoning: "r", challenges: [item(1)], confidence: 0.8 });
  const result = await generateChallenges(FINDING, { client: mockedJudge(answer).client });
  assert.equal(result.items.length, 0);
  assert.match(result.error ?? "", /schema validation/);
});

test("an out-of-vocabulary challenge_type or action is rejected, never coerced", () => {
  const badType = parseChallengeOutput(
    JSON.stringify({ reasoning: "r", challenges: [{ ...item(1), challenge_type: "gut_feeling" }] }),
  );
  assert.equal(badType.ok, false);
  const badAction = parseChallengeOutput(
    JSON.stringify({ reasoning: "r", challenges: [{ ...item(1), action: "rewrite_claim_for_user" }] }),
  );
  assert.equal(badAction.ok, false);
});

test("an empty challenge list is a valid, successful outcome", async () => {
  const result = await generateChallenges(FINDING, {
    client: mockedJudge(JSON.stringify({ reasoning: "nothing worth asking", challenges: [] })).client,
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.items, []);
});

// (c) THE CAP TEST — a model that ignores the prompt and returns 5.
test("cap enforcement: a model returning 5 items yields exactly 2, and reports the truncation", async () => {
  const answer = JSON.stringify({ reasoning: "r", challenges: [item(1), item(2), item(3), item(4), item(5)] });
  const result = await generateChallenges(FINDING, { client: mockedJudge(answer).client });

  assert.equal(result.items.length, 2, "the per-claim cap is 2, enforced in code");
  assert.equal(result.truncated, true, "truncation is reported, not silent");
  // Deterministic: the model's own first two, in order — never a re-ranking.
  assert.deepEqual(
    result.items.map((i) => i.prompt),
    ["Question 1?", "Question 2?"],
  );
});

// (d) The invocation budget lowers the cap; nothing can raise it.
test("a caller budget below the cap lowers it; a budget above the cap does not raise it", async () => {
  const answer = JSON.stringify({ reasoning: "r", challenges: [item(1), item(2), item(3)] });

  const lowered = await generateChallenges(FINDING, { client: mockedJudge(answer).client, maxItems: 1 });
  assert.equal(lowered.items.length, 1);
  assert.equal(lowered.truncated, true);

  const raised = await generateChallenges(FINDING, { client: mockedJudge(answer).client, maxItems: 99 });
  assert.equal(raised.items.length, 2, "the product cap of 2 is a ceiling no caller can lift");
});

test("a zero budget makes NO judge call at all", async () => {
  const { client, calls } = mockedJudge(JSON.stringify({ reasoning: "r", challenges: [item(1)] }));
  const result = await generateChallenges(FINDING, { client, maxItems: 0 });
  assert.equal(calls.length, 0, "an exhausted budget must cost zero DeepSeek calls, not one that is discarded");
  assert.deepEqual(result.items, []);
  assert.equal(result.error, "challenge_budget_exhausted");
});

// (e) Evidence reaches the model as delimited DATA.
test("evidence excerpts are delimited before they reach the prompt", async () => {
  const { client, calls } = mockedJudge(JSON.stringify({ reasoning: "r", challenges: [] }));
  await generateChallenges(FINDING, { client });

  const user = calls[0].messages[1].content;
  assert.match(user, /<<<EVIDENCE:[0-9a-f]{16}:START>>>/);
  assert.match(user, /<<<EVIDENCE:[0-9a-f]{16}:END>>>/);
  // The finding's already-assigned state is present as read-only context —
  // Act is deliberately NOT blind (synthesis doc Part 6: an authority
  // boundary, not an information firewall).
  assert.match(user, /CONTRADICTED/);
});

test("malformed model output degrades to zero items, never to a crash", async () => {
  for (const raw of ["", "not json at all", "{", '{"reasoning":"r"}']) {
    const result = await generateChallenges(FINDING, { client: mockedJudge(raw).client });
    assert.deepEqual(result.items, []);
    assert.ok(result.error !== undefined);
  }
});

test("truncateToCap is pure, order-preserving, and never exceeds the product cap", () => {
  const items: ChallengeItem[] = [1, 2, 3].map((n) => ({
    challengeType: "ambiguity",
    prompt: `p${n}`,
    whyItMatters: `w${n}`,
    action: "clarify_claim",
  }));
  assert.deepEqual(truncateToCap(items.slice(0, 1)).items.length, 1);
  assert.equal(truncateToCap(items).truncated, true);
  assert.deepEqual(truncateToCap(items, 99).items.length, 2);
  assert.deepEqual(truncateToCap(items, 0).items.length, 0);
});
