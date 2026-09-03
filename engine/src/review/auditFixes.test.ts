// Integration regression tests for the five confirmed correctness bugs found by
// the external repository audit. Real Postgres (test/db.ts's freshPool/HAS_DB
// pattern, skipping cleanly with no database configured), real local HTTP
// servers for fetches, real PDF parsing.
//
// Each test names the bug it guards and states what the OLD behaviour was, so a
// future change that reintroduces one fails against a description of the fault
// rather than against a bare expected value.
//
//   bug 1 — evidence_match held a URL, never a passage, and no stored locator
//           was ever re-dereferenced before a match could be positive.
//   bug 2 — an extraction FAILURE and a claim-free answer were the same value;
//           a claim had no lifecycle state at all.
//   bug 3 — a fetched-but-unreadable source counted as a completed check, so
//           "could not inspect" was reported as "did not support".
//   bug 4 — deletion nulled two columns and left resolved_text intact, and the
//           resolver never checked revocation, so revoked text stayed usable.
//   bug 5 — claim extraction called DeepSeek with no quota check and no usage
//           row, bypassing both the per-org limit and the global spend cap.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";
import { test } from "node:test";
import type pg from "pg";
import { deleteEvidencePayload } from "../evidence/deleteEvidence.ts";
import { extractClaims } from "../extraction/extractClaims.ts";
import { buildCorruptPdf, buildTextPdf } from "../ingestion/fixtures/textPdf.ts";
import { resolveEvidenceRow } from "../ingestion/resolveEvidence.ts";
import { isPrivateIp } from "../ingestion/safeFetch.ts";
import type { JudgeCallResult, JudgeClient } from "../judge/judgeClient.ts";
import { DEFAULT_JUDGE_MODEL } from "../judge/judgeClient.ts";
import { createOrganization, createReview, freshPool, HAS_DB } from "../test/db.ts";
import type { ClaimFields } from "../verification/applicability.ts";
import { runReview } from "./reviewFlow.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

