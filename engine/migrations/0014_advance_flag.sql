-- Notary Check engine — Advance's own org-level feature flag.
--
-- WHY THIS EXISTS, AND WHY IT IS LATE.
--
-- docs/build/tier-1-build-and-operating-plan.md § Track 2 / Advance has always
-- said: "Track 2 v1 (Challenge)'s org feature flag (`track2_enabled`,
-- migration 0012) stays off and is not reused for Advance — Advance gets its
-- own flag once it has its own persisted state to gate. The two features are
-- not variants of the same flag."
--
-- Migration 0013 gave Advance persisted state on 2026-09-03. The flag was
-- never added, so Advance shipped to production ungated — by omission, not by
-- decision. This closes that gap.
--
-- WHY A COLUMN AND NOT AN ENV VAR, restated from 0012's own reasoning because
-- it applies identically here: the rollout is per-customer, not per-deployment.
-- A process-wide env flag cannot express "on for the design partner, off for
-- everyone else" on one engine.
--
-- DEFAULT false + BACKFILL true — the load-bearing pair, and the two halves do
-- different jobs:
--
--   DEFAULT false keeps the "ship dark" discipline for every org created from
--   here on. Advance is an ADDITIONAL DeepSeek call per material claim; a
--   default-on flag would silently add spend to every future organization the
--   moment it is created, which is exactly what quotas/quotaCheck.ts exists to
--   prevent. It also matches Advance's actual validation status: its required
--   adversarial evaluation (§ build-order step 7) was run for the first time on
--   2026-09-03, AFTER it had already shipped.
--
--   The backfill to true preserves CURRENT behavior for orgs that already have
--   Advance running. Adding this flag must not be a silent feature removal for
--   a live user — that would be a regression dressed up as governance. Existing
--   orgs keep what they have; new orgs start dark and are turned on
--   deliberately.
--
-- This is the one meaningful difference from 0012, where Challenge was flagged
-- off for everyone because nothing was using it yet.

ALTER TABLE organization
  ADD COLUMN advance_enabled boolean NOT NULL DEFAULT false;

-- Preserve current production behavior: every organization that exists at the
-- moment this migration applies already had Advance running unflagged, so
-- turning it off here would remove a working feature from a live user.
UPDATE organization SET advance_enabled = true;
