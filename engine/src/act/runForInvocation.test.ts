// Act at invocation level. The property under test is the one that was
// broken: it must run with NO claims, NO sources and NO findings — that is
// ~37% of real turns, and the case where Act is the entire product.

import assert from "node:assert/strict";
import { test } from "node:test";
import { rankActionCandidates, runMovesForInvocation } from "./runForInvocation.ts";
import type { Finding, Gap } from "../detect/types.ts";
import type { JudgeCallInput, JudgeCallResult, JudgeClient } from "../judge/judgeClient.ts";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    detector: "self_contradiction",
    type: "internal_conflict",
    owner: "computed",
    inputProvenance: "model_reported",
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

/** A client that records what it was asked and returns one valid move. */
function recordingClient(): { client: JudgeClient; seen: JudgeCallInput[] } {
  const seen: JudgeCallInput[] = [];
  const client: JudgeClient = {
    async call(callInput: JudgeCallInput): Promise<JudgeCallResult> {
      seen.push(callInput);
      return {
        record: { model: "test", promptVersion: "test", question: "q", answer: "{}", inputTokens: 1, outputTokens: 1 },
        parsed: {
          moves: [{ id: "s1", short_label: "Do the thing", move: "clarify", prompt: "Please clarify the thing." }],
        },
      } as unknown as JudgeCallResult;
    },
  } as unknown as JudgeClient;
  return { client, seen };
}