// Same seam as safeFetch.test.ts/resolveEvidence.test.ts: the production
// address policy for everything except 127.0.0.1, so a real local server works.
const allowLoopback = (ip: string): boolean => (ip === "127.0.0.1" ? false : isPrivateIp(ip));

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function startServer(handler: Handler) {
  const server = http.createServer((req, res) => {
    res.on("error", () => {});
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

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

const SUPPORT_TEXT = "Acme's revenue increased 17% in FY25, compared to the prior year, actual company-wide figures.";

async function seedPending(pool: pg.Pool, reviewId: string, url: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO evidence (review_id, origin, submitted_url, retrieval_status)
     VALUES ($1, 'answer_citation', $2, 'pending') RETURNING id`,
    [reviewId, url],
  );
  return result.rows[0].id as string;
}

async function seedRetrieved(pool: pg.Pool, reviewId: string, text: string, url = "https://example.com/report"): Promise<string> {
  const result = await pool.query(
    `INSERT INTO evidence (review_id, origin, submitted_url, canonical_url, payload_hash, retrieval_status,
                           resolved_text, content_kind, text_provenance, canonical_text_hash, parse_status)
     VALUES ($1, 'answer_citation', $2, $2, $3, 'retrieved', $4, 'html', 'fetched', $3, 'parsed')
     RETURNING id`,
    [reviewId, url, sha256(text), text],
  );
  return result.rows[0].id as string;
}

/** A judge client whose every answer is the supplied outcome/value. */
function fixedJudge(outcome: string, value?: string, sourceSpan?: string): JudgeClient {
  return {
    async call(): Promise<JudgeCallResult> {
      return {
        status: "ok",
        record: {
          model: DEFAULT_JUDGE_MODEL,
          promptVersion: "v",
          question: "q",
          answer: JSON.stringify({
            reasoning: "test",
            outcome,
            ...(value !== undefined ? { value } : {}),
            ...(sourceSpan !== undefined ? { source_span: sourceSpan } : {}),
          }),
        },
      };
    },
  };
}

/**
 * Routes DeepSeek HTTP traffic to a canned response while leaving all other
 * fetches alone. reviewFlow.ts constructs its own judge client internally
 * (there is no injection seam through runReview), so the transport is the only
 * place to intercept — the same technique reviewFlow.test.ts already uses for
 * its normalization test.
 */
async function withMockedJudge<T>(body: unknown, fn: () => Promise<T>): Promise<T> {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "test-key-for-mocked-judge";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.deepseek.com/")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  }
}

// ===========================================================================
// BUG 1 — real exact locators, and re-resolution before a positive match.
// ===========================================================================

test(
  "bug 1: a PDF source is really parsed, and its match carries a PAGE-level character locator",
  { ...skip },
  async () => {
    const pool = await freshPool();
    const pdf = buildTextPdf([
      "Introductory remarks about the fiscal year with no figures in them.",
      SUPPORT_TEXT,
    ]);
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end(pdf);
    });
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedPending(pool, reviewId, `${server.baseUrl}/report.pdf`);

      // Resolve through the real fetch + real parser.
      const resolved = await resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } });
      assert.equal(resolved.status, "retrieved");
      // BEFORE THE FIX: resolvedText was NULL for every PDF — there was no
      // parser in the codebase at all — and the raw bytes were hashed instead.
      assert.ok(resolved.resolvedText !== null, "a PDF's text must actually be extracted now");
      assert.ok(resolved.resolvedText!.includes("Acme"), resolved.resolvedText ?? "");
      assert.equal(resolved.parseStatus, "parsed");
      assert.equal(resolved.parsed, true);
      assert.equal(resolved.usableForClaim, true);
      assert.equal(resolved.contentKind, "pdf");
      assert.equal(resolved.provenance, "fetched");
      assert.ok(resolved.pageRanges !== null && resolved.pageRanges.length === 2);

      const result = await runReview(
        { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 1, claimFields: CLAIM_FIELDS, evidenceIds: [evidenceId] },
        pool,
      );

      assert.equal(result.state, "SUPPORTED");
      assert.equal(result.lifecycle, "completed");
      assert.equal(result.matches.length, 1);
      const locator = result.matches[0].locator;
      assert.equal(locator.kind, "text_offsets");
      if (locator.kind !== "text_offsets") return;
      assert.equal(locator.contentKind, "pdf");
      // The claim's text is on page 2 of the PDF, and the locator says so —
      // page-level resolution, not a bounding box (see parsePdf.ts's honesty
      // note: the text API exposes no per-glyph geometry).
      assert.equal(locator.page, 2, "the supporting passage is on the second page");
      // The offsets are real: slicing the retained canonical text at them
      // returns exactly the recorded quote.
      const stored = await pool.query("SELECT resolved_text, page_ranges FROM evidence WHERE id = $1", [evidenceId]);
      const canonical = stored.rows[0].resolved_text as string;
      assert.equal(canonical.slice(locator.start, locator.end), locator.quote);
      assert.equal(locator.canonicalTextHash, sha256(canonical));
      // Page boundaries survive the round-trip, so a LATER review of this same
      // row can still compute a page number.
      assert.ok(Array.isArray(stored.rows[0].page_ranges) && stored.rows[0].page_ranges.length === 2);
    } finally {
      await server.close();
      await pool.end();
    }
  },
);

test(
  "bug 1: an inline excerpt registered ALONGSIDE a URL is never presented as fetched from that URL",
  { ...skip },
  async () => {
    // The MCP layer (server/src/engineClient.ts) sends `payload` and
    // `submitted_url` together on one registration; evidence.ts marks the row
    // retrieved from the payload and never fetches the URL. Before this fix the
    // flow then reported the URL as the row's locator — presenting text the
    // system never fetched as if it had been proved to come from there.
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const inserted = await pool.query(
        `INSERT INTO evidence (review_id, origin, submitted_url, payload_hash, retrieval_status, resolved_text,
                               content_kind, text_provenance, canonical_text_hash, parse_status)
         VALUES ($1, 'answer_citation', 'https://example.com/paywalled', $2, 'retrieved', $3,
                 'inline_excerpt', 'caller_supplied', $2, 'parsed')
         RETURNING id`,
        [reviewId, sha256(SUPPORT_TEXT), SUPPORT_TEXT],
      );
      const evidenceId = inserted.rows[0].id as string;

      const result = await runReview(
        { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 1, claimFields: CLAIM_FIELDS, evidenceIds: [evidenceId] },
        pool,
      );

      assert.equal(result.state, "SUPPORTED");
      const locator = result.matches[0].locator;
      assert.equal(locator.kind === "text_offsets" && locator.provenance, "caller_supplied");
      // The URL is retained as provenance metadata — the excerpt is NOT dropped
      // in favour of it (the inverse bug, already in HANDOFF.md) — but it is not
      // what the offsets were proved against.
      assert.equal(locator.kind === "text_offsets" && locator.associatedUrl, "https://example.com/paywalled");

      const stored = await pool.query("SELECT locator FROM evidence_match WHERE claim_id = $1", [result.claimId]);
      const display = stored.rows[0].locator as string;
      assert.ok(display.startsWith("caller-excerpt:"), `expected a caller-excerpt label, got ${display}`);
      assert.ok(!display.includes("example.com"), "a caller-supplied excerpt must not be displayed under a URL it was never fetched from");
    } finally {
      await pool.end();
    }
  },
);

test(
  "bug 1: a judge value that cannot be located in the retained text can NOT establish a field",
  { ...skip },
  async () => {
    // The judge is asked for values "as written". A `present` answer whose value
    // and source span appear nowhere in the retained passage is a model
    // assertion, not evidence — and letting it through would be precisely the
    // "a model may propose, a record earns a state through an evidence-bound
    // procedure" violation this codebase forbids. It must not establish the
    // field, and the claim must land INDETERMINATE rather than SUPPORTED.
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      // "Acme" is absent, so entity is the single residual field.
      const text = "Revenue increased 17% in FY25, compared to the prior year, actual company-wide figures.";
      const evidenceId = await seedRetrieved(pool, reviewId, text);

      const result = await withMockedJudge(
        // The judge claims the passage establishes entity "Acme" and cites a
        // span that is simply not in the text.
        { reasoning: "asserted", outcome: "present", value: "Acme", source_span: "Acme Corporation reported" },
        () =>
          runReview(
            { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 1, claimFields: CLAIM_FIELDS, evidenceIds: [evidenceId] },
            pool,
          ),
      );

      assert.notEqual(result.state, "SUPPORTED", "an unlocatable judge value must never produce support");
      assert.equal(result.state, "INDETERMINATE");
      assert.equal(result.stateReason, "checks_did_not_complete");
      assert.equal(result.lifecycle, "not_checkable");
      assert.equal(result.lifecycleDetail, "locator_unresolved");
      assert.equal(result.matches.length, 0);
      const matchCount = await pool.query("SELECT count(*)::int AS n FROM evidence_match WHERE claim_id = $1", [result.claimId]);
      assert.equal(matchCount.rows[0].n, 0, "no evidence_match row may be written without a resolvable locator");
    } finally {
      await pool.end();
    }
  },
);

test(
  "bug 1: every persisted match records a locator that was actually dereferenced",
  { ...skip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedRetrieved(pool, reviewId, SUPPORT_TEXT);
      const result = await runReview(
        { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 1, claimFields: CLAIM_FIELDS, evidenceIds: [evidenceId] },
        pool,
      );

      const row = (await pool.query("SELECT * FROM evidence_match WHERE claim_id = $1", [result.claimId])).rows[0];
      assert.equal(row.locator_resolved, true);
      assert.ok(row.locator_resolved_at !== null);
      const json = row.locator_json as {
        primary: { kind: string; start: number; end: number; quote: string };
        fields: Array<{ field: string; source: string; locator: { kind: string } }>;
      };
      // Every contributing field carries its own coordinate, so the whole
      // claim-evidence relation is inspectable, not just one span of it.
      assert.ok(json.fields.length >= 2, `expected per-field locators, got ${JSON.stringify(json.fields)}`);
      for (const entry of json.fields) {
        if (entry.locator.kind === "text_offsets") {
          const l = entry.locator as unknown as { start: number; end: number; quote: string };
          assert.equal(SUPPORT_TEXT.slice(l.start, l.end), l.quote, `field ${entry.field}'s offsets must slice its quote`);
        }
      }
      assert.equal(row.resolved_text_hash, sha256(SUPPORT_TEXT));
    } finally {
      await pool.end();
    }
  },
);

