-- Notary Check engine — diagnostics persistence (Step 0) + page-intake storage (Step 1)
--
-- STEP 0 — A claim's state must be explainable from the database alone.
--
-- Until this migration, `claim_fields` and `rejectedCandidates` were computed
-- per request and returned on the wire but never persisted. A claim that came
-- back UNSUPPORTED or INDETERMINATE could not be explained without replaying
-- the whole review: which field the claim asserted, and which evidence row
-- rejected it on which field, were not in any table. Measured cost 2026-09-05:
-- a live false negative (review 900530a5) and an 18-claim INDETERMINATE run
-- both took most of a morning to diagnose because the rejecting field lived
-- only in an HTTP response that was never stored.
--
--   claim.claim_fields         jsonb   — the claim's structured fields exactly
--                                       as submitted (entity/period/metric/
--                                       valueUnit/operator/comparatorBaseline/
--                                       modality/scope).
--   claim.rejected_candidates  jsonb   — one entry per resolved-but-inapplicable
--                                       evidence row: {evidence_id, locator,
--                                       mismatched_fields[], details[]}. Shape
--                                       mirrors review/types.ts's
--                                       RunReviewRejectedCandidate so the wire
--                                       contract and the stored record can never
--                                       drift apart.
--
-- STEP 1 — Fetch the cited page when a URL is present; keep the caller's
-- excerpt as the fallback and as provenance.
--
--   evidence.caller_excerpt    text    — the caller-supplied excerpt, retained
--                                       even after the page is fetched. Used as
--                                       the verification text ONLY when the fetch
--                                       is unreachable/unparseable; otherwise the
--                                       fetched page is what a claim is checked
--                                       against (E-EVIDENCE, ROADMAP.md).

ALTER TABLE claim
  ADD COLUMN IF NOT EXISTS claim_fields jsonb,
  ADD COLUMN IF NOT EXISTS rejected_candidates jsonb;

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS caller_excerpt text;
