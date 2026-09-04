// Tests for quota enforcement (engine/src/quotas/quotaCheck.ts) and the
// UsageEvent shaping helpers (engine/src/quotas/usage.ts). The quota tests are
// real-Postgres (skip cleanly without a configured test database); the usage
// shaping tests are pure and always run.
//
// Env discipline: both caps are read from the environment at CALL time, so
// these tests set NOTARY_ORG_MONTHLY_LIMIT_CENTS / NOTARY_GLOBAL_SPEND_CAP_CENTS
// per test and restore them after. Because the global spend cap sums usage
// across ALL organizations, every test deletes its own org's usage rows in a
// finally so the baseline stays clean for the next test.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type pg from "pg";
import {
  checkGlobalSpendCap,
  checkQuota,
  DEFAULT_GLOBAL_SPEND_CAP_CENTS,
  DEFAULT_ORG_MONTHLY_LIMIT_CENTS,
  globalMonthCostCents,
  globalSpendCapCents,
  orgMonthlyLimitCents,
  organizationMonthCostCents,
} from "./quotaCheck.ts";
import {
  estimateDeepSeekCostCents,
  estimateDeepSeekCostMillicents,
  insertUsageEvent,
  usageEventFromJudgeCall,
  type UsageEventShape,
} from "./usage.ts";
import { createOrganization, freshPool, HAS_DB } from "../test/db.ts";
import type { JudgeCallRecord } from "../judge/judgeClient.ts";

const dbSkip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

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

// ---- pure, no DB ----------------------------------------------------------

test("estimateDeepSeekCostCents uses the published per-million-token prices", () => {
  // $0.22 / 1M input → 22 cents; $0.66 / 1M output → 66 cents.
  assert.equal(estimateDeepSeekCostCents(1_000_000, 0), 22);
  assert.equal(estimateDeepSeekCostCents(0, 1_000_000), 66);
  assert.equal(estimateDeepSeekCostCents(1_000_000, 1_000_000), 88);
  // The planning-case check: 4,000 in + 700 out ≈ $0.00134 → 0 cents (below a
  // single cent at this precision).
  assert.equal(estimateDeepSeekCostCents(4_000, 700), 0);
  // Large round number boundary.
  assert.equal(estimateDeepSeekCostCents(10_000_000, 0), 220);
});

test("usageEventFromJudgeCall maps a JudgeCallRecord into an insertable UsageEvent shape", () => {
  const record: JudgeCallRecord = {
    model: "deepseek-v4-flash",
    promptVersion: "v1",
    question: "q",
    answer: "{}",
    inputTokens: 4_000,
    outputTokens: 700,
  };
  const event = usageEventFromJudgeCall(record, { organizationId: "org-1", userId: "u-1", reviewId: "r-1" });
  assert.deepEqual(event, {
    organizationId: "org-1",
    userId: "u-1",
    reviewId: "r-1",
    eventType: "judge_call",
    inputTokens: 4_000,
    outputTokens: 700,
    fetchBytes: 0,
    // A realistic call: 0.134 cents. The cent figure rounds to 0 — that is
    // exactly the bug migration 0015 exists to route around, and this
    // assertion documents it rather than treating 0 as correct metering.
    estimatedCostCents: estimateDeepSeekCostCents(4_000, 700),
    estimatedCostMillicents: estimateDeepSeekCostMillicents(4_000, 700),
  });
  assert.equal(event.estimatedCostCents, 0, "a real call rounds to 0 cents — display only, never the enforcing unit");
  assert.equal(event.estimatedCostMillicents, 134, "the enforcing unit must be non-zero for a real call");
});

test("orgMonthlyLimitCents / globalSpendCapCents defaults and env overrides", () => {
  process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "123";
  assert.equal(orgMonthlyLimitCents(), 123);
  process.env.NOTARY_GLOBAL_SPEND_CAP_CENTS = "456";
  assert.equal(globalSpendCapCents(), 456);
  delete process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
  delete process.env.NOTARY_GLOBAL_SPEND_CAP_CENTS;
  assert.equal(orgMonthlyLimitCents(), DEFAULT_ORG_MONTHLY_LIMIT_CENTS);
  assert.equal(globalSpendCapCents(), DEFAULT_GLOBAL_SPEND_CAP_CENTS);
});

// ---- real Postgres --------------------------------------------------------

