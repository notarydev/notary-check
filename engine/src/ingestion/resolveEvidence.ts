// Source-resolution step (§ Verification pipeline step 3, "Resolve evidence
// safely") wired to the evidence manifest: takes an Evidence row still marked
// `pending`, fetches its `submitted_url` through safeFetch, canonicalizes the
// payload, and persists the result so the row can be re-used without a
// re-fetch.
//
// LATENCY DECISION — WHY THIS IS NOT CALLED FROM POST /v1/evidence: safeFetch's
// default timeout is 10s and POST /v1/evidence currently returns in well under
// 100ms; blocking evidence registration on an arbitrary remote fetch would blow
// both of § Monitoring's stated latency targets (deterministic path <2s, judge
// path <4s) on every single registration, including ones whose evidence a
// review flow may never even end up needing. Registration and consumption are
// different lifecycle moments and are deliberately not coupled here.
// Resolution instead happens LAZILY, on-demand, the first time the review flow
// (reviewFlow.ts) actually needs this Evidence row's content.
//
// Idempotent by construction: a row whose retrieval_status is anything other
// than `pending` is returned as-is — never re-fetched, never re-written. The
// review flow may call this once per claim that references the same evidence
// row, and every call after the first is a no-op.
//
// Canonicalization scope boundary, matching safeFetch.ts's own header comment
// ("it does not parse HTML or PDF"): the HTML canonicalizer below is a simple
// regex-based tag stripper, NOT a full HTML parser. And no PDF parser is wired
// in anywhere in this codebase, so a PDF row's resolved_text stays NULL — its
// raw bytes are hashed instead. No fake PDF text extraction.

import { createHash } from "node:crypto";
import type pg from "pg";
import { fetchSource } from "./safeFetch.ts";
import type { SafeFetchOptions } from "./safeFetch.ts";

/** The resolved state of one Evidence row, returned for every call path. */
export interface ResolvedEvidence {
  status: "retrieved" | "unavailable";
  /** Canonicalized text (HTML rows), NULL for PDF rows (no parser) and unavailable rows. */
  resolvedText: string | null;
  /** canonical_url (or submitted_url when canonical is null) for a retrieved row; null when unavailable. */
  locator: string | null;
}

export interface ResolveEvidenceOptions {
  /**
   * Passed straight through to fetchSource. Test seam only: safeFetch's
   * production address policy rejects loopback, so tests exercising a real
   * local `node:http` server inject `isPrivateIp` here (same pattern as
   * safeFetch.test.ts's `allowLoopback`). Production callers never pass it.
   */
  fetchOptions?: SafeFetchOptions;
}

/**
 * Resolves a single Evidence row, idempotently. Never throws on fetch failures:
 * an unreachable/unsafe source marks the row `unavailable` and is returned as
 * such — never left `pending`, never a partial success.
 */
