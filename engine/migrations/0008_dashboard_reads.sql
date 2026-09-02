-- Notary Check engine — dashboard read endpoints (org-scoped review history,
-- evidence library, usage/quota).
--
-- Both `claim.id` and `evidence.id` are `gen_random_uuid()` primary keys —
-- random, not time-sortable. Neither table has ever carried a timestamp
-- column (0003 defined Claim, 0001 defined Evidence, and no later migration
-- added one). Without a real `created_at`, there is no correct way to build a
-- paginated "review history" or "evidence library" list (keyset pagination
-- needs a monotonic, indexable ordering key — the uuid PK cannot provide
-- one), and no way to answer "how many checks did this org run this month"
-- (the usage endpoint's `checks_used_this_month` aggregation needs a
-- calendar-month filter on claim creation time). DEFAULT now() backfills
-- existing rows with the migration's apply time, which is an acceptable
-- approximation for rows created before dashboard reads existed — there is no
-- better answer available since no timestamp was ever recorded for them.
--
-- The indexes support the two read patterns the new routes need:
--   - claim_review_id_created_at_idx: claims for one review, in creation order
--     (GET /v1/reviews/:id's claim listing).
--   - evidence_created_at_idx: keyset pagination over the org-scoped evidence
--     library (GET /v1/evidence), ordered (created_at DESC, id DESC).
--   - review_organization_id_created_at_idx: keyset pagination over the
--     org-scoped review history (GET /v1/reviews).
ALTER TABLE claim ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE evidence ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX claim_review_id_created_at_idx ON claim (review_id, created_at);
CREATE INDEX evidence_created_at_idx ON evidence (created_at);
CREATE INDEX review_organization_id_created_at_idx ON review (organization_id, created_at);