test(
  "insertUsageEvent lands a row whose cost is summed by the monthly queries",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const orgId = await createOrganization(pool);
    try {
      const event: UsageEventShape = {
        organizationId: orgId,
        eventType: "judge_call",
        inputTokens: 1_000_000,
        outputTokens: 0,
        fetchBytes: 0,
        estimatedCostCents: estimateDeepSeekCostCents(1_000_000, 0),
        estimatedCostMillicents: estimateDeepSeekCostMillicents(1_000_000, 0),
      };
      // The GLOBAL sum spans every organization in the database, so it is not
      // isolated from other tests the way a fresh org's sum is. node --test runs
      // test FILES in parallel processes against this same Postgres, so
      // asserting an exact global total silently asserted "no other test in this
      // whole suite has ever written a usage_event this month" — which held only
      // by luck, and stopped holding the moment claim extraction started
      // metering its own calls. Measure the DELTA instead: that is what this
      // test actually cares about (the global query is not org-filtered).
      const globalBefore = await globalMonthCostCents(pool);

      const id = await insertUsageEvent(pool, event);
      assert.ok(id);
      const row = await pool.query("SELECT * FROM usage_event WHERE id = $1", [id]);
      assert.equal(row.rows[0].organization_id, orgId);
      assert.equal(row.rows[0].estimated_cost_cents, 22);
      assert.equal(row.rows[0].input_tokens, 1_000_000);
      // The per-org sum IS isolated (orgId is freshly created here), so it stays
      // an exact assertion — that is where the real weight of this test sits.
      assert.equal(await organizationMonthCostCents(orgId, pool), 22);
      // The global sum must have grown by at least this row's cost. `>=` rather
      // than `=== globalBefore + 22` because a concurrently-running test file
      // may legitimately land its own row between these two reads.
      assert.ok(
        (await globalMonthCostCents(pool)) >= globalBefore + 22,
        "the global sum must include this row (it is not filtered by organization)",
      );
    } finally {
      await pool.query("DELETE FROM usage_event WHERE organization_id = $1", [orgId]);
      await pool.end();
    }
  },
);

test(
  "checkQuota allows an org under its limit when the global cap is also clear",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const orgId = await createOrganization(pool);
    try {
      process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "100"; // $1.00 org ceiling

      await pool.query(
        `INSERT INTO usage_event (organization_id, event_type, input_tokens, output_tokens, fetch_bytes, estimated_cost_millicents)
         VALUES ($1, 'judge_call', 0, 0, 0, 40000)`,
        [orgId],
      );

      // The global cap is set RELATIVE to what the database already holds.
      //
      // It used to be the literal "1000", which quietly assumed the whole
      // usage_event table summed to under $10 for the current month. That is
      // true of a fresh database and false of one that has been tested against
      // for a while — the local DB had accumulated 5,144 rows and ~1114 cents,
      // so this test failed deterministically rather than flakily, and it had
      // been invisible because the whole file was silently skipping.
      //
      // Reading the real sum keeps the assertion about the thing it is meant to
      // be about: the ORG limit, with the global cap deliberately not binding.
      // The same reasoning as the sibling test above, which already refuses to
      // assume an exact global total.
      const globalNow = await globalMonthCostCents(pool);
      process.env.NOTARY_GLOBAL_SPEND_CAP_CENTS = String(globalNow + 1000);

      // 40 < 100 → allowed.
      const result = await checkQuota(orgId, pool);
      assert.deepEqual(result, { allowed: true });
    } finally {
      await pool.query("DELETE FROM usage_event WHERE organization_id = $1", [orgId]);
      await pool.end();
    }
  },
);

test(
  "checkQuota blocks an org over its monthly limit (limit boundary is a hard stop)",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const orgId = await createOrganization(pool);
    try {
      process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "100";
      // Relative, not the literal 100000 this used to be: a fixed "large"
      // number is a silent assumption that the whole usage_event table stays
      // under it forever, and the table only grows. Making it relative keeps
      // the test about the ORG limit, which is what it is named for.
      process.env.NOTARY_GLOBAL_SPEND_CAP_CENTS = String((await globalMonthCostCents(pool)) + 100000);

      // Sum exactly at the limit → NOT allowed (>= is the hard cutoff).
      await pool.query(
        // Millicents, because estimated_cost_cents is GENERATED ALWAYS as of
        // migration 0015 and cannot be written. 60 + 40 cents = 100,000
        // millicents, exactly the 100-cent limit set above.
        `INSERT INTO usage_event (organization_id, event_type, estimated_cost_millicents)
         VALUES ($1, 'judge_call', 60000), ($1, 'judge_call', 40000)`,
        [orgId],
      );
      const atLimit = await checkQuota(orgId, pool);
      assert.deepEqual(atLimit, { allowed: false, reason: "organization_monthly_limit_exceeded" });

      // One more unit pushes it clearly over; same reason.
      await pool.query(
        `INSERT INTO usage_event (organization_id, event_type, estimated_cost_millicents) VALUES ($1, 'judge_call', 1000)`,
        [orgId],
      );
      const over = await checkQuota(orgId, pool);
      assert.deepEqual(over, { allowed: false, reason: "organization_monthly_limit_exceeded" });
    } finally {
      await pool.query("DELETE FROM usage_event WHERE organization_id = $1", [orgId]);
      await pool.end();
    }
  },
);