export async function resolveEvidenceRow(
  evidenceId: string,
  db: pg.Pool,
  options: ResolveEvidenceOptions = {},
): Promise<ResolvedEvidence> {
  // CONCURRENCY NOTE, found by actually running concurrent calls against a
  // real Postgres + real local HTTP server (not by reading the code): without
  // locking, two-plus concurrent resolveEvidenceRow calls for the SAME
  // `pending` row (e.g. two claims in the same review both binding the same
  // evidence row, resolved concurrently) each independently observe
  // `pending`, and each independently calls fetchSource — three concurrent
  // calls produced three real HTTP requests to the same URL, not one. That
  // breaks both the "idempotent, no re-fetch" claim below and, more
  // materially, means an evidence source can be fetched an unbounded number
  // of times under concurrent load. Fixed by taking a row lock
  // (`SELECT ... FOR UPDATE`) for the entire check-fetch-write sequence: a
  // second concurrent caller blocks until the first caller's transaction
  // commits (having already written 'retrieved'/'unavailable'), then takes
  // the now-non-pending fast path below instead of fetching again. This
  // deliberately holds one Postgres connection and one row lock for the
  // duration of the network fetch (up to safeFetch's ~10s timeout) — a
  // real but narrow tradeoff (only THIS evidence row's lock is held; other
  // rows resolve concurrently and are unaffected), preferred here over a
  // duplicate/unbounded fetch of an arbitrary, possibly attacker-influenced
  // remote URL.
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, retrieval_status, submitted_url, canonical_url, payload_hash, resolved_text
       FROM evidence
       WHERE id = $1
       FOR UPDATE`,
      [evidenceId],
    );
    if (!result.rowCount) {
      await client.query("COMMIT");
      return { status: "unavailable", resolvedText: null, locator: null };
    }
    const row = result.rows[0] as {
      id: string;
      retrieval_status: string;
      submitted_url: string | null;
      canonical_url: string | null;
      payload_hash: string | null;
      resolved_text: string | null;
    };

    // Already resolved (or already permanently unavailable): return the
    // current state as-is — idempotent, no re-fetch, no re-write. This is the
    // fast path a blocked concurrent caller lands on once the lock is released.
    if (row.retrieval_status !== "pending") {
      await client.query("COMMIT");
      if (row.retrieval_status === "retrieved") {
        return {
          status: "retrieved",
          resolvedText: row.resolved_text,
          locator: row.canonical_url ?? row.submitted_url,
        };
      }
      return { status: "unavailable", resolvedText: null, locator: null };
    }

    // A pending row with no URL has nothing to fetch. Inline-payload rows are
    // already marked 'retrieved' at registration (evidence.ts writes resolved_text
    // for them), so this is unexpected given the insert CHECK constraint — but
    // never hang, never throw. Reason: no_resolvable_source.
    if (!row.submitted_url) {
      await client.query(
        `UPDATE evidence SET retrieval_status = 'unavailable', retrieved_at = now() WHERE id = $1`,
        [evidenceId],
      );
      await client.query("COMMIT");
      return { status: "unavailable", resolvedText: null, locator: null };
    }

    const fetched = await fetchSource(row.submitted_url, options.fetchOptions);
    if (fetched.status === "unavailable") {
      await client.query(
        `UPDATE evidence SET retrieval_status = 'unavailable', retrieved_at = now() WHERE id = $1`,
        [evidenceId],
      );
      await client.query("COMMIT");
      return { status: "unavailable", resolvedText: null, locator: null };
    }

    let resolvedText: string | null = null;
    let payloadHash: string;
    if (fetched.mimeType === "text/html") {
      resolvedText = stripHtml(fetched.body);
      payloadHash = createHash("sha256").update(resolvedText, "utf8").digest("hex");
    } else {
      // application/pdf — no parser is wired in anywhere in this codebase
      // (safeFetch.ts's header comment confirms the same boundary). resolved_text
      // stays NULL; the raw bytes are hashed instead.
      payloadHash = createHash("sha256").update(fetched.body).digest("hex");
    }

    await client.query(
      `UPDATE evidence
       SET retrieval_status = 'retrieved',
           retrieved_at = now(),
           canonical_url = $2,
           payload_hash = $3,
           resolved_text = $4
       WHERE id = $1`,
      [evidenceId, fetched.finalUrl, payloadHash, resolvedText],
    );
    await client.query("COMMIT");

    return {
      status: "retrieved",
      resolvedText,
      locator: fetched.finalUrl ?? row.submitted_url,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * A deliberately simple, regex-based HTML-to-text stripper — NOT a full HTML
 * parser (matching safeFetch.ts's documented scope boundary). `<script>` and
 * `<style>` blocks are removed ENTIRELY first (their content is never page
 * text), then all remaining tags are stripped, then whitespace is collapsed.
 */
function stripHtml(body: Buffer): string {
  let text = body.toString("utf8");
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<[^>]*>/g, " ");
  return text.replace(/\s+/g, " ").trim();
}
