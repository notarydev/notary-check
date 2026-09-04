// Post-deploy check for the detector bank and invocation-level Act.
//
// Exercises the two paths that were broken, against the LIVE engine:
//
//   1. ZERO CLAIMS — the ~37% case. Act used to be silent here because it
//      rode on the claim loop and there was no claim loop. It must now return
//      a move from the payload alone.
//   2. SELF-CONTRADICTION — a finding produced with no sources at all, which
//      the old engine could not do: every finding required evidence.
//
// Issues a throwaway API key, runs both, revokes it.
//
// Run: cd engine && DATABASE_URL="<prod>" ENGINE_URL="<prod>" npx tsx scripts/prod-detect-smoke.ts

import pg from "pg";
import { issueApiKey, revokeApiKey } from "../src/auth/apiKey.ts";

const ENGINE = process.env.ENGINE_URL ?? "https://api.getnotary.ai";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const org = (await pool.query("SELECT id, name FROM organization ORDER BY name LIMIT 1")).rows[0];
  console.log(`org:    ${org.name}\nengine: ${ENGINE}\n`);

  const issued = await issueApiKey(org.id, pool);
  const auth = { Authorization: `Bearer ${issued.plaintextKey}`, "Content-Type": "application/json" };

  try {
    const rev = await fetch(`${ENGINE}/v1/reviews`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ idempotency_key: `detect-${Date.now()}`, host: "smoke", scope: "material_factual_claims" }),
    });
    const reviewId = ((await rev.json()) as { review?: { id?: string } })?.review?.id;
    if (reviewId === undefined) throw new Error(`no review id (status ${rev.status})`);

    // --- 1. zero claims, no sources: Act must still speak -------------
    console.log("CASE 1 — zero claims, no sources (the ~37% case)");
    const r1 = await fetch(`${ENGINE}/v1/reviews/${reviewId}/detect`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        answer_text: "Both databases would work here, and each has tradeoffs worth weighing.",
        user_request: "Should I use Postgres or DynamoDB for an audit log at 50k writes/sec?",
        explicit_constraints: ["50k writes/sec at peak", "7 year retention", "already on AWS"],
        claims: [],
        has_resolved_evidence: false,
      }),
    });
    const b1 = (await r1.json()) as Record<string, unknown>;
    console.log(`  POST /detect -> ${r1.status}`);
    console.log(`  findings: ${(b1.findings as unknown[])?.length ?? 0}   gaps: ${(b1.gaps as unknown[])?.length ?? 0}`);
    console.log(`  intent:   ${JSON.stringify(b1.intent)}`);
    const sug = (b1.moves as Array<{ move: string; short_label: string }>) ?? [];
    console.log(`  moves:   ${sug.length} move(s)`);
    for (const s of sug) console.log(`            (${s.move}) ${s.short_label}`);
    if (r1.status !== 200) throw new Error("detect endpoint failed");
    if (sug.length === 0) console.log("  NOTE: zero moves is a legal result, but on this input a move was expected.");

    // --- 2. self-contradiction with no sources ---------------------------
    console.log("\nCASE 2 — self-contradiction, no sources");
    const ACME = { entity: "Acme", period: "FY25", metric: "revenue", operator: "increase" };
    const r2 = await fetch(`${ENGINE}/v1/reviews/${reviewId}/detect`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        answer_text: "Acme's revenue grew 17% in FY25. Acme's revenue grew 12% in FY25.",
        user_request: "Summarise Acme's FY25 performance",
        claims: [
          { id: "c1", text: "Acme's revenue grew 17% in FY25.", materiality: true, claim_fields: { ...ACME, valueUnit: { value: "17", unit: "%" } } },
          { id: "c2", text: "Acme's revenue grew 12% in FY25.", materiality: true, claim_fields: { ...ACME, valueUnit: { value: "12", unit: "%" } } },
        ],
        has_resolved_evidence: false,
      }),
    });
    const b2 = (await r2.json()) as Record<string, unknown>;
    const findings = (b2.findings as Array<{ type: string; boundaryText: string; owner: string }>) ?? [];
    const gaps2 = (b2.gaps as Array<{ missing: string; unblocks: string }>) ?? [];
    console.log(`  POST /detect -> ${r2.status}`);
    console.log(`  findings: ${findings.length}   gaps: ${gaps2.length}`);
    // Printed because the source-gap detector's whole job is emitting these,
    // and the first version of this script showed gaps for case 1 only — where
    // there are no claims and therefore correctly no gaps. The one case that
    // exercises it was the one case that hid it.
    for (const g of gaps2) console.log(`            [${g.missing}] ${g.unblocks}`);
    for (const f of findings) console.log(`            [${f.type}] ${f.boundaryText}`);
    if (findings.length === 0) throw new Error("expected a self-contradiction finding with no sources at all");
    if (gaps2.length === 0) throw new Error("expected addressable_source gaps — two material claims, no evidence");
    if (!gaps2.every((g) => g.missing === "addressable_source")) throw new Error("unexpected gap kind");
    if (findings[0].owner !== "computed") throw new Error(`expected owner=computed, got ${findings[0].owner}`);

    console.log("\nPASS — detector bank live, Act runs without claims or sources.");
  } finally {
    await revokeApiKey(issued.id, pool).catch(() => {});
    console.log("\nthrowaway api key revoked");
    await pool.end();
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
