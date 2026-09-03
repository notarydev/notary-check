-- Notary Check engine — explicit entitlement state for the paid private alpha.
--
-- Until now `organization.plan` was the only signal billing left behind, and
-- it conflates two different questions: WHICH tier is the org on, and CAN the
-- org actually use the product right now. Those diverge the moment a card
-- fails: Stripe leaves the subscription (and therefore `plan`) alone for a
-- while during its own retry/dunning cycle, so `plan` keeps reading 'pro'
-- even though the org should be locked out. A paying alpha customer means a
-- real card can actually fail, so that gap can no longer be theoretical —
-- something has to be gateable independent of tier.
--
-- entitlement_status is that something: a small state machine driven entirely
-- by webhook.ts, checked by src/auth/entitlement.ts, and never touched by the
-- verification pipeline.
--   active    — paid (or free-tier) access is currently good; the default for
--               every organization, since Starter is a $0 tier that needs no
--               payment event to be usable.
--   past_due  — Stripe reported a failed invoice payment
--               (invoice.payment_failed) but hasn't canceled the subscription
--               yet; a grace-period state, not yet a hard lockout by itself.
--   canceled  — the subscription was deleted or explicitly canceled via
--               POST /v1/billing/cancel.
--   inactive  — reserved catch-all for an org that should not have access and
--               isn't mid-grace-period (e.g. manual ops action); not currently
--               set by any webhook handler, kept for forward compatibility so
--               checkEntitlement() has one clear "no" state to fall back on.
ALTER TABLE organization
  ADD COLUMN entitlement_status text NOT NULL DEFAULT 'active'
    CHECK (entitlement_status IN ('active', 'past_due', 'canceled', 'inactive'));
