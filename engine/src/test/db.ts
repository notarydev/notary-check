// Shared helper for the real-Postgres test files (auth, quotas, evidence
// routes, retention). Same pattern as prior build-order steps: a real Postgres
// (here a docker container, or any server at TEST_DATABASE_URL / DATABASE_URL)
// with migrations applied, exercised for real.
//
// Each DB test file skips cleanly (the whole suite keeps passing) when no
// Postgres is configured — mirroring how liveApi.test.ts skips without
// DEEPSEEK_API_KEY. When TEST_DATABASE_URL (or DATABASE_URL) IS set, these
// tests run against a real database.
//
// Migration safety: node --test runs test FILES in parallel child processes, so
// several files can try to apply migrations at once. migrate() itself is
// idempotent but its schema_migrations insert can race; a Postgres advisory
// lock serializes migration runs across processes.

import pg from "pg";
import { migrate } from "../migrate.ts";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
export const HAS_DB = Boolean(TEST_DATABASE_URL);

const MIGRATE_LOCK_KEY = 0x4e4f5441_5259; // "NOTARY" as an advisory-lock key

let migrated: Promise<void> | null = null;

async function ensureMigrated(): Promise<void> {
  if (!TEST_DATABASE_URL) throw new Error("no test database configured");
  if (migrated) return migrated;
  migrated = (async () => {
    const lockClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await lockClient.connect();
    try {
      await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);
      await migrate(TEST_DATABASE_URL);
      await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]);
    } catch (err) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]);
      } catch {
        // best-effort unlock; the connection will close anyway
      }
      throw err;
    } finally {
      await lockClient.end();
    }
  })();
  return migrated;
}

/**
 * Returns a fresh connection pool with migrations applied. Callers are
 * responsible for pool.end(). Each test should create its own organization
 * (gen_random_uuid gives isolation); no shared test data is assumed.
 */
export async function freshPool(): Promise<pg.Pool> {
  if (!TEST_DATABASE_URL) throw new Error("no test database configured (set TEST_DATABASE_URL or DATABASE_URL)");
  await ensureMigrated();
  return new pg.Pool({ connectionString: TEST_DATABASE_URL });
}

/** Creates a throwaway organization and returns its id. */
export async function createOrganization(pool: pg.Pool): Promise<string> {
  const result = await pool.query("INSERT INTO organization (name) VALUES ('test-org') RETURNING id");
  return result.rows[0].id as string;
}

/** Creates a throwaway review under an organization. */
export async function createReview(pool: pg.Pool, organizationId: string): Promise<string> {
  const result = await pool.query(
    "INSERT INTO review (organization_id) VALUES ($1) RETURNING id",
    [organizationId],
  );
  return result.rows[0].id as string;
}