// ===========================================================================
// BUG 3 — fetched is not parsed; an uninspectable source is INDETERMINATE.
// ===========================================================================

test(
  "bug 3: an unreadable PDF routes to INDETERMINATE, never UNSUPPORTED",
  { ...skip },
  async () => {
    // THE headline bug. Before the fix: the fetch succeeded, the row was stored
    // `retrieved` with NULL text, the review flow counted it as an addressable
    // source and passed checksCompleted = true — so the claim came back
    // UNSUPPORTED, telling the user "the evidence did not support this claim"
    // about a document the system had never been able to read a word of.
    const pool = await freshPool();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end(buildCorruptPdf());
    });
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedPending(pool, reviewId, `${server.baseUrl}/broken.pdf`);

      // Resolve through the loopback seam first (runReview has no fetch-options
      // seam of its own), so the row reaches the review flow in exactly the
      // state a real fetch of an unreadable PDF leaves it in: retrieval_status
      // 'retrieved', parse_status 'parse_failed', no text. That combination IS
      // the bug — it used to read as a perfectly good addressable source.
      const resolved = await resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } });
      assert.equal(resolved.status, "retrieved", "the bytes really did arrive");
      assert.equal(resolved.parsed, false, "...and nothing readable came out of them");
      assert.equal(resolved.usableForClaim, false);

      const result = await runReview(
        { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 1, claimFields: CLAIM_FIELDS, evidenceIds: [evidenceId] },
        pool,
      );

      assert.notEqual(result.state, "UNSUPPORTED", "an uninspectable source must never read as a completed check");
      assert.equal(result.state, "INDETERMINATE");
      assert.equal(result.checksCompleted, false);
      assert.equal(result.lifecycle, "not_checkable");
      assert.equal(result.lifecycleDetail, "evidence_not_parsed");

      // The per-source split is visible to the caller: the bytes arrived, the
      // content did not.
      assert.equal(result.evidenceStatuses.length, 1);
      const status = result.evidenceStatuses[0];
      assert.equal(status.fetched, true, "the fetch really did succeed");
      assert.equal(status.parsed, false, "...but nothing readable came out of it");
      assert.equal(status.usableForClaim, false);
      assert.equal(status.locatorResolved, false);
      assert.ok(status.parseError !== null, "the parser's own reason is retained for an operator");

      // And it is persisted on the evidence row, not only computed per request.
      const row = await pool.query("SELECT parse_status, resolved_text FROM evidence WHERE id = $1", [evidenceId]);
      assert.ok(["parse_failed", "not_parseable"].includes(row.rows[0].parse_status as string));
      assert.equal(row.rows[0].resolved_text, null);
    } finally {
      await server.close();
      await pool.end();
    }
  },
);