test(
  "the global spend cap is enforced even for an org far under its own limit",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    // Two DIFFERENT orgs: one burns the global cap, the other (fresh, below its
    // own limit) must still be blocked by the aggregate ceiling — the case the
    // per-org limit alone cannot protect against.
    const burnerOrg = await createOrganization(pool);
    const innocentOrg = await createOrganization(pool);
    try {
      process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "1000"; // generous org ceiling
      process.env.NOTARY_GLOBAL_SPEND_CAP_CENTS = "10"; // tiny aggregate ceiling

      await pool.query(
        `INSERT INTO usage_event (organization_id, event_type, estimated_cost_millicents) VALUES ($1, 'judge_call', 10000)`,
        [burnerOrg],
      );

      // checkGlobalSpendCap itself says no.
      const global = await checkGlobalSpendCap(pool);
      assert.deepEqual(global, { allowed: false, reason: "global_spend_cap_exceeded" });

      // The innocent org, with ZERO usage of its own, is still blocked by the
      // aggregate cap.
      const blocked = await checkQuota(innocentOrg, pool);
      assert.deepEqual(blocked, { allowed: false, reason: "global_spend_cap_exceeded" });

      // And with the cap high again, both orgs are allowed.
      // Relative for the same reason as above — a fixed ceiling assumes a
      // database that never accumulates.
      process.env.NOTARY_GLOBAL_SPEND_CAP_CENTS = String((await globalMonthCostCents(pool)) + 100000);
      assert.deepEqual(await checkQuota(innocentOrg, pool), { allowed: true });
      assert.deepEqual(await checkQuota(burnerOrg, pool), { allowed: true });
    } finally {
      await pool.query("DELETE FROM usage_event WHERE organization_id = $1", [burnerOrg]);
      await pool.end();
    }
  },
);

// Migration 0015 regression: the spend caps must actually bite on realistic
// traffic. Before this, `estimated_cost_cents` rounded a typical ~0.134-cent
// call to 0, both monthly sums summed zeros, and neither the per-org limit nor
// the global provider cap could ever fire no matter how many calls were made.
//
// The test is written in terms of REAL call sizes deliberately. Asserting with
// a huge synthetic token count would have passed even against the old rounding
// bug, which is exactly why the bug survived: the existing coverage used
// 1,000,000 input tokens (22 cents), a size no actual call reaches.
test(
  "realistic per-call costs accumulate — the rounding bug that made both spend caps inert",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const orgId = await createOrganization(pool);
    try {
      // § Operating cost's own planning figure for one check: 4,000 input +
      // 700 output tokens, which is $0.00134 — i.e. 0.134 cents.
      const IN = 4_000;
      const OUT = 700;

      assert.equal(
        estimateDeepSeekCostCents(IN, OUT),
        0,
        "precondition: a real call still rounds to 0 cents — this is why the cent column cannot be the enforcing unit",
      );
      assert.ok(
        estimateDeepSeekCostMillicents(IN, OUT) > 0,
        "a real call must be non-zero in the enforcing unit, or the caps are decorative",
      );

      const before = await organizationMonthCostCents(orgId, pool);

      // 1,000 checks — the plan's "planning case" is 100,000/month across all
      // users, so this is a small, entirely ordinary volume.
      for (let i = 0; i < 1_000; i++) {
        await insertUsageEvent(pool, {
          organizationId: orgId,
          eventType: "judge_call",
          inputTokens: IN,
          outputTokens: OUT,
          fetchBytes: 0,
          estimatedCostCents: estimateDeepSeekCostCents(IN, OUT),
          estimatedCostMillicents: estimateDeepSeekCostMillicents(IN, OUT),
        });
      }

      const after = await organizationMonthCostCents(orgId, pool);
      const accrued = after - before;

      // 1,000 x 0.134 cents = ~134 cents. Under the old behaviour this was 0.
      assert.ok(
        accrued > 100,
        `1,000 realistic calls must accrue real cost; got ${accrued} cents (0 means the rounding bug is back)`,
      );
      assert.ok(accrued < 200, `sanity: expected roughly 134 cents, got ${accrued} — check the millicent conversion`);
    } finally {
      await pool.end();
    }
  },
);
