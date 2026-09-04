// Read-only production state check. Runs before and after a migration so the
// operator is reading facts, not recollection — the specific failure this
// exists to prevent is the one recorded in
// docs/build/architecture-and-progress.md, where a doc asserted a deploy state
// that the API contradicted.
//
// Touches nothing. Every statement is a SELECT.
//
// Run:  cd engine && DATABASE_URL="<prod url>" npx tsx scripts/prod-check.ts

import pg from "pg";

const TABLES = ["organization", "review", "claim", "evidence", "evidence_match", "usage_event", "advance_invocation"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(2);
  }
  // Never print the connection string; the host alone is enough to confirm
  // which database is being addressed.
  console.log(`host: ${new URL(url.replace(/^postgres(ql)?:/, "http:")).host}\n`);

  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const m = await c.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 5");
    console.log("migrations applied (newest first):");
    for (const r of m.rows) console.log(`  ${r.version}`);

    console.log("\nrow counts:");
    for (const t of TABLES) {
      try {
        const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
        console.log(`  ${t.padEnd(20)} ${r.rows[0].n}`);
      } catch {
        console.log(`  ${t.padEnd(20)} (table absent)`);
      }
    }

    // The two things migrations 0014 and 0015 are supposed to change. Checked
    // by introspection rather than by trusting the migration log, because a
    // migration row proves the file ran, not that the schema is what the file
    // intended.
    console.log("\n0014 — organization.advance_enabled:");
    const flag = await c.query(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_name = 'organization' AND column_name = 'advance_enabled'`,
    );
    console.log(flag.rowCount ? `  present, default ${flag.rows[0].column_default}` : "  ABSENT");

    console.log("\n0015 — usage_event cost columns:");
    const cols = await c.query(
      `SELECT column_name, data_type, is_generated FROM information_schema.columns
       WHERE table_name = 'usage_event' AND column_name LIKE 'estimated_cost%'
       ORDER BY column_name`,
    );
    if (cols.rowCount === 0) console.log("  none found");
    for (const r of cols.rows) {
      console.log(`  ${String(r.column_name).padEnd(28)} ${r.data_type.padEnd(10)} generated=${r.is_generated}`);
    }

    // The whole point of 0015: does the ledger actually record spend? A sum of
    // zero here after real traffic means the caps are still inert.
    try {
      const spend = await c.query(
        `SELECT COALESCE(SUM(estimated_cost_millicents), 0)::bigint AS milli, count(*)::int AS n
         FROM usage_event
         WHERE created_at >= date_trunc('month', now())`,
      );
      const milli = Number(spend.rows[0].milli);
      console.log(
        `\nmonth-to-date: ${spend.rows[0].n} usage events, ${milli} millicents (${(milli / 1000).toFixed(2)} cents)`,
      );
      if (spend.rows[0].n > 0 && milli === 0) {
        console.log("  WARNING: events recorded but zero cost — the spend caps cannot bite.");
      }
    } catch {
      console.log("\nmonth-to-date: estimated_cost_millicents absent (0015 not applied)");
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("CHECK FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
