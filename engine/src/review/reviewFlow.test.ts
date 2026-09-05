// End-to-end tests for the review orchestrator (reviewFlow.ts) — the full
// deterministic-first pipeline against a real Postgres. Evidence rows are
// seeded directly with `resolved_text` (retrieval is covered separately in
// resolveEvidence.test.ts), so these tests focus on the pipeline composition.
//
// The judge-path tests (contradiction, entailed + usage) hit the REAL DeepSeek
// API and skip cleanly when DEEPSEEK_API_KEY is not set (same pattern as
// judge/liveApi.test.ts). A contradiction is only reachable through the judge
// in this design: the deterministic pass always resolves a field to the claim's
// OWN value, so a differing evidence value can only surface via judge
// extraction of the residue.

import "dotenv/config";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import type { JudgeCallInput, JudgeClient, JudgeCallResult } from "../judge/judgeClient.ts";
import type { ClaimFields } from "../verification/applicability.ts";
import { runReview } from "./reviewFlow.ts";
import { createOrganization, createReview, freshPool, HAS_DB } from "../test/db.ts";

const HAS_KEY = Boolean(process.env.DEEPSEEK_API_KEY);

const dbSkip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };
const judgeSkip = {
  skip: !HAS_DB
    ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)"
    : !HAS_KEY
      ? "no DEEPSEEK_API_KEY set (live judge test skips)"
      : false,
};

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

// The plan's flagship claim: "Acme's revenue grew 17% in FY25."
const CLAIM_FIELDS: ClaimFields = {
  entity: "Acme",
  period: "FY25",
  metric: "revenue",
  operator: "increase",
  valueUnit: { value: "17", unit: "%" },
  comparatorBaseline: "prior year",
  modality: "actual",
  scope: "company-wide",
};

// Every claim field appears literally in the evidence text — including the
// operator "increase" inside "increased" — so all fields are resolvable
// deterministically (no judge residue).
const SUPPORT_TEXT = "Acme's revenue increased 17% in FY25, compared to the prior year, actual company-wide figures.";
// Identical but for the value: 12%, so the ONLY residue is valueUnit.
const CONTRADICT_TEXT = "Acme's revenue increased 12% in FY25, compared to the prior year, actual company-wide figures.";
// Locked case 2's paraphrased variant (§ HANDOFF.md "2026-09-02 — live-endpoint
// verification pass" — the live bug found and fixed this session). Operator is
// paraphrased ("declined" vs the claim's "increase"/"grew") AND the value
// differs, so BOTH operator and valueUnit are judge residue (neither appears
// verbatim in the text): the deterministic pass never finds the literal string
// "increase" or "17" anywhere in this passage.
const PARAPHRASED_CONTRADICT_TEXT =
  "Acme's revenue declined 12 percent in fiscal 2025, compared to the prior year, actual company-wide figures.";
// Wrong entity: every field resolves deterministically EXCEPT entity — "Acme"
// never appears, so entity is the single residual field. Under a denied quota
// it resolves to cannot_be_determined (unestablished), so the row comes back
// inapplicable with mismatchedFields exactly ["entity"].
const WRONG_ENTITY_GLOBEX_TEXT = "Globex's revenue increased 17% in FY25, compared to the prior year, actual company-wide figures.";
const WRONG_ENTITY_INITECH_TEXT = "Initech's revenue increased 17% in FY25, compared to the prior year, actual company-wide figures.";

