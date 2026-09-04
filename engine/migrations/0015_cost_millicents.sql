-- Notary Check engine — sub-cent cost metering.
--
-- THE BUG THIS FIXES, stated plainly because it made two documented controls
-- fictional rather than merely imprecise.
--
-- `estimateDeepSeekCostCents` computed `Math.round(usd * 100)`. A typical
-- DeepSeek call in this system is about $0.00134 — that is 0.134 cents, which
-- rounds to **0**. So essentially every judge call, extraction call, and
-- Advance call wrote `estimated_cost_cents = 0` into the usage ledger.
--
-- Both spend gates sum that column. Summing zeros gives zero, so:
--   - the per-organization monthly limit never bit;
--   - the global provider spend cap never bit.
--
-- docs/build/tier-1-build-and-operating-plan.md § Cost-control rules requires
-- both ("enforce monthly per-user and per-organization quotas plus hard
-- provider spend caps"), and § Security lists spend caps and cost circuit
-- breakers as requirements. They existed in code and measured nothing. That is
-- worse than having no meter, because a meter reading zero is trusted.
--
-- The pre-existing test suite encoded the bug as expected behaviour — it
-- asserted `estimatedCostCents === 0` for a realistic 4,000/700-token call —
-- which is how this survived review.
--
-- WHY MILLICENTS, AND WHY NOT THE ALTERNATIVES.
--
--   - Rounding UP (`Math.ceil`) would make every call meter as 1 cent, ~7x the
--     real cost. The caps would bite, but on fiction.
--   - `numeric` would work, but money in floating/decimal types invites
--     accumulated-rounding arguments later; integers do not.
--   - Millicents (1/1000 of a cent) gives a typical call a value of ~134,
--     which is plenty of resolution, and keeps the numbers small enough that
--     bigint has enormous headroom: the plan's heaviest modelled scenario
--     (400,000 checks/month) is ~53.6 million millicents, or about $536.
--
-- WHY `estimated_cost_cents` BECOMES A GENERATED COLUMN — the load-bearing
-- half of this migration, and not an aesthetic choice.
--
-- The obvious version of this fix (add a millicent column, write both, sum the
-- new one) leaves the original failure mode fully intact by a different route:
-- any INSERT that sets only `estimated_cost_cents` now writes 0 millicents and
-- silently disables the cap again. That is not hypothetical — the first
-- version of this migration did exactly that, and a pre-existing test caught
-- it by seeding cost through raw SQL against the cent column.
--
-- Making cents GENERATED ALWAYS from millicents removes the possibility:
--   - millicents is the only writable cost field, so it cannot be forgotten;
--   - cents can never disagree with it, because it is derived, not stored
--     twice;
--   - a writer that tries to set cents directly gets a hard Postgres error
--     rather than a silently under-metered row. Loud beats lossy.
--
-- Cents is kept (not dropped) because it is the human-readable figure for
-- dashboards, invoices, and the existing `GET /v1/usage` response shape.

-- ---------------------------------------------------------------------------
-- usage_event
-- ---------------------------------------------------------------------------

ALTER TABLE usage_event
  ADD COLUMN estimated_cost_millicents bigint NOT NULL DEFAULT 0;

-- Preserve what was actually recorded rather than inventing history. For
-- nearly every existing row this writes 0, because 0 is what was truthfully
-- stored — the real spend was never captured and cannot be recovered from a
-- rounded-to-zero integer.
--
-- Consequence worth stating so nobody misreads a chart later: spend for any
-- period before this migration is understated, and no backfill can fix that.
-- Only usage recorded after this migration is trustworthy.
UPDATE usage_event
  SET estimated_cost_millicents = estimated_cost_cents::bigint * 1000
  WHERE estimated_cost_cents <> 0;

-- Round-trip safe: the backfill above set millicents = cents * 1000, so
-- regenerating cents as millicents / 1000 returns every historical row to the
-- value it already had.
ALTER TABLE usage_event DROP COLUMN estimated_cost_cents;
ALTER TABLE usage_event
  ADD COLUMN estimated_cost_cents integer
  GENERATED ALWAYS AS ((estimated_cost_millicents / 1000)::integer) STORED;

-- The quota gates sum millicents per organization per calendar month.
CREATE INDEX IF NOT EXISTS usage_event_org_created_at_idx
  ON usage_event (organization_id, created_at);

-- ---------------------------------------------------------------------------
-- advance_invocation — same treatment, same reasoning. Nullable here, because
-- a 'skipped' invocation made no network call and has no cost at all, which is
-- a different fact from "cost zero".
-- ---------------------------------------------------------------------------

ALTER TABLE advance_invocation
  ADD COLUMN estimated_cost_millicents bigint;

UPDATE advance_invocation
  SET estimated_cost_millicents = estimated_cost_cents::bigint * 1000
  WHERE estimated_cost_cents IS NOT NULL AND estimated_cost_cents <> 0;

ALTER TABLE advance_invocation DROP COLUMN estimated_cost_cents;
ALTER TABLE advance_invocation
  ADD COLUMN estimated_cost_cents integer
  GENERATED ALWAYS AS ((estimated_cost_millicents / 1000)::integer) STORED;
