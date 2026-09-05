// What actually happened in the most recent review?
//
// Every prior "why did the card look wrong" investigation in this codebase
// went the same way: four plausible causes, three ruled out by reading rows,
// and the real one visible only in the evidence table. This script reads all
// of that in one pass so the answer is facts rather than a guess about which
// query to run next.
//
// Touches nothing. Every statement is a SELECT.
//
// Run:  cd engine && DATABASE_URL="<prod url>" npx tsx scripts/latest-review.ts
//       (append a review id to inspect one other than the newest)

import pg from "pg";

const pad = (s: unknown, n: number) => String(s ?? "").padEnd(n);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(2);
  }
  console.log(`host: ${new URL(url.replace(/^postgres(ql)?:/, "http:")).host}\n`);

  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const wanted = process.argv[2];
    const r = wanted
      ? await c.query("SELECT * FROM review WHERE id = $1", [wanted])
      : await c.query("SELECT * FROM review ORDER BY created_at DESC LIMIT 1");
    if (r.rows.length === 0) {
      console.log("no review found.");
      return;
    }
    const review = r.rows[0];
    const elapsed =
      review.completed_at && review.created_at
        ? `${((+review.completed_at - +review.created_at) / 1000).toFixed(1)}s`
        : "(not marked complete)";
    console.log(`review     ${review.id}`);
    console.log(`created    ${review.created_at?.toISOString?.() ?? review.created_at}`);
    console.log(`status     ${review.status}   wall ${elapsed}\n`);

    // Evidence first. The thing that decides whether a check was even
    // possible is how much text the source actually carried.
    const ev = await c.query(
      `SELECT id, content_kind, retrieval_status, parse_status, canonical_url, submitted_url,
              length(resolved_text) AS chars, text_provenance
         FROM evidence WHERE review_id = $1 ORDER BY created_at`,
      [review.id],
    );
    console.log(`evidence (${ev.rows.length})`);
    console.log(`  ${pad("kind", 18)}${pad("retrieval", 12)}${pad("parse", 14)}${pad("chars", 8)}source`);
    for (const e of ev.rows) {
      const src = e.canonical_url === "inline" ? (e.submitted_url ?? "inline") : e.canonical_url;
      console.log(
        `  ${pad(e.content_kind, 18)}${pad(e.retrieval_status, 12)}${pad(e.parse_status, 14)}${pad(e.chars, 8)}${String(src ?? "").slice(0, 60)}`,
      );
    }

    const claims = await c.query(
      `SELECT id, ordinal, state, no_source, materiality, state_reason, left(text, 90) AS t
         FROM claim WHERE review_id = $1 ORDER BY ordinal`,
      [review.id],
    );
    const byState = new Map<string, number>();
    for (const cl of claims.rows) byState.set(cl.state, (byState.get(cl.state) ?? 0) + 1);
    console.log(`\nclaims (${claims.rows.length})  ` + [...byState].map(([s, n]) => `${s}=${n}`).join("  "));
    for (const cl of claims.rows) {
      console.log(`  ${pad(cl.ordinal, 4)}${pad(cl.state, 16)}${pad(cl.materiality ? "material" : "", 10)}${cl.t}`);
      if (cl.state_reason) console.log(`      reason: ${cl.state_reason}`);
    }

    const matches = await c.query(
      `SELECT m.relation, m.method, count(*)::int n
         FROM evidence_match m JOIN claim cl ON cl.id = m.claim_id
        WHERE cl.review_id = $1 GROUP BY m.relation, m.method`,
      [review.id],
    );
    console.log(matches.rows.length === 0 ? "\nevidence matches: none" : "\nevidence matches");
    for (const m of matches.rows) console.log(`  ${pad(m.relation, 14)}${pad(m.method, 20)}${m.n}`);

    try {
      const f = await c.query(
        `SELECT detector, type, rank, claim_ref, boundary_text
           FROM finding WHERE review_id = $1 ORDER BY rank LIMIT 20`,
        [review.id],
      );
      console.log(`\nfindings (${f.rows.length})`);
      for (const row of f.rows) {
        console.log(`  ${pad(row.rank, 4)}${pad(row.detector, 22)}${pad(row.type, 24)}${String(row.boundary_text).slice(0, 90)}`);
      }
    } catch {
      console.log("\nfindings: (table absent)");
    }

    try {
      const g = await c.query(
        `SELECT * FROM gap WHERE review_id = $1 LIMIT 20`,
        [review.id],
      );
      console.log(`\ngaps (${g.rows.length})`);
      for (const row of g.rows) console.log(`  ${JSON.stringify(row).slice(0, 200)}`);
    } catch {
      console.log("\ngaps: (table absent)");
    }

    // Did the judge run, and how much did it cost? The observation cache means
    // call count no longer tracks claims x sources, so read it rather than
    // inferring it.
    try {
      const obs = await c.query(
        `SELECT o.field, o.outcome, count(*)::int n
           FROM evidence_field_observation o JOIN evidence e ON e.id = o.evidence_id
          WHERE e.review_id = $1 GROUP BY o.field, o.outcome ORDER BY o.field`,
        [review.id],
      );
      console.log(`\njudge observations (${obs.rows.reduce((a, x) => a + x.n, 0)})`);
      for (const o of obs.rows) console.log(`  ${pad(o.field, 14)}${pad(o.outcome, 14)}${o.n}`);
    } catch {
      console.log("\njudge observations: (table absent)");
    }

    const usage = await c.query(
      `SELECT event_type, count(*)::int n, sum(estimated_cost_millicents)::bigint mc
         FROM usage_event WHERE review_id = $1 GROUP BY event_type ORDER BY n DESC`,
      [review.id],
    );
    console.log(`\nusage`);
    for (const u of usage.rows) {
      console.log(`  ${pad(u.event_type, 26)}${pad(u.n, 6)}$${(Number(u.mc) / 100000).toFixed(4)}`);
    }

    try {
      const act = await c.query(
        `SELECT i.status, i.error, count(m.id)::int moves
           FROM act_invocation i LEFT JOIN act_move m ON m.invocation_id = i.id
          WHERE i.review_id = $1 GROUP BY i.status, i.error`,
        [review.id],
      );
      console.log(act.rows.length === 0 ? "\nact: never invoked" : "\nact");
      for (const a of act.rows) console.log(`  ${pad(a.status, 10)}${pad(a.error ?? "", 30)}moves=${a.moves}`);
    } catch {
      console.log("\nact: (table absent)");
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
