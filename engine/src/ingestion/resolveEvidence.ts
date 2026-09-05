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
// TWO THINGS CHANGED HERE, both closing confirmed bugs:
//
// 1. FETCHED IS NOT PARSED. This function used to return a single status
//    ("retrieved" / "unavailable") that conflated "the bytes arrived" with
//    "there is readable, locatable content". A fetched PDF had no parser at
//    all: resolved_text stayed NULL, raw bytes were hashed, and the row was
//    still written as `retrieved` — which the review flow then counted as an
//    addressable, check-completing source. That turned "Notary could not
//    inspect this evidence" into "the evidence did not support the claim".
//    ResolvedEvidence now carries the fetch, parse and usability facts
//    separately, and a PDF is really parsed (parsePdf.ts).
//
// 2. REVOKED CONTENT IS REFUSED HERE, NOT ONLY AT DELETE TIME. This function
//    previously returned whatever cached content the row held without ever
//    looking at access_revoked_at. Revocation is now checked on every call, on
//    both the fast path and the pending path, so a revoked row can never feed
//    a new review — the check lives at the read, where it is load-bearing, not
//    only at the write, where it is a courtesy.
//
// Canonicalization scope boundary: the HTML canonicalizer below is still a
// simple regex-based tag stripper, NOT a full HTML parser (matching
// safeFetch.ts's own documented boundary). That is unchanged.

import { createHash } from "node:crypto";
import type pg from "pg";
import type { LocatorContentKind, LocatorProvenance, PageRange } from "../evidence/locators.ts";
import { extractPdfText } from "./parsePdf.ts";
import { fetchSource } from "./safeFetch.ts";
import type { SafeFetchOptions } from "./safeFetch.ts";

/**
 * Whether readable content was actually produced — deliberately separate from
 * retrieval status. Mirrors evidence.parse_status (migration 0010).
 */
export type EvidenceParseStatus = "not_attempted" | "parsed" | "parse_failed" | "not_parseable";

/** The resolved state of one Evidence row, returned for every call path. */
export interface ResolvedEvidence {
  /**
   * `revoked` is a distinct status, not a flavour of `unavailable`: unavailable
   * means the source could not be reached, revoked means its payload was
   * deliberately destroyed and must never be used again.
   */
  status: "retrieved" | "unavailable" | "revoked";
  /** Canonicalized text. NULL when unavailable, revoked, or unparseable. */
  resolvedText: string | null;
  /** canonical_url (or submitted_url) for a retrieved row; null otherwise.
   * NOTE this is a SOURCE URL, not an exact locator — see evidence/locators.ts
   * for the real coordinate system. Kept because callers still want the URL. */
  locator: string | null;
  /** Which coordinate system resolvedText is expressed in. */
  contentKind: LocatorContentKind | null;
  /**
   * Whether this system fetched the text or the caller supplied it. Never
   * inferred from the presence of a URL: a row may carry BOTH a pasted excerpt
   * and a URL, and in that case the text is caller_supplied even though a URL
   * exists.
   */
  provenance: LocatorProvenance | null;
  /** sha256 of resolvedText — the hash a locator's offsets are anchored to. */
  canonicalTextHash: string | null;
  parseStatus: EvidenceParseStatus;
  parseError: string | null;
  /** PDF page boundaries into resolvedText; null for every other content kind. */
  pageRanges: PageRange[] | null;
  /** The bytes arrived (or were supplied). */
  fetched: boolean;
  /** Readable canonical text was produced. */
  parsed: boolean;
  /**
   * The row may be used as evidence for a claim: fetched AND parsed AND holding
   * non-empty text AND not revoked. This is the flag the review flow must gate
   * on — `status === "retrieved"` is NOT sufficient and was the bug.
   */
  usableForClaim: boolean;
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

const sha256Text = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** The unavailable/revoked result, with every derived flag consistently false. */
function terminal(status: "unavailable" | "revoked"): ResolvedEvidence {
  return {
    status,
    resolvedText: null,
    locator: null,
    contentKind: null,
    provenance: null,
    canonicalTextHash: null,
    parseStatus: "not_attempted",
    parseError: null,
    pageRanges: null,
    fetched: false,
    parsed: false,
    usableForClaim: false,
  };
}

interface EvidenceRow {
  id: string;
  retrieval_status: string;
  submitted_url: string | null;
  canonical_url: string | null;
  payload_hash: string | null;
  resolved_text: string | null;
  access_revoked_at: Date | string | null;
  content_kind: string | null;
  text_provenance: string | null;
  canonical_text_hash: string | null;
  parse_status: string;
  parse_error: string | null;
  page_ranges: PageRange[] | null;
  caller_excerpt: string | null;
}

/** Builds the ResolvedEvidence for an already-resolved row, from the row itself. */
function fromStoredRow(row: EvidenceRow): ResolvedEvidence {
  const parseStatus = (row.parse_status ?? "not_attempted") as EvidenceParseStatus;
  const text = row.resolved_text;
  // A row written before migration 0010 has parse_status 'not_attempted' but
  // may hold real resolved_text (an inline payload, or a resolved HTML page).
  // Treat retained non-empty text as parsed: the text is genuinely there and
  // genuinely locatable, and back-dating it to "unparsed" would wrongly turn
  // every pre-existing row INDETERMINATE. Absence of text is still unparsed.
  const parsed = parseStatus === "parsed" || (parseStatus === "not_attempted" && text !== null && text.length > 0);
  return {
    status: "retrieved",
    resolvedText: text,
    locator: row.canonical_url ?? row.submitted_url,
    contentKind: (row.content_kind as LocatorContentKind | null) ?? (text !== null ? "plaintext" : null),
    provenance: (row.text_provenance as LocatorProvenance | null) ?? null,
    canonicalTextHash: row.canonical_text_hash ?? (text !== null ? sha256Text(text) : null),
    parseStatus: parsed ? "parsed" : parseStatus,
    parseError: row.parse_error,
    pageRanges: row.page_ranges ?? null,
    fetched: true,
    parsed,
    usableForClaim: parsed && text !== null && text.length > 0,
  };
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
      `SELECT id, retrieval_status, submitted_url, canonical_url, payload_hash, resolved_text,
              access_revoked_at, content_kind, text_provenance, canonical_text_hash,
              parse_status, parse_error, page_ranges, caller_excerpt
       FROM evidence
       WHERE id = $1
       FOR UPDATE`,
      [evidenceId],
    );
    if (!result.rowCount) {
      await client.query("COMMIT");
      return terminal("unavailable");
    }
    const row = result.rows[0] as EvidenceRow;

