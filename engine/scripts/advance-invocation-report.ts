// How often did Advance actually RUN, versus never being invoked at all?
//
// This is the measurement that should have preceded any argument about what
// Track 2 should be. `advance_invocation.status` was deliberately designed to
// tell three situations apart (migration 0013):
//
//   'ok'      — a call happened (0-2 suggestions is a real result)
//   'error'   — a call was attempted and failed
//   'skipped' — no call was attempted: no legal move, or no user_request
//
// "Track 2 didn't kick off" is ambiguous between "it ran and found nothing"
// and "it never ran." Only this table can separate them, and separating them
// decides whether the problem is Advance's design or the connector's ask.

import pg from "pg";

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const total = await c.query("SELECT count(*)::int n FROM advance_invocation");
    console.log(`advance_invocation rows: ${total.rows[0].n}\n`);

    const byStatus = await c.query(
      `SELECT status, error, count(*)::int n FROM advance_invocation
       GROUP BY status, error ORDER BY n DESC`,
    );
    console.log("status breakdown:");
    for (const r of byStatus.rows) {
      console.log(`  ${String(r.status).padEnd(9)} ${String(r.error ?? "").padEnd(28)} ${r.n}`);
    }

    const sug = await c.query(
      `SELECT i.status, count(s.id)::int suggestions
       FROM advance_invocation i LEFT JOIN advance_suggestion s ON s.invocation_id = i.id
       GROUP BY i.status`,
    );
    console.log("\nsuggestions produced, by invocation status:");
    for (const r of sug.rows) console.log(`  ${String(r.status).padEnd(9)} ${r.suggestions}`);

    // The distribution that actually matters: among calls that RAN, how many
    // produced 0, 1, or 2? That is the "only when it makes sense" contract.
    const dist = await c.query(
      `SELECT k.n AS count, count(*)::int rows FROM (
         SELECT i.id, count(s.id)::int AS n
         FROM advance_invocation i LEFT JOIN advance_suggestion s ON s.invocation_id = i.id
         WHERE i.status = 'ok' GROUP BY i.id
       ) k GROUP BY k.n ORDER BY k.n`,
    );
    console.log("\nfor calls that actually ran (status='ok'):");
    if (dist.rowCount === 0) console.log("  none — Advance has never completed a call in production");
    for (const r of dist.rows) console.log(`  ${r.count} suggestion(s): ${r.rows} invocation(s)`);

    // Track 1 volume for comparison — how many claims went by without Advance.
    const claims = await c.query("SELECT count(*)::int n FROM claim");
    console.log(`\nclaims in production: ${claims.rows[0].n}`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
