-- Notary Check engine — exact locators, evidence lifecycle split, per-claim
-- lifecycle state, and honest revocation.
--
-- This migration exists to close five confirmed correctness bugs found by an
-- external audit. Every column below is here because some real, reachable code
-- path could not tell two materially different situations apart without it.
-- The prose per column says WHICH two.

-- ---------------------------------------------------------------------------
-- evidence — the "fetched" / "parsed" / "locator-resolvable" split (bug 3),
-- inline-excerpt provenance (bug 1), and revocation (bug 4).
-- ---------------------------------------------------------------------------

-- content_kind: WHICH canonical coordinate system the retained text is
-- expressed in. A locator's meaning is not portable across evidence types —
-- character offsets into stripped HTML, character offsets into PDF-extracted
-- text, and a JSONPath into a canonical JSON payload are three different
-- coordinate systems. Before this column the row recorded no such thing, so a
-- stored locator could not be re-dereferenced with any certainty about what it
-- was a coordinate INTO. NULL means "never resolved" (still pending).
ALTER TABLE evidence ADD COLUMN content_kind text
  CHECK (content_kind IS NULL OR content_kind IN ('html', 'plaintext', 'pdf', 'json', 'inline_excerpt'));

-- text_provenance: whether the retained text was FETCHED by this system from
-- the row's URL, or SUPPLIED BY THE CALLER as an excerpt. This distinction was
-- previously unrepresentable and the ambiguity ran in both directions. An
-- earlier bug (see HANDOFF.md) dropped a caller-supplied excerpt in favour of
-- an unresolved URL. The reverse bug is the one this column closes: the MCP
-- layer sends BOTH `payload` (the pasted excerpt) and `submitted_url` on one
-- registration, evidence.ts marks the row 'retrieved' from the payload alone
-- and never fetches the URL, and resolveEvidence.ts then hands back
-- canonical_url/submitted_url as the row's "locator" — presenting text the
-- system never fetched as though it had been proved to come from that URL.
-- With this column an inline excerpt is structurally labelled
-- 'caller_supplied' and its locator says so, whether or not a URL is present.
ALTER TABLE evidence ADD COLUMN text_provenance text
  CHECK (text_provenance IS NULL OR text_provenance IN ('fetched', 'caller_supplied'));

-- canonical_text_hash: sha256 of resolved_text EXACTLY as retained. Character
-- offsets are only meaningful against one exact string; this hash is what lets
-- a stored locator prove, at read time, that the retained text is still the
-- text its offsets were computed against. payload_hash cannot serve this
-- purpose: for a fetched PDF it is a hash of raw BYTES, not of the canonical
-- text, so it says nothing about the coordinate space.
ALTER TABLE evidence ADD COLUMN canonical_text_hash text;

-- parse_status: fetched is NOT parsed. Before this column, a PDF that was
-- successfully fetched but had no text extracted (there was no PDF parser in
-- this codebase at all) was stored as retrieval_status = 'retrieved' and the
-- review flow counted it as an addressable, check-completing source — turning
-- "Notary could not inspect this evidence" into "the evidence did not support
-- the claim" (UNSUPPORTED instead of INDETERMINATE). retrieval_status answers
-- "did the bytes arrive"; parse_status answers "is there readable, locatable
-- content", and only the second one licenses a completed check.
--   not_attempted — never resolved, or resolution failed before parsing.
--   parsed        — canonical text was extracted and retained.
--   parse_failed  — a parser ran and errored on this payload.
--   not_parseable — the payload is a class this build has no parser for.
ALTER TABLE evidence ADD COLUMN parse_status text NOT NULL DEFAULT 'not_attempted'
  CHECK (parse_status IN ('not_attempted', 'parsed', 'parse_failed', 'not_parseable'));

-- parse_error: the parser's own failure reason, kept so an operator can tell a
-- corrupt PDF from an unsupported one without re-running the fetch.
ALTER TABLE evidence ADD COLUMN parse_error text;

-- page_ranges: for a PDF, the half-open [start, end) character range of each
-- page within resolved_text, as [{"num":1,"start":0,"end":812}, ...]. A PDF's
-- canonical text is the concatenation of its per-page text, so a character
-- offset maps to exactly one page — but only if the boundaries are RETAINED.
-- Without this column a locator built during the resolving request could carry
-- a page number while every later review of the same row could not, which is
-- precisely the kind of silent asymmetry that makes a locator untrustworthy.
-- NULL for every non-PDF row.
ALTER TABLE evidence ADD COLUMN page_ranges jsonb;