    // REVOCATION IS CHECKED FIRST, BEFORE ANY CACHED CONTENT IS RETURNED and
    // before any fetch is attempted. Both conditions are checked, not just one:
    // retrieval_status = 'revoked' is the new first-class marker, and
    // access_revoked_at covers any row revoked before migration 0010. A revoked
    // row yields no text on any path.
    if (row.retrieval_status === "revoked" || row.access_revoked_at !== null) {
      await client.query("COMMIT");
      return terminal("revoked");
    }

    // Already resolved (or already permanently unavailable): return the
    // current state as-is — idempotent, no re-fetch, no re-write. This is the
    // fast path a blocked concurrent caller lands on once the lock is released.
    if (row.retrieval_status !== "pending") {
      await client.query("COMMIT");
      if (row.retrieval_status === "retrieved") {
        return fromStoredRow(row);
      }
      return terminal("unavailable");
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
      return terminal("unavailable");
    }

    const fetched = await fetchSource(row.submitted_url, options.fetchOptions);

    // E-EVIDENCE fallback (2026-09-05): a row registered with BOTH a caller
    // excerpt and a URL is 'pending' and gets here to have the page fetched.
    // When the fetch is unreachable/unsafe — the paywalled or moved page the
    // excerpt comment always warned about — the caller's own text is still
    // legitimate evidence and stays usable. It is persisted with provenance
    // 'caller_supplied' so nothing downstream mistakes it for fetched content.
    const persistExcerptFallback = async (): Promise<ResolvedEvidence> => {
      const excerpt = row.caller_excerpt as string;
      const excerptHash = sha256Text(excerpt);
      await client.query(
        `UPDATE evidence
         SET retrieval_status = 'retrieved',
             retrieved_at = now(),
             canonical_url = NULL,
             resolved_text = $2,
             content_kind = 'inline_excerpt',
             text_provenance = 'caller_supplied',
             canonical_text_hash = $3,
             parse_status = 'parsed',
             parse_error = NULL,
             page_ranges = NULL
         WHERE id = $1`,
        [evidenceId, excerpt, excerptHash],
      );
      await client.query("COMMIT");
      return {
        status: "retrieved",
        resolvedText: excerpt,
        locator: null,
        contentKind: "inline_excerpt",
        provenance: "caller_supplied",
        canonicalTextHash: excerptHash,
        parseStatus: "parsed",
        parseError: null,
        pageRanges: null,
        fetched: false,
        parsed: true,
        usableForClaim: true,
      };
    };

