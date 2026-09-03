// Tests for checkEntitlement() (engine/src/auth/entitlement.ts), mirroring
// quotas/quotaCheck.test.ts's real-Postgres pattern: skips cleanly without a
// configured test database.

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import { checkEntitlement } from "./entitlement.ts";
import { createOrganization, freshPool, HAS_DB } from "../test/db.ts";

const dbSkip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

test(
  "checkEntitlement allows a freshly created organization (default entitlement_status is 'active')",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const orgId = await createOrganization(pool);
    try {
      const result = await checkEntitlement(orgId, pool);
      assert.deepEqual(result, { allowed: true });
    } finally {
      await pool.end();
    }
  },
);

test(
  "checkEntitlement blocks 'past_due', 'canceled', and 'inactive' with distinct reasons",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const orgId = await createOrganization(pool);
    try {
      for (const status of ["past_due", "canceled", "inactive"] as const) {
        await pool.query("UPDATE organization SET entitlement_status = $1 WHERE id = $2", [status, orgId]);
        const result = await checkEntitlement(orgId, pool);
        assert.deepEqual(result, { allowed: false, reason: `entitlement_${status}` });
      }
    } finally {
      await pool.end();
    }
  },
);

test(
  "checkEntitlement re-allows once entitlement_status is set back to 'active'",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const orgId = await createOrganization(pool);
    try {
      await pool.query("UPDATE organization SET entitlement_status = 'canceled' WHERE id = $1", [orgId]);
      assert.deepEqual(await checkEntitlement(orgId, pool), { allowed: false, reason: "entitlement_canceled" });

      await pool.query("UPDATE organization SET entitlement_status = 'active' WHERE id = $1", [orgId]);
      assert.deepEqual(await checkEntitlement(orgId, pool), { allowed: true });
    } finally {
      await pool.end();
    }
  },
);

test(
  "checkEntitlement rejects a nonexistent organization id (never allowed by default)",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    try {
      const result = await checkEntitlement("00000000-0000-0000-0000-000000000000", pool);
      assert.deepEqual(result, { allowed: false, reason: "organization_not_found" });
    } finally {
      await pool.end();
    }
  },
);

test(
  "the entitlement_status column rejects a value outside the allow-listed set (CHECK constraint)",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const orgId = await createOrganization(pool);
    try {
      await assert.rejects(
        pool.query("UPDATE organization SET entitlement_status = 'made_up_status' WHERE id = $1", [orgId]),
        /violates check constraint/,
      );
    } finally {
      await pool.end();
    }
  },
);
