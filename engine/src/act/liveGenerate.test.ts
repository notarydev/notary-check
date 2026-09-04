// Tests for the quota/kill-switch gating this session added to
// generateMoves() (liveGenerate.ts) — a known, previously-flagged
// gap: Move's live call did not consult either gate before this change.
// Mirrors ../judge/killSwitch.test.ts's counting-client pattern for the kill
// switch (no DB, no network) and ../quotas/quotaCheck.test.ts's real-Postgres
// pattern for the quota gate. Also covers the no_user_request short-circuit
// (pure, no DB, no network) that this change added alongside the two gates.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { JudgeCallInput, JudgeClient, JudgeCallResult } from "../judge/judgeClient.ts";
import { DEFAULT_GLOBAL_SPEND_CAP_CENTS, DEFAULT_ORG_MONTHLY_LIMIT_CENTS } from "../quotas/quotaCheck.ts";
import { estimateDeepSeekCostCents, insertUsageEvent, usageEventFromJudgeCall } from "../quotas/usage.ts";
import { createOrganization, freshPool, HAS_DB } from "../test/db.ts";
import { generateMoves } from "./liveGenerate.ts";
import type { MoveKind, InvocationContext } from "./types.ts";

const dbSkip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

const ALL_MOVES: readonly MoveKind[] = ["clarify", "test", "compare", "repair"];

function baseContext(overrides: Partial<InvocationContext> = {}): InvocationContext {
  return {
    invocation_id: "inv-1",
    user_request: "How should I structure the retry logic for this API client?",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** A judge client that counts every call and always answers with zero moves. */
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
          answer: JSON.stringify({ moves: [] }),
          inputTokens: 10,
          outputTokens: 5,
        },
      };
    },
  };
  return { client, calls: () => calls };
}

// ---- pure: no_user_request short-circuit (no DB, no network) --------------

test("empty user_request short-circuits to zero moves before any client is constructed", async () => {
  const { client, calls } = countingClient();
  const result = await generateMoves(baseContext({ user_request: "" }), ALL_MOVES, undefined, { client });
  assert.deepEqual(result.moves, []);
  assert.equal(result.error, "no_user_request");
  assert.equal(calls(), 0, "the judge client must never be invoked with no user_request");
});

test("whitespace-only user_request is treated the same as empty", async () => {
  const { client, calls } = countingClient();
  const result = await generateMoves(baseContext({ user_request: "   \n\t " }), ALL_MOVES, undefined, { client });
  assert.equal(result.error, "no_user_request");
  assert.equal(calls(), 0);
});

// ---- kill switch (no DB, no network) ---------------------------------------

const ORIG_KILL = process.env.NOTARY_JUDGE_KILL_SWITCH;
afterEach(() => {
  if (ORIG_KILL === undefined) delete process.env.NOTARY_JUDGE_KILL_SWITCH;
  else process.env.NOTARY_JUDGE_KILL_SWITCH = ORIG_KILL;
});

test("with the kill switch ON, generateMoves returns an error and never invokes the client", async () => {
  process.env.NOTARY_JUDGE_KILL_SWITCH = "true";
  const { client, calls } = countingClient();

  const result = await generateMoves(baseContext(), ALL_MOVES, undefined, { client });

  assert.equal(result.moves, undefined);
  assert.equal(result.error, "judge_kill_switch_active");
  assert.equal(result.record?.error, "judge_kill_switch_active");
  assert.equal(calls(), 0, "the judge client must never be invoked while the kill switch is on");
});

test("with the kill switch OFF, the same client IS invoked — the switch is the thing doing the blocking", async () => {
  delete process.env.NOTARY_JUDGE_KILL_SWITCH;
  const { client, calls } = countingClient();

  const result = await generateMoves(baseContext(), ALL_MOVES, undefined, { client });

  assert.deepEqual(result.moves, []);
  assert.equal(calls(), 1);
});

// ---- quota gate (real Postgres) --------------------------------------------

const ORIG_ORG_LIMIT = process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
const ORIG_GLOBAL_CAP = process.env.NOTARY_GLOBAL_SPEND_CAP_CENTS;

beforeEach(() => {
  process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = String(DEFAULT_ORG_MONTHLY_LIMIT_CENTS);
  process.env.NOTARY_GLOBAL_SPEND_CAP_CENTS = String(DEFAULT_GLOBAL_SPEND_CAP_CENTS);
});

afterEach(() => {
  if (ORIG_ORG_LIMIT === undefined) delete process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
  else process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = ORIG_ORG_LIMIT;
  if (ORIG_GLOBAL_CAP === undefined) delete process.env.NOTARY_GLOBAL_SPEND_CAP_CENTS;
  else process.env.NOTARY_GLOBAL_SPEND_CAP_CENTS = ORIG_GLOBAL_CAP;
});

test(
  "with the org's monthly quota already exhausted, generateMoves is blocked and the client is never invoked",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      // Push this org's recorded spend at/over the (test-scoped) monthly limit.
      process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "1";
      await insertUsageEvent(
        pool,
        usageEventFromJudgeCall(
          { model: "deepseek-v4-flash", promptVersion: "v", inputTokens: 1_000_000, outputTokens: 1_000_000 },
          { organizationId: orgId },
        ),
      );
      assert.ok(estimateDeepSeekCostCents(1_000_000, 1_000_000) >= 1, "sanity: the seeded usage row exceeds the 1-cent test limit");

      const { client, calls } = countingClient();
      const result = await generateMoves(baseContext(), ALL_MOVES, undefined, {
        client,
        organizationId: orgId,
        db: pool,
      });

      assert.equal(result.moves, undefined);
      assert.equal(result.error, "quota_organization_monthly_limit_exceeded");
      assert.equal(calls(), 0, "the judge client must never be invoked once quota is denied");
    } finally {
      await pool.end();
    }
  },
);

test(
  "with quota available, generateMoves proceeds and the client IS invoked",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const { client, calls } = countingClient();

      const result = await generateMoves(baseContext(), ALL_MOVES, undefined, {
        client,
        organizationId: orgId,
        db: pool,
      });

      assert.deepEqual(result.moves, []);
      assert.equal(calls(), 1, "quota allowed the call through");
    } finally {
      await pool.end();
    }
  },
);

test(
  "with no organizationId/db supplied, the quota gate is skipped (documented, not silently enforced) and the client IS invoked",
  async () => {
    const { client, calls } = countingClient();
    const result = await generateMoves(baseContext(), ALL_MOVES, undefined, { client });
    assert.deepEqual(result.moves, []);
    assert.equal(calls(), 1);
  },
);