    if (fetched.status === "unavailable") {
      if (row.caller_excerpt !== null && row.caller_excerpt.length > 0) {
        return persistExcerptFallback();
      }
      await client.query(
        `UPDATE evidence SET retrieval_status = 'unavailable', retrieved_at = now() WHERE id = $1`,
        [evidenceId],
      );
      await client.query("COMMIT");
      return terminal("unavailable");
    }

    let resolvedText: string | null = null;
    let payloadHash: string;
    let contentKind: LocatorContentKind;
    let parseStatus: EvidenceParseStatus;
    let parseError: string | null = null;
    let pageRanges: PageRange[] | null = null;

    if (fetched.mimeType === "text/html") {
      contentKind = "html";
      resolvedText = stripHtml(fetched.body);
      payloadHash = sha256Text(resolvedText);
      // The stripper cannot fail, but it can legitimately produce nothing (a
      // page that is all script/style/markup). Empty text is NOT parsed
      // content: there is nothing to locate in it.
      parseStatus = resolvedText.length > 0 ? "parsed" : "parse_failed";
      if (parseStatus === "parse_failed") parseError = "html_canonicalization_produced_no_text";
    } else {
      // application/pdf — really parsed now (parsePdf.ts). The payload hash
      // stays a hash of the RAW BYTES for a PDF (it identifies the file that
      // arrived); the canonical TEXT gets its own hash below, because a
      // locator's offsets are anchored to the text, never to the bytes.
      contentKind = "pdf";
      payloadHash = createHash("sha256").update(fetched.body).digest("hex");
      const extraction = await extractPdfText(fetched.body);
      if (extraction.ok) {
        resolvedText = extraction.canonicalText;
        pageRanges = extraction.pageRanges;
        parseStatus = "parsed";
      } else {
        // A PDF that arrives but yields no text is FETCHED-BUT-NOT-PARSED. It
        // must never look like usable evidence — that conflation is the bug.
        parseStatus = extraction.reason === "no_extractable_text" ? "not_parseable" : "parse_failed";
        parseError = extraction.detail !== undefined ? `${extraction.reason}: ${extraction.detail}` : extraction.reason;
      }
    }

    const textHash = resolvedText !== null ? sha256Text(resolvedText) : null;

    // E-EVIDENCE fallback for a fetched-but-unparseable page (empty text from
    // the HTML stripper, or a PDF with no extractable text). The page could
    // not be read; the caller's own excerpt still can be, so it becomes the
    // verification text — with caller_supplied provenance, never 'fetched'.
    let provenance: LocatorProvenance = "fetched";
    let canonicalUrl: string | null = fetched.finalUrl;
    if (resolvedText === null && row.caller_excerpt !== null && row.caller_excerpt.length > 0) {
      resolvedText = row.caller_excerpt;
      payloadHash = sha256Text(row.caller_excerpt);
      contentKind = "inline_excerpt";
      parseStatus = "parsed";
      parseError = null;
      pageRanges = null;
      provenance = "caller_supplied";
      canonicalUrl = null;
    }

    await client.query(
      `UPDATE evidence
       SET retrieval_status = 'retrieved',
           retrieved_at = now(),
           canonical_url = $2,
           payload_hash = $3,
           resolved_text = $4,
           content_kind = $5,
           text_provenance = $10,
           canonical_text_hash = $6,
           parse_status = $7,
           parse_error = $8,
           page_ranges = $9
       WHERE id = $1`,
      [
        evidenceId,
        canonicalUrl,
        payloadHash,
        resolvedText,
        contentKind,
        textHash,
        parseStatus,
        parseError,
        pageRanges === null ? null : JSON.stringify(pageRanges),
        provenance,
      ],
    );
    await client.query("COMMIT");

    const parsed = parseStatus === "parsed";
    return {
      status: "retrieved",
      resolvedText,
      locator: canonicalUrl ?? row.submitted_url,
      contentKind,
      provenance,
      canonicalTextHash: textHash,
      parseStatus,
      parseError,
      pageRanges,
      fetched: provenance === "fetched",
      parsed,
      usableForClaim: parsed && resolvedText !== null && resolvedText.length > 0,
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
