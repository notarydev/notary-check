-- Notary Check engine — review orchestrator wiring.
--
-- Extends the Review stub from 0001 with the lifecycle columns the orchestrator
-- needs, scopes review idempotency per organization, and adds the orchestrator's
-- read-side payload stand-in on Evidence.

-- idempotency_key: a caller-supplied string identifying ONE logical review
-- attempt. A duplicated tool call must resolve to the same Review row, never a
-- second contradictory one (§ Core data model; § Locked test suite case 18).
-- NULL for pre-existing rows (0002's seeded review) and for any review created
-- without a key.
ALTER TABLE review ADD COLUMN idempotency_key text;
ALTER TABLE review ADD COLUMN status text NOT NULL DEFAULT 'processing'
  CHECK (status IN ('processing', 'complete', 'failed'));
ALTER TABLE review ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE review ADD COLUMN completed_at timestamptz;

-- Partial unique index: idempotency is scoped PER ORGANIZATION, not global —
-- two different orgs may coincidentally submit the same key, and that is not a
-- conflict. The WHERE clause keeps the constraint out of the way of the
-- pre-existing seeded row and any future key-less review.
CREATE UNIQUE INDEX review_org_idempotency_key_uniq
  ON review (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- resolved_text: a deliberate, narrowly-scoped STAND-IN for the real S3-backed
-- payload store (§ Architecture, "Payload store" row), which is explicitly out
-- of scope to build here. Without persisting *something* retrievable, the
-- review flow below could not re-use a previously-registered/resolved Evidence
-- row's content on a later request. This column is NOT a replacement for the
-- real payload store — it exists only so the orchestrator has something to
-- read. A later task should replace it with real object-store-backed retrieval.
ALTER TABLE evidence ADD COLUMN resolved_text text;