-- retrieval_status gains 'revoked'. Revocation was previously represented ONLY
-- by access_revoked_at, and every read path keyed off retrieval_status —
-- which stayed 'retrieved' forever after a delete. Making revocation a
-- first-class retrieval_status means a resolver that forgets to check
-- access_revoked_at still cannot mistake a revoked row for a retrieved one.
ALTER TABLE evidence DROP CONSTRAINT evidence_retrieval_status_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_retrieval_status_check
  CHECK (retrieval_status IN ('pending', 'retrieved', 'unavailable', 'revoked'));

-- ---------------------------------------------------------------------------
-- evidence_match — real exact locators (bug 1) and a truthful post-revocation
-- marker (bug 4).
-- ---------------------------------------------------------------------------

-- locator_json: the canonical, machine-dereferenceable locator. The existing
-- `locator` text column held only a URL or an "inline:<hash>" string — neither
-- of which identifies a PASSAGE, so the claim-evidence relation this product
-- exists to record was not actually inspectable, and a source that later
-- changed could not be checked against what was assessed. This column holds
-- the typed Locator from src/evidence/locators.ts: the coordinate kind, the
-- provenance, the canonical text hash, the [start, end) offsets, and the exact
-- quote at those offsets. `locator` is kept, unchanged and still NOT NULL, as
-- the human-readable form so nothing that reads it breaks.
ALTER TABLE evidence_match ADD COLUMN locator_json jsonb;

-- locator_resolved / locator_resolved_at: proof that the locator was
-- DEREFERENCED against the retained canonical text at state-assignment time —
-- not merely computed once at write time and trusted thereafter. A match may
-- only be persisted as supports/contradicts when this is true.
ALTER TABLE evidence_match ADD COLUMN locator_resolved boolean NOT NULL DEFAULT false;
ALTER TABLE evidence_match ADD COLUMN locator_resolved_at timestamptz;

-- payload_revoked_at: stamped on every historical match of an evidence row at
-- the moment that row's payload is revoked. The historical result must not
-- silently change (it was a true finding when it was made) but it must also
-- not keep presenting a locator into text that no longer exists. This column
-- is how a reader is told "this finding's payload was later revoked".
ALTER TABLE evidence_match ADD COLUMN payload_revoked_at timestamptz;

CREATE INDEX evidence_match_evidence_id_idx ON evidence_match (evidence_id);

-- ---------------------------------------------------------------------------
-- claim — per-claim lifecycle state (bug 2).
-- ---------------------------------------------------------------------------

-- lifecycle_state: WHERE a claim got to in the pipeline, kept strictly
-- separate from `state` (WHAT the evidence showed). Before this column the two
-- were conflated at the consumer: an extraction FAILURE and a genuinely
-- claim-free answer were both an empty claim list, and a claim whose
-- submission failed was silently dropped — all three rendering as "no issue
-- found". `state` is assigned only by the deterministic state machine and is
-- untouched by this column; lifecycle_state is orthogonal bookkeeping that
-- lets a caller refuse to call a review clean when something did not finish.
--   not_extracted  — the extraction step itself failed; no claim list exists.
--   extracted      — extracted from the answer, not yet submitted.
--   submitted      — accepted by the engine, verification in flight.
--   completed      — verification ran to completion; `state` is meaningful.
--   not_checkable  — verification ran but could not complete (unresolved
--                    locator, parser failure, quota denial, or a required
--                    field the judge abstained on); `state` is INDETERMINATE.
--   failed         — the claim's own processing errored.
-- DEFAULT 'completed' is correct for the rows that already exist: every claim
-- written before this migration was written by a runReview() call that had
-- already run to completion (the row is only inserted at step 8).
ALTER TABLE claim ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'completed'
  CHECK (lifecycle_state IN ('not_extracted', 'extracted', 'submitted', 'completed', 'not_checkable', 'failed'));

-- lifecycle_detail: the machine-readable reason a claim is not_checkable or
-- failed (e.g. 'quota_denied', 'locator_unresolved', 'evidence_not_parsed').
-- NULL for completed claims.
ALTER TABLE claim ADD COLUMN lifecycle_detail text;