async function seedRetrievedEvidence(
  pool: pg.Pool,
  reviewId: string,
  resolvedText: string,
  submittedUrl = "https://example.com/report",
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO evidence (review_id, origin, submitted_url, canonical_url, payload_hash, retrieval_status, resolved_text)
     VALUES ($1, 'answer_citation', $2, $2, $3, 'retrieved', $4)
     RETURNING id`,
    [reviewId, submittedUrl, sha256(resolvedText), resolvedText],
  );
  return result.rows[0].id as string;
}

async function countUsageEvents(pool: pg.Pool, organizationId: string, reviewId: string): Promise<number> {
  const result = await pool.query(
    "SELECT count(*)::int AS n FROM usage_event WHERE organization_id = $1 AND review_id = $2",
    [organizationId, reviewId],
  );
  return result.rows[0].n as number;
}

test(
  "exact support (locked case 1): all fields verbatim → SUPPORTED with a quoted_or_computed match and no judge usage",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, SUPPORT_TEXT);

      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          materiality: true,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [evidenceId],
        },
        pool,
      );

      assert.equal(result.state, "SUPPORTED");
      assert.equal(result.stateReason, "supporting_applicable_relation");
      assert.equal(result.noSource, false);
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].evidenceId, evidenceId);
      assert.equal(result.matches[0].relation, "supports");
      assert.equal(result.matches[0].method, "quoted_or_computed");
      // REGRESSION (audit bug 1): the match must carry a REAL passage
      // coordinate, not a URL. The first contributing field is entity ("Acme"),
      // which opens SUPPORT_TEXT, so the span is exactly [0, 4).
      const locator = result.matches[0].locator;
      assert.equal(locator.kind, "text_offsets");
      assert.equal(locator.kind === "text_offsets" && locator.start, 0);
      assert.equal(locator.kind === "text_offsets" && locator.end, 4);
      assert.equal(locator.kind === "text_offsets" && locator.quote, "Acme");
      assert.equal(locator.kind === "text_offsets" && locator.provenance, "fetched");
      assert.equal(locator.kind === "text_offsets" && locator.canonicalTextHash, sha256(SUPPORT_TEXT));
      // The pipeline ran to completion, so `state` is readable as a finding.
      assert.equal(result.lifecycle, "completed");
      assert.equal(result.lifecycleDetail, null);
      assert.equal(result.checksCompleted, true);

      const claim = (await pool.query("SELECT * FROM claim WHERE id = $1", [result.claimId])).rows[0] as Record<string, unknown>;
      assert.equal(claim.review_id, reviewId);
      assert.equal(claim.ordinal, 1);
      assert.equal(claim.state, "SUPPORTED");
      assert.equal(claim.no_source, false);
      assert.equal(claim.policy_version, "orchestrator-v1");
      assert.equal(claim.state_reason, "supporting_applicable_relation");

      const matches = (await pool.query("SELECT * FROM evidence_match WHERE claim_id = $1", [result.claimId])).rows[0] as Record<string, unknown>;
      assert.equal(matches.evidence_id, evidenceId);
      // The human-readable locator column now names the PASSAGE, not just the
      // source: "<url>#chars=<start>-<end>". Before the fix it was the bare URL.
      assert.equal(matches.locator, "https://example.com/report#chars=0-4");
      // ...and the structured coordinate is persisted alongside it, with proof
      // it was actually dereferenced against the retained text.
      assert.equal(matches.locator_resolved, true);
      assert.ok(matches.locator_resolved_at !== null);
      const locatorJson = matches.locator_json as { primary: { kind: string; start: number; end: number; quote: string } };
      assert.equal(locatorJson.primary.kind, "text_offsets");
      assert.equal(locatorJson.primary.quote, "Acme");
      assert.equal(SUPPORT_TEXT.slice(locatorJson.primary.start, locatorJson.primary.end), "Acme");
      assert.equal((claim as { lifecycle_state: string }).lifecycle_state, "completed");
      assert.equal(matches.resolved_text_hash, sha256(SUPPORT_TEXT));
      assert.equal(matches.relation, "supports");
      assert.equal(matches.method, "quoted_or_computed");
      assert.equal(matches.evaluator_version, "deterministic-only");
      // pg deserializes the jsonb column into an object; it must carry the
      // ApplicabilityResult's applicability flag and matched fields.
      assert.ok(typeof matches.applicability_json === "object" && matches.applicability_json !== null);
      assert.equal((matches.applicability_json as { applicable: boolean }).applicable, true);

      // No residual fields → no judge call → no usage event.
      assert.equal(await countUsageEvents(pool, orgId, reviewId), 0);
    } finally {
      await pool.end();
    }
  },
);

test(
  "flagship 17% vs 12% contradiction (locked case 2): same entity/period/etc, differing value → CONTRADICTED",
  { ...judgeSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, CONTRADICT_TEXT);

      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [evidenceId],
        },
        pool,
      );

      assert.equal(result.state, "CONTRADICTED");
      assert.equal(result.stateReason, "contradicting_applicable_relation");
      assert.equal(result.noSource, false);
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].evidenceId, evidenceId);
      assert.equal(result.matches[0].relation, "contradicts");
      assert.equal(result.matches[0].method, "entailed");

      const matches = (await pool.query("SELECT * FROM evidence_match WHERE claim_id = $1", [result.claimId])).rows[0] as Record<string, unknown>;
      assert.equal(matches.relation, "contradicts");
      assert.equal(matches.method, "entailed");
      // v3 (2026-09-04): the judge's output contract gained `candidates` —
      // the competing readings it saw when a field is ambiguous. Bumping the
      // version is the point of this assertion: answers stored under v2 were
      // produced by a prompt that could not report them, so the two are not
      // comparable and must not silently share a version.
      assert.equal(matches.evaluator_version, "deepseek-v4-flash:judge-field-extraction-v3");
      // A contradiction is a POSITIVE finding about the evidence, so it may
      // only be persisted with a locator that actually dereferenced.
      assert.equal(matches.locator_resolved, true);
    } finally {
      await pool.end();
    }
  },
);

test(
  "paraphrased contradiction (locked case 2 variant): operator paraphrase ('declined' → decrease) + differing value → CONTRADICTED, not UNSUPPORTED",
  { ...judgeSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, PARAPHRASED_CONTRADICT_TEXT);

      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [evidenceId],
        },
        pool,
      );

      // Before the fix, applicability.ts treated an operator mismatch like any
      // other STRING_FIELD mismatch (entity/period/...), excluding the row as
      // inapplicable instead of registering it as a contradiction — the row
      // produced no relation at all, and the claim fell through to
      // UNSUPPORTED/no_support_after_completed_checks.
      assert.equal(result.state, "CONTRADICTED");
      assert.equal(result.stateReason, "contradicting_applicable_relation");
      assert.equal(result.rejectedCandidates.length, 0, "the row must not be excluded as inapplicable");
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].evidenceId, evidenceId);
      assert.equal(result.matches[0].relation, "contradicts");
      assert.equal(result.matches[0].method, "entailed");
      // The judge derives operator "decrease" from the word "declined", so that
      // value is by construction NOT a literal in the passage. The row is still
      // required to produce a real locator — from another contributing field —
      // before it may contradict; a closed-vocabulary field alone can never
      // carry a match (see CLOSED_VOCABULARY_FIELDS in reviewFlow.ts).
      assert.equal(result.matches[0].locator.kind, "text_offsets");

      const matches = (await pool.query("SELECT * FROM evidence_match WHERE claim_id = $1", [result.claimId])).rows[0] as Record<string, unknown>;
      assert.equal(matches.relation, "contradicts");
      assert.equal(matches.method, "entailed");
    } finally {
      await pool.end();
    }
  },
);

test(
  "a field only resolvable via the judge: the judge path runs for real, method is entailed, and a usage_event row is persisted",
  { ...judgeSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      // All string fields verbatim; only the value differs — the residue is
      // exactly one field (valueUnit), resolved by the real judge.
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, CONTRADICT_TEXT);

      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [evidenceId],
        },
        pool,
      );

      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].method, "entailed", "the residual valueUnit was established by the judge");
      assert.equal(result.matches[0].relation, "contradicts");

      // The real DeepSeek call happened → token counts → a usage_event row was
      // written against this review.
      const usage = await countUsageEvents(pool, orgId, reviewId);
      assert.equal(usage, 1, "exactly one judge call was made for the single residual field");
    } finally {
      await pool.end();
    }
  },
);

test(
  "a judge-resolved entity that only matches via normalization: claim 'Acme, Inc.' vs evidence 'ACME INC' → SUPPORTED (normalization end-to-end)",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      // Claim entity "Acme, Inc." never appears verbatim (comma + trailing
      // period + different case), so the deterministic exact-substring pass in
      // reviewFlow.ts leaves entity residual and hands it to the judge.
      const evidenceText = "ACME INC's revenue increased 17% in FY25, compared to the prior year, actual company-wide figures.";
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, evidenceText);

      const originalKey = process.env.DEEPSEEK_API_KEY;
      const originalFetch = globalThis.fetch;
      process.env.DEEPSEEK_API_KEY = "test-key-for-mocked-judge";
      // Mock the judge client's transport (judgeClient.ts's injectable httpCall
      // defaults to global fetch): every DeepSeek call answers that the evidence
      // establishes the entity "ACME INC" verbatim. All other traffic passes
      // through to the real fetch untouched.
      globalThis.fetch = (async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://api.deepseek.com/")) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      reasoning: "The passage opens by naming ACME INC.",
                      outcome: "present",
                      value: "ACME INC",
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      try {
        const result = await runReview(
          {
            organizationId: orgId,
            reviewId,
            claimText: "Acme, Inc.'s revenue grew 17% in FY25.",
            ordinal: 1,
            claimFields: { ...CLAIM_FIELDS, entity: "Acme, Inc." },
            evidenceIds: [evidenceId],
          },
          pool,
        );

        // The judge established entity as "ACME INC"; the normalization-aware
        // assessApplicability must match it against the claim's "Acme, Inc."
        // via entity-corporate-suffix-v1 (not exact equality), so the row
        // applies and the claim is supported. Without that normalization the
        // row would be inapplicable (UNSUPPORTED).
        assert.equal(result.state, "SUPPORTED");
        assert.equal(result.stateReason, "supporting_applicable_relation");
        assert.equal(result.matches.length, 1);
        assert.equal(result.matches[0].method, "entailed", "entity was the judge-resolved residue, so the match is entailed");
        assert.equal(result.matches[0].relation, "supports");
      } finally {
        if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
        else process.env.DEEPSEEK_API_KEY = originalKey;
        globalThis.fetch = originalFetch;
      }
    } finally {
      await pool.end();
    }
  },
);

test(
  "no addressable source at all (locked case 4): empty evidence list → INDETERMINATE / no_source",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);

      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [],
        },
        pool,
      );

      assert.equal(result.state, "INDETERMINATE");
      assert.equal(result.stateReason, "no_source");
      assert.equal(result.noSource, true);
      assert.deepEqual(result.matches, []);

      const claim = (await pool.query("SELECT * FROM claim WHERE id = $1", [result.claimId])).rows[0] as Record<string, unknown>;
      assert.equal(claim.no_source, true);
      assert.equal(claim.state_reason, "no_source");
      const matchCount = (await pool.query("SELECT count(*)::int AS n FROM evidence_match WHERE claim_id = $1", [result.claimId])).rows[0].n;
      assert.equal(matchCount, 0, "no source → no evidence_match rows");
    } finally {
      await pool.end();
    }
  },
);

test("no_source when the only bound evidence is unavailable (discarded, but no addressable source ever reached 'retrieved')", { ...dbSkip }, async () => {
  const pool = await freshPool();
  try {
    const orgId = await createOrganization(pool);
    const reviewId = await createReview(pool, orgId);
    const unavailable = await pool.query(
      `INSERT INTO evidence (review_id, origin, submitted_url, retrieval_status)
       VALUES ($1, 'answer_citation', 'https://example.com/gone', 'unavailable')
       RETURNING id`,
      [reviewId],
    );
    const evidenceId = unavailable.rows[0].id as string;

    const result = await runReview(
      {
        organizationId: orgId,
        reviewId,
        claimText: "Acme's revenue grew 17% in FY25.",
        ordinal: 1,
        claimFields: CLAIM_FIELDS,
        evidenceIds: [evidenceId],
      },
      pool,
    );

    assert.equal(result.state, "INDETERMINATE");
    assert.equal(result.stateReason, "no_source");
    assert.equal(result.noSource, true);
    assert.deepEqual(result.matches, []);
  } finally {
    await pool.end();
  }
});

test("caller-supplied evidence ids that do not belong to the review are silently skipped", { ...dbSkip }, async () => {
  const pool = await freshPool();
  try {
    const orgA = await createOrganization(pool);
    const reviewA = await createReview(pool, orgA);
    const orgB = await createOrganization(pool);
    const reviewB = await createReview(pool, orgB);
    // Evidence belongs to reviewB, but the caller passes it against reviewA.
    const foreign = await seedRetrievedEvidence(pool, reviewB, SUPPORT_TEXT);

    const result = await runReview(
      {
        organizationId: orgA,
        reviewId: reviewA,
        claimText: "Acme's revenue grew 17% in FY25.",
        ordinal: 1,
        claimFields: CLAIM_FIELDS,
        evidenceIds: [foreign],
      },
      pool,
    );

    assert.equal(result.state, "INDETERMINATE");
    assert.equal(result.noSource, true);
    assert.deepEqual(result.matches, []);
  } finally {
    await pool.end();
  }
});

test("quota exceeded (NOTARY_ORG_MONTHLY_LIMIT_CENTS=0): residual fields resolve without any judge call and without crashing", { ...dbSkip }, async () => {
  const originalLimit = process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
  process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "0";
  const pool = await freshPool();
  try {
    const orgId = await createOrganization(pool);
    const reviewId = await createReview(pool, orgId);
    // valueUnit is a residual field — IF the flow wrongly called the judge
    // despite the quota denial, the field would resolve to 12% and produce
    // CONTRADICTED. The quota path must instead short-circuit it.
    const evidenceId = await seedRetrievedEvidence(pool, reviewId, CONTRADICT_TEXT);

    const result = await runReview(
      {
        organizationId: orgId,
        reviewId,
        claimText: "Acme's revenue grew 17% in FY25.",
        ordinal: 1,
        claimFields: CLAIM_FIELDS,
        evidenceIds: [evidenceId],
      },
      pool,
    );

    // REGRESSION (audit bugs 3 + 5). This test previously asserted UNSUPPORTED
    // / no_support_after_completed_checks — i.e. "the defined checks completed
    // and the evidence did not support the claim". That was false: the checks
    // did NOT complete, they were refused for lack of budget. Reporting a
    // quota denial as a substantive finding about the evidence is exactly the
    // UNSUPPORTED/INDETERMINATE conflation the audit found. checksCompleted is
    // now derived from real completion, so this lands INDETERMINATE.
    assert.equal(result.state, "INDETERMINATE");
    assert.equal(result.stateReason, "checks_did_not_complete");
    assert.equal(result.checksCompleted, false);
    assert.equal(result.lifecycle, "not_checkable");
    assert.equal(result.lifecycleDetail, "quota_denied");
    assert.deepEqual(result.matches, []);
    // Zero usage events proves no real judge call reached the network.
    assert.equal(await countUsageEvents(pool, orgId, reviewId), 0);
  } finally {
    if (originalLimit === undefined) delete process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
    else process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = originalLimit;
    await pool.end();
  }
});

test(
  "an applicable-support row plus an inapplicable wrong-entity row → matches has only the supporter, rejectedCandidates has exactly the wrong-entity row",
  { ...dbSkip },
  async () => {
    const originalLimit = process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
    process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "0";
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const supportId = await seedRetrievedEvidence(pool, reviewId, SUPPORT_TEXT, "https://example.com/acme-report");
      const rejectedId = await seedRetrievedEvidence(pool, reviewId, WRONG_ENTITY_GLOBEX_TEXT, "https://example.com/globex-report");

      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [supportId, rejectedId],
        },
        pool,
      );

      assert.equal(result.state, "SUPPORTED");
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].evidenceId, supportId);
      assert.equal(result.matches[0].relation, "supports");
      assert.equal(result.matches[0].method, "quoted_or_computed");

      assert.equal(result.rejectedCandidates.length, 1, "exactly one rejected candidate (the wrong-entity row)");
      const rejected = result.rejectedCandidates[0];
      assert.equal(rejected.evidenceId, rejectedId);
      assert.equal(rejected.locator, "https://example.com/globex-report");
      assert.deepEqual(rejected.mismatchedFields, ["entity"]);
      assert.ok(rejected.details.length >= 1, "the entity mismatch carries a detail");
      assert.equal(rejected.details[0].field, "entity");
      assert.ok(rejected.details[0].detail.length > 0, "the detail string is non-empty");

      // Rejected candidates are response-shape only: no evidence_match row is
      // written for the inapplicable row.
      const matches = (await pool.query("SELECT evidence_id FROM evidence_match WHERE claim_id = $1", [result.claimId])).rows as Array<{ evidence_id: string }>;
      assert.equal(matches.length, 1);
      assert.equal(matches[0].evidence_id, supportId);
    } finally {
      if (originalLimit === undefined) delete process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
      else process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = originalLimit;
      await pool.end();
    }
  },
);

test(
  "wrong entity: the judge is asked ONCE, not once per field — and the verdict is unchanged",
  { ...judgeSkip },
  async () => {
    // E-LAT-a. A real answer cost 286 judge calls, 94 seconds and 9.5 cents and
    // produced zero matches: every field of every evidence row of every claim
    // was asked, including for pairs that could never be applicable.
    //
    // assessApplicability requires entity agreement, so a row whose entity the
    // judge cannot find can never match. Entity is now asked first and alone,
    // and the rest of the row is skipped when it comes back absent.
    //
    // The assertion that matters is the SECOND one: skipping must not change
    // the outcome. An optimisation that quietly moves a claim from UNSUPPORTED
    // to INDETERMINATE would be a regression wearing a speedup's clothes.
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      // Globex's passage matches the claim on period, metric, operator and
      // value — every field EXCEPT entity, which never appears. Before this
      // change all of them were asked; now the row dies on the first.
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, WRONG_ENTITY_GLOBEX_TEXT, "https://example.com/globex");

      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [evidenceId],
        },
        pool,
      );

      const calls = await countUsageEvents(pool, orgId, reviewId);
      assert.ok(
        calls <= 2,
        `a foreclosed row must cost about one judge call, not one per residual field — got ${calls}`,
      );

      assert.equal(result.matches.length, 0, "a wrong-entity row must never produce a match");
      assert.equal(
        result.rejectedCandidates.length,
        1,
        "and it must still be REPORTED as rejected — skipping the remaining fields must not hide the row",
      );
      assert.ok(
        result.state === "UNSUPPORTED" || result.state === "INDETERMINATE",
        `state must be unchanged by the skip, got ${result.state}`,
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "all bound rows inapplicable (wrong entity) under a denied quota → matches empty, state INDETERMINATE, rejectedCandidates has one entry per inapplicable row",
  { ...dbSkip },
  async () => {
    const originalLimit = process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
    process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "0";
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const globexId = await seedRetrievedEvidence(pool, reviewId, WRONG_ENTITY_GLOBEX_TEXT, "https://example.com/globex-report");
      const initechId = await seedRetrievedEvidence(pool, reviewId, WRONG_ENTITY_INITECH_TEXT, "https://example.com/initech-report");

      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [globexId, initechId],
        },
        pool,
      );

      // REGRESSION (audit bug 3). This test runs with the quota denied, so the
      // entity residue was never actually judged — the checks did not complete.
      // It used to assert UNSUPPORTED, which claimed a completed check had been
      // run and found nothing; the rejections are real, but the reason no
      // relation exists is that nothing could be established, not that the
      // evidence failed to support. A separate test below keeps UNSUPPORTED
      // genuinely reachable when the judge DOES answer.
      assert.equal(result.state, "INDETERMINATE");
      assert.equal(result.stateReason, "checks_did_not_complete");
      assert.equal(result.lifecycle, "not_checkable");
      assert.deepEqual(result.matches, []);

      assert.equal(result.rejectedCandidates.length, 2, "one rejected candidate per inapplicable row");
      const candidateIds = result.rejectedCandidates.map((r) => r.evidenceId).sort();
      assert.deepEqual(candidateIds, [globexId, initechId].sort());
      for (const candidate of result.rejectedCandidates) {
        assert.deepEqual(candidate.mismatchedFields, ["entity"]);
        assert.ok(candidate.details.length >= 1);
        assert.ok(candidate.details[0].detail.length > 0);
      }

      // No applicable rows → no evidence_match rows persisted at all.
      const matchCount = (await pool.query("SELECT count(*)::int AS n FROM evidence_match WHERE claim_id = $1", [result.claimId])).rows[0].n;
      assert.equal(matchCount, 0);
    } finally {
      if (originalLimit === undefined) delete process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
      else process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = originalLimit;
      await pool.end();
    }
  },
);

test(
  "a bound unavailable row (never resolved) never appears in rejectedCandidates — only resolved-but-inapplicable rows do",
  { ...dbSkip },
  async () => {
    const originalLimit = process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
    process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "0";
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const inapplicableId = await seedRetrievedEvidence(pool, reviewId, WRONG_ENTITY_GLOBEX_TEXT, "https://example.com/globex-report");
      const unavailableResult = await pool.query(
        `INSERT INTO evidence (review_id, origin, submitted_url, retrieval_status)
         VALUES ($1, 'answer_citation', 'https://example.com/gone', 'unavailable')
         RETURNING id`,
        [reviewId],
      );
      const unavailableId = unavailableResult.rows[0].id as string;

      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [inapplicableId, unavailableId],
        },
        pool,
      );

      // Same quota-denied situation as the test above: the checks could not
      // complete, so INDETERMINATE rather than UNSUPPORTED. What this test is
      // actually guarding is unchanged — which rows reach rejectedCandidates.
      assert.equal(result.state, "INDETERMINATE");
      assert.deepEqual(result.matches, []);
      assert.equal(result.rejectedCandidates.length, 1, "only the resolved-but-inapplicable row belongs in rejectedCandidates");
      assert.equal(result.rejectedCandidates[0].evidenceId, inapplicableId);
      assert.ok(
        !result.rejectedCandidates.some((r) => r.evidenceId === unavailableId),
        "the unavailable row never reached applicability and must not appear",
      );
    } finally {
      if (originalLimit === undefined) delete process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
      else process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = originalLimit;
      await pool.end();
    }
  },
);

// ── MOVE — concurrent-not-blocking, and the no-user_request skip ────────
//
// Move runs alongside Act/Challenge (Promise.all), strictly AFTER
// Verify's claim + evidence_match rows are already committed. These tests
// prove the two correctness properties the handoff explicitly calls for:
// (1) Verify's own result is identical whether or not a user_request (and
// therefore Move) was supplied, and identical even when Move's own
// call is slow or fails; (2) no user_request means Move is skipped
// entirely — no client invocation, a 'skipped' act_invocation row, never
// a guess.

/** A judge client that counts calls, delays briefly, and returns one legal
 * clarify move — used to prove Move can run without altering or
 * delaying the Verify result already computed above it. */
function delayedMoveClient(delayMs: number): { client: JudgeClient; calls: () => number } {
  let calls = 0;
  const client: JudgeClient = {
    async call(_input: JudgeCallInput): Promise<JudgeCallResult> {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        status: "ok",
        record: {
          model: "deepseek-v4-flash",
          promptVersion: "v",
          question: "q",
          answer: JSON.stringify({
            moves: [{ id: "s1", short_label: "Confirm the FY period", move: "clarify", prompt: "Ask which fiscal period this figure covers." }],
          }),
          inputTokens: 50,
          outputTokens: 20,
        },
      };
    },
  };
  return { client, calls: () => calls };
}

/** A judge client whose call always throws — proves a Move transport
 * failure cannot propagate into or alter a committed Verify result. */
function throwingMoveClient(): JudgeClient {
  return {
    async call(_input: JudgeCallInput): Promise<JudgeCallResult> {
      throw new Error("simulated move transport failure");
    },
  };
}

test(
  "Move running alongside Act/Challenge does not delay or alter Verify's own committed result",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, SUPPORT_TEXT);

      const { client: moveClient, calls } = delayedMoveClient(50);
      const started = performance.now();
      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          materiality: true,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [evidenceId],
          userRequest: "Can you double-check Acme's FY25 revenue growth figure for me?",
        },
        pool,
        { moveClient },
      );
      const elapsedMs = performance.now() - started;

      // Verify's own finding — identical to the plain SUPPORTED test above,
      // unaffected by Move running concurrently alongside it.
      assert.equal(result.state, "SUPPORTED");
      assert.equal(result.stateReason, "supporting_applicable_relation");
      assert.equal(result.matches.length, 1);
      assert.equal(result.lifecycle, "completed");
      assert.equal(result.checksCompleted, true);

      // Move actually ran (concurrently, not skipped) and returned its one
      // move, proving this isn't just "Move never got invoked".
      assert.equal(calls(), 1);
      assert.equal(result.moves.length, 1);
      assert.equal(result.moves[0].move, "clarify");

      // The claim row was committed and is queryable with its real state —
      // Move's own concurrent run cannot have delayed that commit past
      // when this function returns, nor changed what was committed.
      const claim = (await pool.query("SELECT state FROM claim WHERE id = $1", [result.claimId])).rows[0] as Record<string, unknown>;
      assert.equal(claim.state, "SUPPORTED");

      // Loose latency sanity check: Act/Challenge and Move run via
      // Promise.all, not sequential awaits, so total added latency should be
      // roughly ONE 50ms delay's worth, not stacked — this is a smoke check,
      // not a precise timing assertion (CI/network jitter), so the bound is
      // generous.
      assert.ok(elapsedMs < 2_000, `expected concurrent execution to stay well under 2s, took ${elapsedMs}ms`);
    } finally {
      await pool.end();
    }
  },
);

test(
  "a Move transport failure never propagates into or alters a committed Verify result",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, SUPPORT_TEXT);

      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          materiality: true,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [evidenceId],
          userRequest: "Can you double-check Acme's FY25 revenue growth figure for me?",
        },
        pool,
        { moveClient: throwingMoveClient() },
      );

      // Verify unaffected by the thrown error inside Move's own call.
      assert.equal(result.state, "SUPPORTED");
      assert.equal(result.matches.length, 1);
      assert.equal(result.lifecycle, "completed");
      // Move degrades to zero moves rather than the failure
      // propagating out of runReview() entirely (never THROWS — same
      // subordination discipline as Act/Challenge).
      assert.deepEqual(result.moves, []);

      const invocationRow = (
        await pool.query("SELECT status, error FROM act_invocation WHERE claim_id = $1", [result.claimId])
      ).rows[0] as Record<string, unknown>;
      assert.equal(invocationRow.status, "error");
      assert.equal(invocationRow.error, "simulated move transport failure");
    } finally {
      await pool.end();
    }
  },
);

test(
  "no user_request supplied: Move is skipped entirely — no client call, zero moves, a 'skipped' act_invocation row",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, SUPPORT_TEXT);

      const { client: moveClient, calls } = delayedMoveClient(0);
      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          materiality: true,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [evidenceId],
          // userRequest intentionally omitted.
        },
        pool,
        { moveClient },
      );

      assert.equal(result.state, "SUPPORTED", "Verify is unaffected by the absence of a user_request");
      assert.deepEqual(result.moves, []);
      assert.equal(calls(), 0, "the judge client must never be invoked with no user_request");

      const invocationRow = (
        await pool.query("SELECT status, error FROM act_invocation WHERE claim_id = $1", [result.claimId])
      ).rows[0] as Record<string, unknown>;
      assert.equal(invocationRow.status, "skipped");
      assert.equal(invocationRow.error, "no_user_request");
    } finally {
      await pool.end();
    }
  },
);

test(
  "an empty-string user_request is treated identically to an absent one — skipped, never a guess",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, SUPPORT_TEXT);

      const { client: moveClient, calls } = delayedMoveClient(0);
      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          materiality: true,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [evidenceId],
          userRequest: "   ",
        },
        pool,
        { moveClient },
      );

      assert.deepEqual(result.moves, []);
      assert.equal(calls(), 0);
    } finally {
      await pool.end();
    }
  },
);

// Migration 0014: Move's own org feature flag. The rule in
// docs/build/tier-1-build-and-operating-plan.md § Act / Move has always
// been that Move gets its own flag once it has persisted state to gate;
// 0013 gave it that state and the flag was never added, so Move ran ungated
// in production. This test is what keeps the flag honest — a flag nothing
// verifies is a flag that silently stops working.
//
// Two things asserted together, because either alone is insufficient: that no
// moves come back, AND that the client was never called. A gate that
// returns [] after paying for the call has not actually gated anything — the
// whole reason the flag is read before any client construction or budget query
// is that a disabled org must cost exactly zero extra DeepSeek calls.
test(
  "act_moves_enabled = false gates Move entirely — no moves, and no model call is paid for",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool, { movesEnabled: false });
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedRetrievedEvidence(pool, reviewId, SUPPORT_TEXT);

      const { client: moveClient, calls } = delayedMoveClient(50);
      const result = await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          materiality: true,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [evidenceId],
          // A real user_request, so a skip here can only be the flag —
          // not the no_user_request short-circuit.
          userRequest: "Can you double-check Acme's FY25 revenue growth figure for me?",
        },
        pool,
        { moveClient },
      );

      assert.deepEqual(result.moves, [], "a disabled org must produce no moves");
      assert.equal(calls(), 0, "a disabled org must not reach the model at all — the flag is read before any client work");

      // Verify is completely unaffected: the flag gates Move, never the
      // evidence record. This is the same authority boundary Move has
      // everywhere else, checked at the flag path specifically.
      assert.equal(result.state, "SUPPORTED");
      assert.equal(result.lifecycle, "completed");

      // No act_invocation row either. 'skipped' means "was eligible and
      // short-circuited on its own policy"; an org with the feature off was
      // never eligible, and a row per claim would bury the real skips.
      const rows = await pool.query("SELECT count(*)::int AS n FROM act_invocation WHERE organization_id = $1", [orgId]);
      assert.equal(rows.rows[0].n, 0, "a disabled org writes no act_invocation row");
    } finally {
      await pool.end();
    }
  },
);

// Regression guard for a live double-run (2026-09-04). Both Move paths were
// wired at once: the connector submitted claims (each firing per-claim Move)
// and then called /detect (firing invocation-level Move), and then discarded
// the per-claim results. Observed on a real five-claim answer — six model calls
// paid for, output thrown away, and the "0-2 moves per invocation"
// cardinality contract bypassed by ten near-duplicate moves.
//
// These assert on the CLIENT CALL COUNT, not on empty moves: an empty
// result is also what a policy short-circuit produces, and the wasted spend is
// the whole point.
test(
  "skipClaimMoves suppresses the per-claim Move call entirely — no model call, no row",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      await pool.query("UPDATE organization SET act_moves_enabled = true WHERE id = $1", [orgId]);
      const reviewId = await createReview(pool, orgId);

      let moveCalls = 0;
      const countingClient = {
        async call() {
          moveCalls++;
          return {
            record: { model: "t", promptVersion: "t", question: "q", answer: '{"moves":[]}' },
            parsed: { moves: [] },
          };
        },
      } as unknown as Parameters<typeof runReview>[2] extends { moveClient?: infer C } ? C : never;

      await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          materiality: true,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [],
          userRequest: "check the revenue figure",
          skipClaimMoves: true,
        },
        pool,
        { moveClient: countingClient },
      );

      assert.equal(moveCalls, 0, "per-claim Move must not be paid for when the caller handles it per invocation");
      const rows = await pool.query("SELECT count(*)::int AS n FROM act_invocation WHERE review_id = $1", [reviewId]);
      assert.equal(rows.rows[0].n, 0, "and no act_invocation row is written");
    } finally {
      await pool.end();
    }
  },
);

test(
  "without the flag, per-claim Move still runs — a direct API caller is unaffected",
  { ...dbSkip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      await pool.query("UPDATE organization SET act_moves_enabled = true WHERE id = $1", [orgId]);
      const reviewId = await createReview(pool, orgId);

      let moveCalls = 0;
      const countingClient = {
        async call() {
          moveCalls++;
          return {
            record: { model: "t", promptVersion: "t", question: "q", answer: '{"moves":[]}' },
            parsed: { moves: [] },
          };
        },
      } as unknown as Parameters<typeof runReview>[2] extends { moveClient?: infer C } ? C : never;

      await runReview(
        {
          organizationId: orgId,
          reviewId,
          claimText: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          materiality: true,
          claimFields: CLAIM_FIELDS,
          evidenceIds: [],
          userRequest: "check the revenue figure",
        },
        pool,
        { moveClient: countingClient },
      );

      assert.equal(moveCalls, 1, "the default preserves behaviour for a caller that never calls /detect");
    } finally {
      await pool.end();
    }
  },
);
