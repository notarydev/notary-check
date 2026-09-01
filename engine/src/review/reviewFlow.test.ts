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
  measure: "revenue growth",
  valueUnit: { value: "17", unit: "%" },
  comparatorBaseline: "prior year",
  modality: "actual",
  scope: "company-wide",
};

// Every claim field verbatim, including the value — all resolvable
// deterministically.
const SUPPORT_TEXT = "Acme's revenue growth was 17% in FY25, compared to the prior year, actual company-wide figures.";
// Identical but for the value: 12%, so the ONLY residue is valueUnit.
const CONTRADICT_TEXT = "Acme's revenue growth was 12% in FY25, compared to the prior year, actual company-wide figures.";
// Wrong entity: every field resolves deterministically EXCEPT entity — "Acme"
// never appears, so entity is the single residual field. Under a denied quota
// it resolves to cannot_be_determined (unestablished), so the row comes back
// inapplicable with mismatchedFields exactly ["entity"].
const WRONG_ENTITY_GLOBEX_TEXT = "Globex's revenue growth was 17% in FY25, compared to the prior year, actual company-wide figures.";
const WRONG_ENTITY_INITECH_TEXT = "Initech's revenue growth was 17% in FY25, compared to the prior year, actual company-wide figures.";

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
      assert.deepEqual(result.matches, [
        { evidenceId, relation: "supports", method: "quoted_or_computed" },
      ]);

      const claim = (await pool.query("SELECT * FROM claim WHERE id = $1", [result.claimId])).rows[0] as Record<string, unknown>;
      assert.equal(claim.review_id, reviewId);
      assert.equal(claim.ordinal, 1);
      assert.equal(claim.state, "SUPPORTED");
      assert.equal(claim.no_source, false);
      assert.equal(claim.policy_version, "orchestrator-v1");
      assert.equal(claim.state_reason, "supporting_applicable_relation");

      const matches = (await pool.query("SELECT * FROM evidence_match WHERE claim_id = $1", [result.claimId])).rows[0] as Record<string, unknown>;
      assert.equal(matches.evidence_id, evidenceId);
      assert.equal(matches.locator, "https://example.com/report");
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
      assert.deepEqual(result.matches[0], { evidenceId, relation: "contradicts", method: "entailed" });

      const matches = (await pool.query("SELECT * FROM evidence_match WHERE claim_id = $1", [result.claimId])).rows[0] as Record<string, unknown>;
      assert.equal(matches.relation, "contradicts");
      assert.equal(matches.method, "entailed");
      assert.equal(matches.evaluator_version, "deepseek-v4-flash:judge-field-extraction-v1");
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

    // Source present, but no field could be established → UNSUPPORTED, not a
    // crash, and never SUPPORTED/CONTRADICTED (which would require the judge).
    assert.equal(result.state, "UNSUPPORTED");
    assert.equal(result.stateReason, "no_support_after_completed_checks");
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
      assert.deepEqual(result.matches, [
        { evidenceId: supportId, relation: "supports", method: "quoted_or_computed" },
      ]);

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
  "all bound rows inapplicable (wrong entity) → matches empty, state UNSUPPORTED, rejectedCandidates has one entry per inapplicable row",
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

      // No applicable relation anywhere → UNSUPPORTED (existing behavior,
      // unchanged by this feature).
      assert.equal(result.state, "UNSUPPORTED");
      assert.equal(result.stateReason, "no_support_after_completed_checks");
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

      assert.equal(result.state, "UNSUPPORTED");
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