test(
  "bug 3: UNSUPPORTED is still reachable — a judge that ANSWERS and excludes the row completes the checks",
  { ...skip },
  async () => {
    // The counterweight to the test above. Making incompleteness INDETERMINATE
    // is only correct if a genuinely completed check that finds no support still
    // lands UNSUPPORTED. Here the judge answers `present` with a value that IS
    // in the passage — so nothing abstained, nothing failed to locate, the
    // checks completed — and the row is excluded because the entity is wrong.
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const text = "Globex's revenue increased 17% in FY25, compared to the prior year, actual company-wide figures.";
      const evidenceId = await seedRetrieved(pool, reviewId, text, "https://example.com/globex");

      const result = await withMockedJudge(
        { reasoning: "the passage names Globex", outcome: "present", value: "Globex", source_span: "Globex's revenue" },
        () =>
          runReview(
            { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 1, claimFields: CLAIM_FIELDS, evidenceIds: [evidenceId] },
            pool,
          ),
      );

      assert.equal(result.state, "UNSUPPORTED");
      assert.equal(result.stateReason, "no_support_after_completed_checks");
      assert.equal(result.checksCompleted, true);
      assert.equal(result.lifecycle, "completed", "the pipeline ran to completion; the evidence simply was not about Acme");
      assert.equal(result.rejectedCandidates.length, 1);
      assert.deepEqual(result.rejectedCandidates[0].mismatchedFields, ["entity"]);
    } finally {
      await pool.end();
    }
  },
);

