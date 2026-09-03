-- Notary Check engine — Track 2 / Challenge layer ("What to pressure-test").
--
-- Track 2 is the SECOND OUTPUT of one Notary invocation, never a second
-- WRITER (§ Track 2 / Challenge layer, "Authority invariant, restated for this
-- specific addition"). It produces typed, bounded QUESTIONS about a claim
-- whose Track 1 state is already resolved. It cannot assign a state, cannot
-- add evidence, and cannot alter the manifest.
--
-- Every column below exists because some real, reachable code path would
-- otherwise be unable to tell two materially different situations apart, or
-- because the authority boundary above would otherwise be enforceable only by
-- convention. The prose per column says which.

-- ---------------------------------------------------------------------------
-- organization — the org-level feature flag ("ship dark first").
-- ---------------------------------------------------------------------------

-- track2_enabled: whether the Challenge layer runs for this organization at
-- all. It exists as a COLUMN rather than an environment variable because the
-- rollout is per-customer, not per-deployment: the plan ships Track 2 dark and
-- turns it on for one org at a time, and a process-wide env flag cannot
-- express "on for the design partner, off for everyone else" on one engine.
--
-- DEFAULT false is the load-bearing half. Track 2 is an ADDITIONAL DeepSeek
-- call per material claim; defaulting it on would silently add spend to every
-- existing organization the moment this migration applied, against the same
-- cost-control rules quota_check.ts exists to enforce. review/reviewFlow.ts
-- reads this column BEFORE constructing any judge client or running any budget
-- query, so a disabled org costs exactly zero extra calls — not a call whose
-- result is then discarded.
ALTER TABLE organization
  ADD COLUMN track2_enabled boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- challenge_item — Track 2's output, deliberately in its OWN table.
-- ---------------------------------------------------------------------------
--
-- WHY NOT evidence_match, and why not a column on claim.
--
-- evidence_match is the authority-bearing record: its `relation` CHECK admits
-- only 'supports'/'contradicts', it carries a re-dereferenceable locator, a
-- resolved_text_hash, and the applicability comparison that assignState()
-- consumed. Every row in it is a resolved, evidence-bound fact about a claim.
-- A Track 2 item is the exact opposite kind of thing: a non-authoritative
-- QUESTION that rests on no locator and establishes nothing. Storing the two
-- in one table would mean the only difference between "this passage
-- contradicts the claim" and "a model wondered whether 'revenue' means gross"
-- is a discriminator column — one careless SELECT away from a question being
-- read as a finding. A separate table makes that class of mistake require a
-- deliberate JOIN rather than a forgotten WHERE.
--
-- Nor a JSON column on `claim`: the per-review cap (at most 4 items across all
-- claims of one review) has to be enforced against rows written by EARLIER
-- runReview() calls in the same review — claims are submitted one per request,
-- so the budget is a cross-claim count. A table makes that a plain COUNT with
-- a JOIN; a JSON blob per claim would require reading and re-parsing every
-- sibling claim to answer the same question.
CREATE TABLE challenge_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- claim_id: the ALREADY-RESOLVED Track 1 finding this item questions. The FK
  -- direction is the authority statement in schema form — a challenge item
  -- depends on a claim, a claim never depends on a challenge item, so no
  -- challenge row can be a precondition for a state. ON DELETE CASCADE because
  -- a question about a deleted claim is meaningless, never orphaned data worth
  -- retaining.
  claim_id uuid NOT NULL REFERENCES claim(id) ON DELETE CASCADE,

  -- ordinal: the item's position within its claim's own set (0 or 1 — the cap
  -- is two per claim). Present so the card can render items in a stable order
  -- across reads; without it, ordering would fall back to id or created_at,
  -- and two items written inside one transaction can share a created_at.
  ordinal integer NOT NULL,

  -- challenge_type / action: the two CLOSED vocabularies of the output
  -- contract (§ Track 2 output contract), enforced by CHECK rather than left
  -- to application-side validation. The zod parser in
  -- judge/challengeGeneration.ts already rejects anything outside these sets;
  -- the CHECK is the second, independent guard, so a future caller that writes
  -- this table without going through that parser still cannot invent a type.
  challenge_type text NOT NULL
    CHECK (challenge_type IN ('ambiguity', 'missing_assumption', 'alternative_interpretation',
                              'evidence_request', 'adversarial_test')),
  action text NOT NULL
    CHECK (action IN ('clarify_claim', 'add_source', 'open_evidence', 'ask_host',
                      'draft_test', 'leave_unchanged')),

  -- prompt: the neutral, bounded question shown to the user.
  -- why_it_matters: the conditional explanation tied to this claim/finding.
  -- These are the ONLY two free-text fields Track 2 may produce, and the list
  -- of columns here is itself part of the contract: there is deliberately no
  -- verdict, confidence, score, answer, or transcript column, so even a model
  -- output that smuggled one past the parser would have nowhere to land.
  prompt text NOT NULL,
  why_it_matters text NOT NULL,

  -- The provenance § Judge authority boundary requirement #6 already demands of
  -- every model call in this system, applied unchanged to this one: which model
  -- produced the item and under which prompt version. Without these a Track 2
  -- item read months later could not be attributed to the prompt that produced
  -- it, which is exactly the auditability the Track 1 judge already has.
  model text NOT NULL,
  prompt_version text NOT NULL,

  -- track1_state / track1_state_reason: a SNAPSHOT of the finding the item was
  -- generated against. Not redundant with claim.state: `recheck_claim` and
  -- ordinary claim revision are expected to change a claim's state over time,
  -- and a question generated against CONTRADICTED ("is this a forecast rather
  -- than a reported result?") can read as nonsense once the claim has become
  -- SUPPORTED. Storing the state the item was ABOUT lets a reader tell a stale
  -- question from a current one instead of silently mis-attributing it.
  track1_state text NOT NULL,
  track1_state_reason text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- The per-claim ordering/uniqueness the cap depends on: two items per claim,
-- at ordinals 0 and 1. A UNIQUE constraint rather than a plain index because a
-- duplicate ordinal would mean the same slot was written twice — a cap bug —
-- and it should fail loudly at write time rather than produce an unstable
-- render order.
CREATE UNIQUE INDEX challenge_item_claim_ordinal_idx ON challenge_item (claim_id, ordinal);

-- The per-INVOCATION cap (4 across all claims in one review) is answered by
-- counting this table's rows joined to claim on review_id, once per runReview
-- call, before any judge call is made. This index is what keeps that pre-flight
-- count cheap enough to run unconditionally on the enabled path.
CREATE INDEX challenge_item_claim_idx ON challenge_item (claim_id);
