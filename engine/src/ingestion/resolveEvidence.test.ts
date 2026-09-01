// Real tests for resolveEvidenceRow — the source-resolution step. Same pattern
// as safeFetch.test.ts (real local `node:http` server, only DNS/address policy
// injected) combined with the real-Postgres pattern from evidence.test.ts /
// test/db.ts (skips cleanly with no test database configured).
//
// safeFetch's production address policy rejects loopback, so like
// safeFetch.test.ts these tests inject the `allowLoopback` policy — the real
// production policy for every address except 127.0.0.1 — via
// resolveEvidenceRow's fetchOptions seam.

import { createHash } from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";
import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import { resolveEvidenceRow } from "./resolveEvidence.ts";
import { isPrivateIp } from "./safeFetch.ts";
import { createOrganization, createReview, freshPool, HAS_DB } from "../test/db.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

// Identical to the production policy except 127.0.0.1 is reachable, so a real
// local test server can be used (same seam as safeFetch.test.ts's allowLoopback).
const allowLoopback = (ip: string): boolean => (ip === "127.0.0.1" ? false : isPrivateIp(ip));

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function startServer(handler: Handler) {
  const server = http.createServer((req, res) => {
    res.on("error", () => {}); // swallow EPIPE on client-aborted connections
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

async function seedPendingEvidence(pool: pg.Pool, reviewId: string, submittedUrl: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO evidence (review_id, origin, submitted_url, retrieval_status)
     VALUES ($1, 'answer_citation', $2, 'pending')
     RETURNING id`,
    [reviewId, submittedUrl],
  );
  return result.rows[0].id as string;
}

test(
  "a pending HTML row is fetched and canonicalized: resolved_text populated, hash matches, status retrieved",
  { ...skip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const s = await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><head><style>.x { color: red }</style></head><body>" +
            "<p>Acme's revenue growth was 12% in FY25.</p>" +
            "<script>window.bad = true</script>" +
            "</body></html>",
        );
      });
      try {
        const evidenceId = await seedPendingEvidence(pool, reviewId, `${s.baseUrl}/report`);
        const resolved = await resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } });

        assert.equal(resolved.status, "retrieved");
        // <style> and <script> content removed entirely, tags stripped, whitespace collapsed.
        assert.equal(resolved.resolvedText, "Acme's revenue growth was 12% in FY25.");
        assert.equal(resolved.locator, `${s.baseUrl}/report`);

        const row = (
          await pool.query(
            "SELECT retrieval_status, resolved_text, payload_hash, canonical_url, retrieved_at FROM evidence WHERE id = $1",
            [evidenceId],
          )
        ).rows[0] as {
          retrieval_status: string;
          resolved_text: string;
          payload_hash: string;
          canonical_url: string;
          retrieved_at: string | null;
        };
        assert.equal(row.retrieval_status, "retrieved");
        assert.equal(row.resolved_text, "Acme's revenue growth was 12% in FY25.");
        assert.equal(row.payload_hash, sha256("Acme's revenue growth was 12% in FY25."));
        assert.equal(row.canonical_url, `${s.baseUrl}/report`);
        assert.ok(row.retrieved_at, "retrieved_at must be set");
      } finally {
        await s.close();
      }
    } finally {
      await pool.end();
    }
  },
);

test(
  "a pending PDF row is fetched but resolved_text stays NULL; payload_hash is of the raw bytes (no fake text extraction)",
  { ...skip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);
      const rawBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n");
      const s = await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end(rawBytes);
      });
      try {
        const evidenceId = await seedPendingEvidence(pool, reviewId, `${s.baseUrl}/report.pdf`);
        const resolved = await resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } });

        assert.equal(resolved.status, "retrieved");
        assert.equal(resolved.resolvedText, null, "no PDF parser is wired in — resolved_text must stay NULL");

        const row = (
          await pool.query(
            "SELECT retrieval_status, resolved_text, payload_hash, canonical_url FROM evidence WHERE id = $1",
            [evidenceId],
          )
        ).rows[0] as {
          retrieval_status: string;
          resolved_text: string | null;
          payload_hash: string;
          canonical_url: string;
        };
        assert.equal(row.retrieval_status, "retrieved");
        assert.equal(row.resolved_text, null);
        assert.equal(row.payload_hash, sha256(rawBytes), "payload_hash must be sha256 of the RAW bytes, not text");
        assert.equal(row.canonical_url, `${s.baseUrl}/report.pdf`);
      } finally {
        await s.close();
      }
    } finally {
      await pool.end();
    }
  },
);

test(
  "an unreachable server marks the row unavailable — never left pending, never throws",
  { ...skip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);

      // Get a port, then close the server so connecting to it is refused.
      const s = await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html>never reached</html>");
      });
      const deadUrl = `${s.baseUrl}/gone`;
      await s.close();

      const evidenceId = await seedPendingEvidence(pool, reviewId, deadUrl);
      const resolved = await resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } });

      assert.equal(resolved.status, "unavailable");
      assert.equal(resolved.resolvedText, null);

      const row = (
        await pool.query("SELECT retrieval_status, resolved_text FROM evidence WHERE id = $1", [evidenceId])
      ).rows[0] as { retrieval_status: string; resolved_text: string | null };
      assert.equal(row.retrieval_status, "unavailable", "must never be left pending");
      assert.equal(row.resolved_text, null);
    } finally {
      await pool.end();
    }
  },
);

test(
  "calling resolveEvidenceRow twice on the same row: the second call is a no-op and does not re-fetch",
  { ...skip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);

      let hits = 0;
      const s = await startServer((_req, res) => {
        hits += 1;
        // Error loudly on any request after the first — if the second call
        // re-fetched, the test fails by asserting hits stays 1.
        if (hits > 1) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end("boom");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><p>Acme's revenue growth was 12% in FY25.</p></html>");
      });
      try {
        const evidenceId = await seedPendingEvidence(pool, reviewId, `${s.baseUrl}/report`);

        const first = await resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } });
        assert.equal(first.status, "retrieved");
        const second = await resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } });
        assert.equal(second.status, "retrieved");
        assert.equal(second.resolvedText, first.resolvedText, "second call returns the same resolved state");
        assert.equal(hits, 1, "the second call must not re-fetch the source");
      } finally {
        await s.close();
      }
    } finally {
      await pool.end();
    }
  },
);

test(
  "concurrent calls on the same pending row: only ONE real fetch happens (race-safe under SELECT ... FOR UPDATE)",
  { ...skip },
  async () => {
    const pool = await freshPool();
    try {
      const orgId = await createOrganization(pool);
      const reviewId = await createReview(pool, orgId);

      let hits = 0;
      const s = await startServer((_req, res) => {
        hits += 1;
        // A small delay widens the race window so a genuine race (rather than
        // one call simply finishing before the other starts) is what's being
        // exercised. Before the row-lock fix, three concurrent calls on the
        // same pending row produced three real fetches, not one — confirmed
        // by running this exact scenario against a live Postgres + HTTP
        // server before the fix landed.
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><p>Acme's revenue growth was 12% in FY25.</p></html>");
        }, 30);
      });
      try {
        const evidenceId = await seedPendingEvidence(pool, reviewId, `${s.baseUrl}/report`);

        const results = await Promise.all([
          resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } }),
          resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } }),
          resolveEvidenceRow(evidenceId, pool, { fetchOptions: { isPrivateIp: allowLoopback } }),
        ]);

        assert.equal(hits, 1, "only one concurrent caller may actually fetch the source");
        for (const r of results) {
          assert.equal(r.status, "retrieved");
          assert.equal(r.resolvedText, "Acme's revenue growth was 12% in FY25.");
        }
      } finally {
        await s.close();
      }
    } finally {
      await pool.end();
    }
  },
);

test("an already-unavailable row is returned as-is without throwing", { ...skip }, async () => {
  const pool = await freshPool();
  try {
    const orgId = await createOrganization(pool);
    const reviewId = await createReview(pool, orgId);
    const result = await pool.query(
      `INSERT INTO evidence (review_id, origin, submitted_url, retrieval_status)
       VALUES ($1, 'answer_citation', 'https://example.com/gone', 'unavailable')
       RETURNING id`,
      [reviewId],
    );
    const evidenceId = result.rows[0].id as string;
    const resolved = await resolveEvidenceRow(evidenceId, pool);
    assert.equal(resolved.status, "unavailable");
    assert.equal(resolved.resolvedText, null);
  } finally {
    await pool.end();
  }
});