test(
  "bug 3: a judge ABSTENTION on a field the claim asserts makes the checks incomplete",
  { ...skip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const text = "Revenue increased 17% in FY25, compared to the prior year, actual company-wide figures.";
      const evidenceId = await seedRetrieved(pool, reviewId, text);

      const result = await withMockedJudge(
        { reasoning: "the passage never names the company", outcome: "cannot_be_determined" },
        () =>
          runReview(
            { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 1, claimFields: CLAIM_FIELDS, evidenceIds: [evidenceId] },
            pool,
          ),
      );

      // "the judge could not tell" is not "the evidence does not support it".
      assert.equal(result.state, "INDETERMINATE");
      assert.equal(result.checksCompleted, false);
      assert.equal(result.lifecycleDetail, "required_field_unresolved");
    } finally {
      await pool.end();
    }
  },
);

// ===========================================================================
// BUG 4 — revocation is a full purge, enforced at read time.
// ===========================================================================

test(
  "bug 4: revoking an ALREADY-USED source purges the text, blocks new matches, and marks the historical finding",
  { ...skip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedRetrieved(pool, reviewId, SUPPORT_TEXT);

      // (0) The source is used successfully first — this must be an
      // already-used source, or the test proves nothing about history.
      const before = await runReview(
        { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 1, claimFields: CLAIM_FIELDS, evidenceIds: [evidenceId] },
        pool,
      );
      assert.equal(before.state, "SUPPORTED");

      const revocation = await deleteEvidencePayload(evidenceId, pool);
      assert.equal(revocation.ok, true);
      assert.equal(revocation.ok && revocation.matchesMarked, 1);

      // (a) THE TEXT IS GONE FROM EVERY READ PATH. Before the fix,
      // deleteEvidencePayload nulled only payload_ref and payload_hash;
      // resolved_text — the column that actually holds the readable payload,
      // added later by the orchestrator work and never reconciled with the
      // delete path — was left fully populated.
      const row = await pool.query(
        "SELECT resolved_text, payload_hash, payload_ref, canonical_text_hash, page_ranges, retrieval_status, access_revoked_at FROM evidence WHERE id = $1",
        [evidenceId],
      );
      assert.equal(row.rows[0].resolved_text, null, "the readable payload must be shredded");
      assert.equal(row.rows[0].payload_hash, null);
      assert.equal(row.rows[0].payload_ref, null);
      assert.equal(row.rows[0].canonical_text_hash, null, "a derived hash is payload too");
      assert.equal(row.rows[0].page_ranges, null);
      assert.equal(row.rows[0].retrieval_status, "revoked");
      assert.ok(row.rows[0].access_revoked_at !== null);
      // The audit row itself survives — this is not a hard delete.
      const audit = await pool.query("SELECT review_id, origin, submitted_url FROM evidence WHERE id = $1", [evidenceId]);
      assert.equal(audit.rowCount, 1);
      assert.equal(audit.rows[0].review_id, reviewId);

      // The resolver refuses it too, on the READ, which is where it is
      // load-bearing — it previously returned cached content without ever
      // consulting revocation.
      const resolved = await resolveEvidenceRow(evidenceId, pool);
      assert.equal(resolved.status, "revoked");
      assert.equal(resolved.resolvedText, null);
      assert.equal(resolved.usableForClaim, false);

      // (b) NO NEW CLAIM MATCH CAN USE IT. Identical claim, identical evidence
      // id — previously this produced a second SUPPORTED match off text that
      // had supposedly been deleted.
      const after = await runReview(
        { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 2, claimFields: CLAIM_FIELDS, evidenceIds: [evidenceId] },
        pool,
      );
      assert.notEqual(after.state, "SUPPORTED", "a revoked source must never establish new support");
      assert.equal(after.state, "INDETERMINATE");
      assert.equal(after.stateReason, "no_source");
      assert.equal(after.noSource, true);
      assert.deepEqual(after.matches, []);
      assert.equal(after.evidenceStatuses[0].retrievalStatus, "revoked");

      // (c) THE HISTORICAL RESULT KEEPS A TRUTHFUL MARKER. The earlier finding
      // was true when it was made and is not rewritten; but its locator no
      // longer dereferences to anything, and the record says so rather than
      // silently pointing into deleted text.
      const historical = await pool.query("SELECT locator, locator_json, payload_revoked_at, locator_resolved FROM evidence_match WHERE claim_id = $1", [before.claimId]);
      assert.equal(historical.rowCount, 1, "the historical match row is preserved, not deleted");
      assert.ok(historical.rows[0].payload_revoked_at !== null, "the finding must be marked as having had its payload revoked");
      assert.equal(historical.rows[0].locator_resolved, false, "a locator into shredded text no longer resolves");
      assert.ok(historical.rows[0].locator_json !== null, "what was assessed at the time is retained as the audit record");

      // The claim's own state is untouched — a past finding does not silently
      // change because a payload was later withdrawn.
      const claim = await pool.query("SELECT state FROM claim WHERE id = $1", [before.claimId]);
      assert.equal(claim.rows[0].state, "SUPPORTED");
    } finally {
      await pool.end();
    }
  },
);

