-- Notary Check engine — billing scaffolding (Stripe test account, not a live
-- launch; see docs/plan.md § Public-launch readiness for the real sequencing).
-- Extends the step-1 Organization stub with the three billing-relevant fields
-- from § Core data model's Organization(id, plan, data_region, retention_policy)
-- plus the Stripe linkage columns:
--   plan                   — 'starter' | 'pro' | 'team' | 'enterprise' (default 'starter')
--   stripe_customer_id     — Stripe Customer object id; unique WHEN PRESENT
--                            (a partial unique index, so NULLs do not collide)
--   stripe_subscription_id — Stripe Subscription object id
-- No other table is touched.

ALTER TABLE organization ADD COLUMN plan text NOT NULL DEFAULT 'starter';
ALTER TABLE organization ADD COLUMN stripe_customer_id text;
ALTER TABLE organization ADD COLUMN stripe_subscription_id text;

-- Unique when present: rows without a Stripe customer (NULL) must be able to
-- coexist; only actual customer ids are constrained to be unique across orgs.
CREATE UNIQUE INDEX organization_stripe_customer_id_uq
  ON organization (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
