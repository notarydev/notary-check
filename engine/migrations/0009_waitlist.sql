-- Notary Check engine — public waitlist capture.
--
-- Foundation piece for the signup gate: the canonical build plan
-- (docs/build/tier-1-build-and-operating-plan.md) blocks public self-serve
-- signup/payment until the held-out eval gate passes, which it hasn't yet
-- (see docs/build/architecture-and-progress.md). Until then, the dashboard's
-- landing page defaults to email capture instead of real Clerk signup (see
-- NOTARY_SIGNUP_MODE in dashboard/). This table is the audit trail for that:
-- one row per captured email, plus a manual `invited_at` timestamp set by
-- whoever approves an entry and sends a real Clerk invitation. There is no
-- automation from a row in this table to an actual Clerk invite in v1 — that
-- step is a deliberate human-in-the-loop ops action, not code.
CREATE TABLE waitlist_signup (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  source     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  invited_at timestamptz
);