test(
  "bug 4: revocation is idempotent and a revoked pending row is never re-fetched",
  { ...skip },
  async () => {
    const pool = await freshPool();
    let fetches = 0;
    const server = await startServer((_req, res) => {
      fetches += 1;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<p>should never be fetched</p>");
    });
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const evidenceId = await seedPending(pool, reviewId, `${server.baseUrl}/report`);

      assert.equal((await deleteEvidencePayload(evidenceId, pool)).ok, true);
      const second = await deleteEvidencePayload(evidenceId, pool);
      assert.equal(second.ok, true, "revoking twice is a no-op, not an error");

      const resolved = await resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } });
      assert.equal(resolved.status, "revoked");
      // Revocation is checked BEFORE any fetch is attempted, so a revoked row
      // cannot be used to keep pulling on a remote URL either.
      assert.equal(fetches, 0, "a revoked row must never be fetched");
    } finally {
      await server.close();
      await pool.end();
    }
  },
);

// ===========================================================================
// BUG 5 — claim extraction is quota-gated and metered.
// ===========================================================================

test(
  "bug 5: a denied quota stops claim extraction BEFORE any network call, and reports quota_denied",
  { ...skip },
  async () => {
    const originalLimit = process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
    process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "0";
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      let called = false;
      const client: JudgeClient = {
        async call(): Promise<JudgeCallResult> {
          called = true;
          return { status: "ok", record: { model: DEFAULT_JUDGE_MODEL, promptVersion: "v", question: "q", answer: JSON.stringify({ claims: [] }) } };
        },
      };

      const result = await extractClaims("Acme's revenue grew 17% in FY25.", { client, organizationId: orgId, db: pool });

      // BEFORE THE FIX: extractClaims never called checkQuota at all — only the
      // field-judge path was gated — so any valid API key could drive unlimited
      // extraction calls past both the per-org monthly limit and the hard global
      // provider spend cap.
      assert.equal(called, false, "a denied quota must cost zero network traffic");
      assert.equal(result.ok, false);
      assert.equal((result as { ok: false; reason: string }).reason, "quota_denied");
      // ...and critically NOT an empty claim list, which the MCP layer renders
      // as the `no_issue` card.
      assert.ok(!("claims" in result), "a quota denial must not present as an answer with no claims");
    } finally {
      if (originalLimit === undefined) delete process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
      else process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = originalLimit;
      await pool.end();
    }
  },
);

test(
  "bug 5: a real extraction call writes a claim_extraction usage_event, so the NEXT quota check can see it",
  { ...skip },
  async () => {
    const pool = await freshPool();
    const orgId = await createOrganization(pool);
    try {
      const client: JudgeClient = {
        async call(): Promise<JudgeCallResult> {
          return {
            status: "ok",
            record: {
              model: DEFAULT_JUDGE_MODEL,
              promptVersion: "v",
              question: "q",
              answer: JSON.stringify({ claims: [] }),
              // A token count is the signal a real call reached the network.
              inputTokens: 4_000_000,
              outputTokens: 1_000_000,
            },
          };
        },
      };

      const result = await extractClaims("Acme's revenue grew 17% in FY25.", { client, organizationId: orgId, db: pool });
      assert.equal(result.ok, true);

      const usage = await pool.query(
        "SELECT event_type, input_tokens, output_tokens, estimated_cost_cents FROM usage_event WHERE organization_id = $1",
        [orgId],
      );
      assert.equal(usage.rowCount, 1, "extraction previously wrote NO usage row at all");
      // A distinct event type from judge_call: two different call sites with
      // different volumes, and a per-org cost breakdown that merged them could
      // not say what was driving the bill.
      assert.equal(usage.rows[0].event_type, "claim_extraction");
      assert.equal(usage.rows[0].input_tokens, 4_000_000);
      assert.ok((usage.rows[0].estimated_cost_cents as number) > 0, "a metered call must carry a real cost estimate");

      // THE GATE ACTUALLY CLOSES: that recorded spend is what the next check
      // sums. An unrecorded call is invisible to every later check, so the
      // missing ledger row was a hole in the enforcement, not just in reporting.
      const originalLimit = process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
      process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "1";
      try {
        const second = await extractClaims("Acme's revenue grew 17% in FY25.", { client, organizationId: orgId, db: pool });
        assert.equal(second.ok, false);
        assert.equal((second as { ok: false; reason: string }).reason, "quota_denied");
      } finally {
        if (originalLimit === undefined) delete process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
        else process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = originalLimit;
      }
    } finally {
      // This test deliberately meters a very large call, and the global spend
      // cap sums usage_event across EVERY organization — so leaving the row
      // behind would move a number other test files read. Clean up, same as
      // quotaCheck.test.ts does.
      await pool.query("DELETE FROM usage_event WHERE organization_id = $1", [orgId]);
      await pool.end();
    }
  },
);

