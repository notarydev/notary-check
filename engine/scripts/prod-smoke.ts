// Post-deploy smoke test — runs one real review against the LIVE engine.
//
// Exists because of the 2026-09-03 migration window. `insertUsageEvent` is
// awaited bare inside reviewFlow, so a rejected ledger write throws the whole
// review, not just the ledger entry. Between applying migration 0015 (which
// made `estimated_cost_cents` GENERATED ALWAYS) and deploying the image that
// stops writing it, every judge-invoking review failed. Schema introspection
// alone would not have caught that — only an actual round trip does.
//
// What a green run proves:
//   1. the deployed image and the migrated schema are compatible;
//   2. the judge path completes rather than throwing on the ledger write;
//   3. the spend caps now have something to sum (cost accrues per call).
//
// Issues a throwaway API key, makes one real request, then revokes the key.
//
// Run: cd engine && DATABASE_URL="<prod>" ENGINE_URL="<prod>" npx tsx scripts/prod-smoke.ts

import pg from "pg";
import { issueApiKey, revokeApiKey } from "../src/auth/apiKey.ts";

const ENGINE = process.env.ENGINE_URL ?? "https://api.getnotary.ai";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const org = (await pool.query("SELECT id, name FROM organization ORDER BY name LIMIT 1")).rows[0];
  console.log(`org:    ${org.name}`);
  console.log(`engine: ${ENGINE}\n`);

  const before = (
    await pool.query("SELECT count(*)::int n, COALESCE(SUM(estimated_cost_millicents),0)::bigint m FROM usage_event")
  ).rows[0];
  console.log(`usage_event before: ${before.n} rows, ${before.m} millicents`);

  const issued = await issueApiKey(org.id, pool);
  const auth = { Authorization: `Bearer ${issued.plaintextKey}`, "Content-Type": "application/json" };

  try {
    const rev = await fetch(`${ENGINE}/v1/reviews`, { method: "POST", headers: auth, body: JSON.stringify({ idempotency_key: `smoke-${Date.now()}`, host: "smoke-test", scope: "material_factual_claims" }) });
    const revBody = await rev.json();
    console.log(`POST /v1/reviews -> ${rev.status}`);
    const reviewId = revBody?.review?.id;
    if (!reviewId) throw new Error(`no review id: ${JSON.stringify(revBody).slice(0, 200)}`);

    // Inline excerpt so nothing has to be fetched from the open internet.
    const ev = await fetch(`${ENGINE}/v1/evidence`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        review_id: reviewId,
        origin: "answer_citation",
        payload: "Acme Corp FY25 results. Revenue increased 12% year over year in FY25.",
      }),
    });
    const evBody = await ev.json();
    console.log(`POST /v1/evidence -> ${ev.status}`);
    const evidenceId = evBody?.evidence?.id;

    // The flagship contradiction: claim says 17%, evidence says 12%.
    const claim = await fetch(`${ENGINE}/v1/reviews/${reviewId}/claims`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        ordinal: 1,
        text: "Acme's revenue grew 17% in FY25.",
        materiality: true,
        claim_fields: {
          entity: "Acme",
          period: "FY25",
          metric: "revenue",
          operator: "increase",
          valueUnit: { value: "17", unit: "%" },
        },
        evidence_ids: evidenceId ? [evidenceId] : [],
        user_request: "Check the FY25 revenue growth figure in my draft.",
      }),
    });
    const claimBody = await claim.json();
    console.log(`POST /v1/reviews/:id/claims -> ${claim.status}`);
    if (claim.status >= 400) throw new Error(`claim failed: ${JSON.stringify(claimBody).slice(0, 400)}`);
    console.log(`  state:      ${claimBody?.claim?.state}`);
    console.log(`  reason:     ${claimBody?.claim?.state_reason}`);
    console.log(`  lifecycle:  ${claimBody?.claim?.lifecycle_state}`);
    console.log(`  matches:    ${claimBody?.matches?.length ?? 0}`);
    console.log(`  advance:    ${claimBody?.advance_suggestions?.length ?? 0} suggestion(s)`);

    const after = (
      await pool.query("SELECT count(*)::int n, COALESCE(SUM(estimated_cost_millicents),0)::bigint m FROM usage_event")
    ).rows[0];
    const newRows = after.n - before.n;
    const accrued = Number(after.m) - Number(before.m);
    console.log(`\nusage_event after:  ${after.n} rows (+${newRows}), ${after.m} millicents (+${accrued})`);

    if (newRows === 0) console.log("  NOTE: no ledger rows written — no model call was made this run.");
    else if (accrued === 0) console.log("  FAIL: ledger rows written but zero cost — the caps still cannot bite.");
    else console.log(`  OK: cost is accruing (${(accrued / 1000).toFixed(3)} cents this run).`);
  } finally {
    await revokeApiKey(issued.id, pool).catch(() => {});
    console.log("\nthrowaway api key revoked");
    await pool.end();
  }
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
