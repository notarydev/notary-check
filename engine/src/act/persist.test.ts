// Tests for migration 0013_advance.sql's schema and persist.ts's writes into
// it. Real Postgres (skip cleanly without a configured test database), same
// pattern as ../review/reviewFlow.test.ts and ../quotas/quotaCheck.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerateMoveResult } from "./liveGenerate.ts";
import { persistMoveInvocation } from "./persist.ts";
import { createOrganization, freshPool, HAS_DB } from "../test/db.ts";

const dbSkip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

test(
  "migration 0013: act_invocation / act_move / act_move_event tables exist with the expected shape",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('act_invocation', 'act_move', 'act_move_event')`,
      );
      assert.deepEqual(
        tables.rows.map((r) => r.table_name).sort(),
        ["act_move_event", "act_invocation", "act_move"],
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "persistMoveInvocation: an 'ok' result with two moves writes one invocation row and two move rows (ordinals 0 and 1)",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const result: GenerateMoveResult = {
        moves: [
          { id: "s1", short_label: "Ambiguous target environment", move: "clarify", prompt: "Ask which environment this needs to run in." },
          { id: "s2", short_label: "Untested failure path", move: "test", prompt: "Run the failure-mode test before shipping this." },
        ],
        record: { model: "deepseek-v4-flash", promptVersion: "v1", question: "q", answer: "{}", inputTokens: 120, outputTokens: 40 },
      };

      const persisted = await persistMoveInvocation(pool, {
        organizationId: orgId,
        invocationContextId: "claim-1",
        hasEvidenceConstraint: false,
        allowedMoves: ["clarify", "test", "compare", "repair"],
        result,
      });

      assert.equal(persisted.moves.length, 2);

      const invocationRow = (await pool.query("SELECT * FROM act_invocation WHERE id = $1", [persisted.invocationId])).rows[0];
      assert.equal(invocationRow.status, "ok");
      assert.equal(invocationRow.organization_id, orgId);
      assert.equal(invocationRow.input_tokens, 120);
      assert.equal(invocationRow.output_tokens, 40);
      assert.ok(invocationRow.estimated_cost_cents !== null);

      const moveRows = (
        await pool.query("SELECT * FROM act_move WHERE invocation_id = $1 ORDER BY ordinal ASC", [persisted.invocationId])
      ).rows;
      assert.equal(moveRows.length, 2);
      assert.equal(moveRows[0].ordinal, 0);
      assert.equal(moveRows[0].move, "clarify");
      assert.equal(moveRows[1].ordinal, 1);
      assert.equal(moveRows[1].move, "test");
    } finally {
      await pool.end();
    }
  },
);

test(
  "persistMoveInvocation: an error result (no moves, a record with an error) writes status 'error' and zero move rows",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const result: GenerateMoveResult = {
        record: { model: "deepseek-v4-flash", promptVersion: "v1", question: "q", error: "transport_failure" },
        error: "transport_failure",
      };

      const persisted = await persistMoveInvocation(pool, {
        organizationId: orgId,
        invocationContextId: "claim-2",
        hasEvidenceConstraint: false,
        allowedMoves: ["clarify", "test", "compare", "repair"],
        result,
      });

      assert.equal(persisted.moves.length, 0);
      const invocationRow = (await pool.query("SELECT * FROM act_invocation WHERE id = $1", [persisted.invocationId])).rows[0];
      assert.equal(invocationRow.status, "error");
      assert.equal(invocationRow.error, "transport_failure");
    } finally {
      await pool.end();
    }
  },
);

test(
  "persistMoveInvocation: a policy-short-circuit result (neither moves nor record) writes status 'skipped'",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const result: GenerateMoveResult = { moves: [], error: "no_legal_move_for_this_state" };
      // Note: an empty `moves` array IS set here, so this is the 'ok'
      // (zero-moves) branch, not 'skipped' — see liveGenerate.ts's own
      // distinction. A true no-call short-circuit sets neither field:
      const skippedResult: GenerateMoveResult = {};

      const okPersisted = await persistMoveInvocation(pool, {
        organizationId: orgId,
        invocationContextId: "claim-3a",
        hasEvidenceConstraint: false,
        allowedMoves: [],
        result,
      });
      const okRow = (await pool.query("SELECT status FROM act_invocation WHERE id = $1", [okPersisted.invocationId])).rows[0];
      assert.equal(okRow.status, "ok");

      const skippedPersisted = await persistMoveInvocation(pool, {
        organizationId: orgId,
        invocationContextId: "claim-3b",
        hasEvidenceConstraint: false,
        allowedMoves: [],
        result: skippedResult,
      });
      const skippedRow = (await pool.query("SELECT status FROM act_invocation WHERE id = $1", [skippedPersisted.invocationId])).rows[0];
      assert.equal(skippedRow.status, "skipped");
    } finally {
      await pool.end();
    }
  },
);

test(
  "act_move: the move CHECK constraint rejects a fifth, invented move even via a direct insert",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const invocation = await pool.query(
        `INSERT INTO act_invocation (organization_id, invocation_context_id, has_evidence_constraint, policy_version, model, prompt_version, status)
         VALUES ($1, 'claim-4', false, 'v1', 'deepseek-v4-flash', 'v1', 'ok') RETURNING id`,
        [orgId],
      );
      const invocationId = invocation.rows[0].id as string;

      await assert.rejects(
        pool.query(
          `INSERT INTO act_move (invocation_id, model_move_id, ordinal, move, short_label, prompt)
           VALUES ($1, 's1', 0, 'escalate', 'Escalate this', 'Escalate this to a human reviewer.')`,
          [invocationId],
        ),
        /violates check constraint/,
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "act_move: the UNIQUE (invocation_id, ordinal) index is the DB-visible half of the 0-2 cardinality cap",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const invocation = await pool.query(
        `INSERT INTO act_invocation (organization_id, invocation_context_id, has_evidence_constraint, policy_version, model, prompt_version, status)
         VALUES ($1, 'claim-5', false, 'v1', 'deepseek-v4-flash', 'v1', 'ok') RETURNING id`,
        [orgId],
      );
      const invocationId = invocation.rows[0].id as string;

      await pool.query(
        `INSERT INTO act_move (invocation_id, model_move_id, ordinal, move, short_label, prompt)
         VALUES ($1, 's1', 0, 'clarify', 'First', 'Ask which environment this needs to run in.')`,
        [invocationId],
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO act_move (invocation_id, model_move_id, ordinal, move, short_label, prompt)
           VALUES ($1, 's2', 0, 'test', 'Duplicate ordinal', 'Run the smaller test case first.')`,
          [invocationId],
        ),
        /duplicate key value violates unique constraint/,
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "act_move_event: event_type CHECK constraint accepts the four lifecycle events and rejects anything else",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const invocation = await pool.query(
        `INSERT INTO act_invocation (organization_id, invocation_context_id, has_evidence_constraint, policy_version, model, prompt_version, status)
         VALUES ($1, 'claim-6', false, 'v1', 'deepseek-v4-flash', 'v1', 'ok') RETURNING id`,
        [orgId],
      );
      const invocationId = invocation.rows[0].id as string;
      const move = await pool.query(
        `INSERT INTO act_move (invocation_id, model_move_id, ordinal, move, short_label, prompt)
         VALUES ($1, 's1', 0, 'clarify', 'First', 'Ask which environment this needs to run in.') RETURNING id`,
        [invocationId],
      );
      const moveId = move.rows[0].id as string;

      for (const eventType of ["shown", "revealed", "committed", "dismissed"]) {
        await pool.query("INSERT INTO act_move_event (move_id, event_type) VALUES ($1, $2)", [moveId, eventType]);
      }
      const count = await pool.query("SELECT count(*)::int AS n FROM act_move_event WHERE move_id = $1", [moveId]);
      assert.equal(count.rows[0].n, 4);

      await assert.rejects(
        pool.query("INSERT INTO act_move_event (move_id, event_type) VALUES ($1, 'clicked')", [moveId]),
        /violates check constraint/,
      );
    } finally {
      await pool.end();
    }
  },
);