// ===========================================================================
// BUG 2 — lifecycle states are persisted, not only returned.
// ===========================================================================

test(
  "bug 2: the claim's lifecycle state is PERSISTED alongside its verification state",
  { ...skip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);

      // A completed check.
      const good = await seedRetrieved(pool, reviewId, SUPPORT_TEXT);
      const completed = await runReview(
        { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 1, claimFields: CLAIM_FIELDS, evidenceIds: [good] },
        pool,
      );
      const completedRow = await pool.query("SELECT state, lifecycle_state, lifecycle_detail FROM claim WHERE id = $1", [completed.claimId]);
      assert.equal(completedRow.rows[0].state, "SUPPORTED");
      assert.equal(completedRow.rows[0].lifecycle_state, "completed");
      assert.equal(completedRow.rows[0].lifecycle_detail, null);

      // A check that could not run, in the same review. The two are now
      // distinguishable in the database, which is what lets a caller refuse to
      // call a mixed review clean.
      const originalLimit = process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
      process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "0";
      try {
        const partial = await seedRetrieved(pool, reviewId, "Revenue increased 17% in FY25 versus the prior year, actual company-wide.", "https://example.com/no-entity");
        const notCheckable = await runReview(
          { organizationId: orgId, reviewId, claimText: "Acme's revenue grew 17% in FY25.", ordinal: 2, claimFields: CLAIM_FIELDS, evidenceIds: [partial] },
          pool,
        );
        const row = await pool.query("SELECT state, lifecycle_state, lifecycle_detail FROM claim WHERE id = $1", [notCheckable.claimId]);
        assert.equal(row.rows[0].state, "INDETERMINATE");
        assert.equal(row.rows[0].lifecycle_state, "not_checkable");
        assert.equal(row.rows[0].lifecycle_detail, "quota_denied");
      } finally {
        if (originalLimit === undefined) delete process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
        else process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = originalLimit;
      }
    } finally {
      await pool.end();
    }
  },
);

test(
  "bug 2: a successful extraction of zero claims and a failed extraction are different values",
  { ...skip },
  async () => {
    // The single assertion the whole of bug 2 reduces to. server/src/engineClient.ts
    // turns an empty claim list into the `no_issue` card, so while these two
    // situations shared a representation, an outage rendered as "no issue found".
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const empty = await extractClaims("Hi there!", {
        client: fixedJudge("ignored") satisfies JudgeClient,
        organizationId: orgId,
        db: pool,
      });
      // fixedJudge returns a field-extraction shape, not a claims object, so it
      // is genuinely unparseable for THIS caller — use a proper empty answer.
      assert.equal(empty.ok, false, "an unparseable answer is a failure");

      const genuinelyEmpty = await extractClaims("Hi there!", {
        client: {
          async call(): Promise<JudgeCallResult> {
            return { status: "ok", record: { model: DEFAULT_JUDGE_MODEL, promptVersion: "v", question: "q", answer: JSON.stringify({ claims: [] }) } };
          },
        },
        organizationId: orgId,
        db: pool,
      });
      assert.equal(genuinelyEmpty.ok, true, "an answer with nothing checkable in it is a real finding");
      assert.deepEqual((genuinelyEmpty as { ok: true; claims: unknown[] }).claims, []);
    } finally {
      await pool.end();
    }
  },
);
