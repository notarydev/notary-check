// Track 2 at invocation level. The property under test is the one that was
// broken: it must run with NO claims, NO sources and NO findings — that is
// ~37% of real turns, and the case where Track 2 is the entire product.

import assert from "node:assert/strict";
import { test } from "node:test";
import { rankActionCandidates, runAdvanceForInvocation } from "./runForInvocation.ts";
import type { Finding, Gap } from "../detect/types.ts";
import type { JudgeCallInput, JudgeCallResult, JudgeClient } from "../judge/judgeClient.ts";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    detector: "self_contradiction",
    type: "internal_conflict",
    owner: "computed",
    boundaryText: "The answer states X and also not-X.",
    fieldDeltas: [],
    basis: { kind: "answer_internal" },
    rank: 20,
    detectorVersion: "v1",
    ...over,
  };
}

function gap(over: Partial<Gap> = {}): Gap {
  return { detector: "self_report", missing: "execution_result", unblocks: "check the command output", ...over };
}

/** A client that records what it was asked and returns one valid suggestion. */
function recordingClient(): { client: JudgeClient; seen: JudgeCallInput[] } {
  const seen: JudgeCallInput[] = [];
  const client: JudgeClient = {
    async call(callInput: JudgeCallInput): Promise<JudgeCallResult> {
      seen.push(callInput);
      return {
        record: { model: "test", promptVersion: "test", question: "q", answer: "{}", inputTokens: 1, outputTokens: 1 },
        parsed: {
          suggestions: [{ id: "s1", short_label: "Do the thing", move: "clarify", prompt: "Please clarify the thing." }],
        },
      } as unknown as JudgeCallResult;
    },
  } as unknown as JudgeClient;
  return { client, seen };
}

test("runs with no claims, no sources and no findings — the 37% case", async () => {
  const { client, seen } = recordingClient();
  const r = await runAdvanceForInvocation(
    {
      organizationId: "org",
      reviewId: "rev",
      invocationId: "inv",
      userRequest: "Should I use Postgres or DynamoDB for an audit log?",
      findings: [],
      gaps: [],
    },
    { client },
  );
  assert.equal(seen.length, 1, "a model call must still happen with zero findings");
  assert.equal(r.skipped, undefined);
  assert.equal(r.intent.taskMode, "general");
});

test("infers intent from the request and uses it to pick the move set", async () => {
  const { client } = recordingClient();
  const r = await runAdvanceForInvocation(
    {
      organizationId: "org",
      reviewId: "rev",
      invocationId: "inv",
      userRequest: "Debug the failing unit test in the auth module",
      findings: [],
      gaps: [],
    },
    { client },
  );
  assert.equal(r.intent.taskMode, "coding");
  // coding + no finding excludes repair — nothing has been established broken.
  assert.ok(!r.allowedMoves.includes("repair"));
});

test("a finding counts as an evidence constraint and changes the allowed moves", async () => {
  const { client } = recordingClient();
  const r = await runAdvanceForInvocation(
    {
      organizationId: "org",
      reviewId: "rev",
      invocationId: "inv",
      userRequest: "Debug the failing unit test in the auth module",
      findings: [finding()],
      gaps: [],
    },
    { client },
  );
  // coding + a sealed finding makes repair live.
  assert.ok(r.allowedMoves.includes("repair"));
});

test("skips without a user request — and says why, rather than inventing a task", async () => {
  const { client, seen } = recordingClient();
  const r = await runAdvanceForInvocation(
    { organizationId: "org", reviewId: "rev", invocationId: "inv", findings: [finding()], gaps: [] },
    { client },
  );
  assert.equal(r.skipped, "no_user_request");
  assert.equal(seen.length, 0, "no model call may be paid for when there is no task");
  assert.deepEqual(r.suggestions, []);
});

test("Track 2 never receives evidence — only boundary statements", async () => {
  const { client, seen } = recordingClient();
  await runAdvanceForInvocation(
    {
      organizationId: "org",
      reviewId: "rev",
      invocationId: "inv",
      userRequest: "Check the revenue figure",
      findings: [finding({ boundaryText: "The answer states X and also not-X." })],
      gaps: [gap()],
    },
    { client },
  );
  const sent = JSON.stringify(seen[0]);
  assert.ok(sent.includes("The answer states X and also not-X."), "the boundary statement is passed");
  assert.ok(!sent.includes("rejectedCandidates"), "no rejected-candidate pool may reach Track 2");
  assert.ok(!sent.includes("resolved_text"), "no evidence corpus may reach Track 2");
});

test("candidates rank findings before gaps, and by detector rank within findings", () => {
  const ranked = rankActionCandidates(
    [finding({ id: "low", rank: 20 }), finding({ id: "high", rank: 15, detector: "self_report" })],
    [gap()],
  );
  assert.equal(ranked[0].kind, "finding");
  assert.equal((ranked[0].item as Finding).id, "high", "lower rank number sorts first");
  assert.equal(ranked[1].kind, "finding");
  assert.equal(ranked[2].kind, "gap", "an established problem outranks something we could not check");
});