test("runs with no claims, no sources and no findings — the 37% case", async () => {
  const { client, seen } = recordingClient();
  const r = await runMovesForInvocation(
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
  const r = await runMovesForInvocation(
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
  const r = await runMovesForInvocation(
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
  const r = await runMovesForInvocation(
    { organizationId: "org", reviewId: "rev", invocationId: "inv", findings: [finding()], gaps: [] },
    { client },
  );
  assert.equal(r.skipped, "no_user_request");
  assert.equal(seen.length, 0, "no model call may be paid for when there is no task");
  assert.deepEqual(r.moves, []);
});

test("Act never receives evidence — only boundary statements", async () => {
  const { client, seen } = recordingClient();
  await runMovesForInvocation(
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
  assert.ok(!sent.includes("rejectedCandidates"), "no rejected-candidate pool may reach Act");
  assert.ok(!sent.includes("resolved_text"), "no evidence corpus may reach Act");
});

test("the task-state Claude sends actually reaches the model", async () => {
  // THE BUG. The MCP tool asks Claude for explicit_constraints, prior_attempts
  // and the answer on every call; engineClient put them on the wire; the route
  // validated them — and runMovesForInvocation had no parameter for any of
  // them, so all of it was dropped one call short of the prompt that already
  // knew how to render it. Act ran on the request and the findings alone.
  const { client, seen } = recordingClient();
  await runMovesForInvocation(
    {
      organizationId: "org",
      reviewId: "rev",
      invocationId: "inv",
      userRequest: "Pick a database for the audit log",
      claudeAnswer: "DynamoDB handles 50k writes/sec.",
      priorAttempts: ["tried Postgres with a b-tree index"],
      explicitConstraints: ["must stay under $200/month"],
      priorContext: [{ kind: "decision", text: "we already rejected Kafka" }],
      findings: [],
      gaps: [],
    },
    { client },
  );
  const sent = JSON.stringify(seen[0]);
  assert.ok(sent.includes("must stay under $200/month"), "a stated constraint must reach the move");
  assert.ok(sent.includes("tried Postgres with a b-tree index"), "prior attempts distinguish test from repair");
  assert.ok(sent.includes("DynamoDB handles 50k writes/sec."), "the answer being acted on must be visible");
  assert.ok(sent.includes("we already rejected Kafka"), "restated context must reach the move");
});

test("restated context is labelled as unverified, and never outranks a finding", async () => {
  // Act must be able to tell what Notary ESTABLISHED from what Claude merely
  // restated. Only the first is grounded, and a move that treated the second
  // as established is precisely the overreach the boundary exists to prevent.
  const { client, seen } = recordingClient();
  await runMovesForInvocation(
    {
      organizationId: "org",
      reviewId: "rev",
      invocationId: "inv",
      userRequest: "Check the revenue figure",
      findings: [finding({ boundaryText: "The answer says 17% and also 12%." })],
      gaps: [],
      priorContext: [{ kind: "note", text: "the CFO said 17% was final" }],
    },
    { client },
  );
  const ctx = JSON.stringify(seen[0]);
  const establishedAt = ctx.indexOf("The answer says 17% and also 12%.");
  const restatedAt = ctx.indexOf("the CFO said 17% was final");
  assert.ok(establishedAt >= 0 && restatedAt >= 0, "both must be present");
  assert.ok(establishedAt < restatedAt, "what Notary established leads; restatement follows");
  assert.ok(ctx.includes("not verified by Notary"), "restated material must be marked as unverified");
});

test("absent task-state stays absent — an empty array is not context", async () => {
  const { client, seen } = recordingClient();
  await runMovesForInvocation(
    {
      organizationId: "org",
      reviewId: "rev",
      invocationId: "inv",
      userRequest: "Pick a database",
      priorAttempts: [],
      explicitConstraints: [],
      findings: [],
      gaps: [],
    },
    { client },
  );
  const sent = JSON.stringify(seen[0]);
  assert.ok(!sent.includes("PRIOR ATTEMPTS"), "an empty array must not render an empty section");
  assert.ok(!sent.includes("EXPLICIT CONSTRAINTS"), "an empty array must not render an empty section");
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

test("the handoff carries WHICH fields disagreed, not just a sentence", async () => {
  // Before this, Act received one sentence and had to guess whether it was
  // looking at a wrong period, a wrong entity, or a wrong number — three
  // different repairs. The deltas were already computed and thrown away here.
  const { client, seen } = recordingClient();
  await runMovesForInvocation(
    {
      organizationId: "org",
      reviewId: "rev",
      invocationId: "inv",
      userRequest: "Check the revenue figure",
      findings: [
        finding({
          boundaryText: "The answer states 17% and the filing says 12%.",
          fieldDeltas: [{ field: "valueUnit", claimed: "17%", observed: "12%", relation: "conflict" }],
          basis: { kind: "evidence", ref: "ev-123" },
        }),
      ],
      gaps: [],
    },
    { client },
  );
  const sent = JSON.stringify(seen[0]);
  assert.ok(sent.includes("valueUnit"), "the field name must reach Act");
  assert.ok(sent.includes("17%") && sent.includes("12%"), "both sides of the disagreement must reach it");
  assert.ok(sent.includes("ev-123"), "a locator reference lets a move name its source");
});

test("a finding with no field detail behaves exactly as before", async () => {
  const { client, seen } = recordingClient();
  await runMovesForInvocation(
    {
      organizationId: "org",
      reviewId: "rev",
      invocationId: "inv",
      userRequest: "Check this",
      findings: [finding({ fieldDeltas: [], basis: { kind: "answer_internal" } })],
      gaps: [],
    },
    { client },
  );
  const sent = JSON.stringify(seen[0]);
  assert.ok(sent.includes("The answer states X and also not-X."), "the sentence still crosses");
  assert.ok(!sent.includes("WHICH FIELDS DISAGREED"), "no empty table is rendered");
});

test("the evidence passage itself still never crosses", async () => {
  const { client, seen } = recordingClient();
  await runMovesForInvocation(
    {
      organizationId: "org",
      reviewId: "rev",
      invocationId: "inv",
      userRequest: "Check this",
      findings: [
        finding({
          fieldDeltas: [{ field: "period", claimed: "FY25", observed: "FY24", relation: "conflict" }],
          basis: { kind: "evidence", ref: "ev-1", excerpt: "SECRET PASSAGE TEXT" },
        }),
      ],
      gaps: [],
    },
    { client },
  );
  const sent = JSON.stringify(seen[0]);
  assert.ok(!sent.includes("SECRET PASSAGE TEXT"), "the excerpt must not reach Act — it would make it a second verifier");
});
