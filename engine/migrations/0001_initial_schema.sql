-- Notary Check engine — Phase 1 build-order step 1.
-- Only the Evidence table, plus the smallest possible stub Organization and
-- Review tables (just enough columns for referential integrity and
-- organization scoping). The full data model from § Core data model is later,
-- separate build-order work.

-- Organization stub. id + name only; the rest of the full model
-- (plan, data_region, retention_policy, ...) is out of scope here.
CREATE TABLE organization (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

-- Review stub. id + organization_id only; the full model is out of scope here.
CREATE TABLE review (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id)
);

-- The Evidence table, exactly as specified in § Core data model:
--   Evidence(id, review_id, origin, submitted_url, canonical_url, payload_ref,
--            payload_hash, retrieval_status, retrieved_at, locator_scheme,
--            retention_until, submitted_by, snapshot_reuse_policy, access_revoked_at)
-- No extra columns.
--
-- Append-only by construction: this step's API is insert-only. A later fetch
-- of the same URL is a NEW Evidence row, never an update to an existing one
-- (§ Security, privacy, and reliability requirements). access_revoked_at (a
-- future revocation write) is a column here but revocation is not built yet.
CREATE TABLE evidence (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id             uuid NOT NULL REFERENCES review(id),
  origin                text NOT NULL CHECK (origin IN ('answer_citation', 'user_added', 'workspace_collection')),
  submitted_url         text,
  canonical_url         text,
  payload_ref           text,
  payload_hash          text,
  retrieval_status      text NOT NULL DEFAULT 'pending' CHECK (retrieval_status IN ('pending', 'retrieved', 'unavailable')),
  retrieved_at          timestamptz,
  locator_scheme        text,
  retention_until       timestamptz,
  submitted_by          text,
  snapshot_reuse_policy text,
  access_revoked_at     timestamptz,

  -- A source must be addressable by a URL, a payload reference, or an inline
  -- payload (whose presence is recorded as payload_hash). Nothing is created
  -- with all three absent.
  CHECK (submitted_url IS NOT NULL OR payload_ref IS NOT NULL OR payload_hash IS NOT NULL)
);

CREATE INDEX evidence_review_id_idx ON evidence (review_id);
