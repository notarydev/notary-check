-- Notary Check engine — Advance (Track 2 v2) persistence layer.
--
-- Advance is a SEPARATE, NEWER system from Track 2 v1 / Challenge (migration
-- 0012_track2_challenge.sql, challenge_item). Challenge is frozen (its flag
-- stays off, engine/src/judge/challenge*.ts is not extended further); Advance
-- (engine/src/advance/) is what "Track 2" means in this product going
-- forward (docs/guide/proposals/system-definition-synthesis.md Part 11,
-- "promoted from proposal to build target, 2026-09-03"). This migration does
-- not touch challenge_item or the organization.track2_enabled column at all.
--
-- THE AUTHORITY BOUNDARY, restated in schema form, same discipline as
-- challenge_item's own header comment: Advance is a non-authoritative
-- SUGGESTION register. Nothing here has a foreign key TO claim.state, nothing
-- here is read by verification/stateMachine.ts, and no column in this
-- migration is nullable-as-a-verdict — there is no state/verdict/confidence
-- column anywhere below, structurally matching AdvanceSuggestion
-- (engine/src/advance/types.ts), which has no such field either.

-- ---------------------------------------------------------------------------
-- advance_invocation — one row per Advance generation attempt (one call to
-- generateAdvanceSuggestions(), whether or not it produced usable output).
-- ---------------------------------------------------------------------------
--
-- Mirrors challenge_item's own provenance discipline (model / prompt_version)
-- plus the two Advance-specific facts a later reader needs that Challenge
-- never had: which POLICY generation constrained the allowed move set
-- (policy.ts's POLICY_VERSION — a policy-table diff is meaningless without
-- knowing which invocation it applied to), and whether a call happened AT ALL
-- — status 'skipped' records the policy short-circuit (no legal move, or no
-- user_request) as a real, queryable row rather than silence, so "Advance
-- never ran for this claim" is distinguishable from "Advance ran and found
-- nothing" (status 'ok', zero suggestion rows) from "Advance's call failed"
-- (status 'error').
CREATE TABLE advance_invocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id uuid NOT NULL REFERENCES organization(id),

  -- review_id / claim_id: today's caller (review/reviewFlow.ts) runs Advance
  -- per claim submission, alongside Track 2/Challenge — see that file's
  -- runAdvanceForClaim for why (the engine currently has no single
  -- "review finished" endpoint; claims are submitted one per request). Both
  -- are nullable and ON DELETE CASCADE because a future per-REVIEW (rather
  -- than per-claim) caller is the more faithful reading of Advance's own
  -- per-invocation design (Part 11: "Advance works per-invocation... about
  -- the user's broader task — not about a specific claim") and should not
  -- require a schema change to land.
  review_id uuid REFERENCES review(id) ON DELETE CASCADE,
  claim_id  uuid REFERENCES claim(id) ON DELETE CASCADE,

  -- The InvocationContext.invocation_id this call was built from (types.ts:
  -- "opaque to this module — never parsed or matched against"). Kept as text,
  -- not a foreign key, for the same reason: this module treats it as an
  -- opaque caller-assigned label, never a join target.
  invocation_context_id text NOT NULL,

  -- InvocationContext.task_mode, when the caller declared one — governs which
  -- POLICY_TABLE row (policy.ts) computed allowed_moves below. Null means
  -- "general"/undefined, the documented default (full four-move set).
  task_mode text,

  -- Whether a sealed Track2EvidenceConstraint was attached (types.ts) — the
  -- one fact that determines withConstraint vs noConstraint in policy.ts.
  -- Denormalized here (rather than requiring a reader to re-derive it from
  -- the presence/absence of some other row) because it is exactly the
  -- deciding input to the move-set policy a later audit needs to reconstruct
  -- alongside policy_version.
  has_evidence_constraint boolean NOT NULL DEFAULT false,

  -- The allowed move set (policy.ts's getAllowedMoves output) for THIS call,
  -- as the closed four-move vocabulary restricted to a JSON array — the
  -- actual constraint the validator enforced, not re-derivable later if
  -- POLICY_TABLE itself changes underneath a stored policy_version.
  allowed_moves jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- policy.ts's POLICY_VERSION at call time — required so a stored row is
  -- attributable to the exact policy generation that computed allowed_moves,
  -- same rationale as that constant's own doc comment.
  policy_version text NOT NULL,

  -- Judge authority boundary requirement #6, applied to Advance exactly as
  -- challenge_item already applies it to Challenge: which model produced any
  -- output, and under which prompt version (prompt.ts's ADVANCE_PROMPT_VERSION).
  model text NOT NULL,
  prompt_version text NOT NULL,

  -- 'ok'      — the call ran (or was validly short-circuited to zero) and
  --             this row's suggestion children (0-2) are the real result.
  -- 'error'   — a call reached the network (or attempted to) and failed:
  --             transport failure, validation rejection, quota denial, or
  --             the kill switch. `error` names the reason.
  -- 'skipped' — no call was attempted at all: no legal move for this state,
  --             or no user_request was available (§ liveGenerate.ts's
  --             policy-boundary short-circuits). Zero cost, zero network,
  --             recorded anyway so the absence itself is queryable.
  status text NOT NULL CHECK (status IN ('ok', 'error', 'skipped')),
  error  text,

  -- Real token/cost provenance, same shape usage_event already carries for
  -- every other DeepSeek call site (quotas/usage.ts) — null when status is
  -- 'skipped' (no network call happened) or when a call failed before a
  -- token count was ever returned.
  input_tokens          integer,
  output_tokens          integer,
  estimated_cost_cents   integer,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX advance_invocation_review_id_idx ON advance_invocation (review_id);
CREATE INDEX advance_invocation_claim_id_idx ON advance_invocation (claim_id);
CREATE INDEX advance_invocation_organization_id_created_at_idx ON advance_invocation (organization_id, created_at);

-- ---------------------------------------------------------------------------
-- advance_suggestion — Advance's actual output, deliberately in its own
-- table, same reasoning as challenge_item's separation from evidence_match:
-- a suggestion establishes nothing and rests on no locator, so it must never
-- be mistakable for an authority-bearing row one careless SELECT away.
-- ---------------------------------------------------------------------------
CREATE TABLE advance_suggestion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  invocation_id uuid NOT NULL REFERENCES advance_invocation(id) ON DELETE CASCADE,

  -- AdvanceSuggestion.id (types.ts) — the MODEL's own, caller-chosen id,
  -- unique only WITHIN one response per validator.ts's cardinality layer.
  -- Kept as a separate column from this table's own `id` (never reused as
  -- the primary key) because the model's id is untrusted input already
  -- validated for uniqueness-within-response, not a value this schema should
  -- treat as globally unique or stable across regenerations.
  model_suggestion_id text NOT NULL,

  -- Position within this invocation's own 0-2 set. A UNIQUE index on
  -- (invocation_id, ordinal) is the DB-visible half of the cardinality cap —
  -- validator.ts's MAX_SUGGESTIONS=2 is app-level; this is the second,
  -- independent guard, same precedent as challenge_item_claim_ordinal_idx.
  ordinal integer NOT NULL,

  -- The closed four-move vocabulary (types.ts's AdvanceMove), CHECK-enforced
  -- independently of validator.ts's zod enum — a future caller that writes
  -- this table without going through the validator still cannot invent a
  -- fifth move.
  move text NOT NULL CHECK (move IN ('clarify', 'test', 'compare', 'repair')),

  -- The two free-text fields AdvanceSuggestion may produce, and — as with
  -- challenge_item — the list of columns here is itself part of the
  -- contract: there is deliberately no verdict, confidence, score, or answer
  -- column, so a model output that smuggled one past validateAdvanceOutput's
  -- .strict() schema would still have nowhere to land even if it reached
  -- this far (it cannot: validation runs first, in generateAdvanceSuggestions).
  short_label text NOT NULL,
  prompt      text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX advance_suggestion_invocation_ordinal_idx ON advance_suggestion (invocation_id, ordinal);
CREATE INDEX advance_suggestion_invocation_id_idx ON advance_suggestion (invocation_id);

-- ---------------------------------------------------------------------------
-- advance_event — lifecycle events for one suggestion, for future evaluation
-- (Part 11's offline-eval / causal-experiment plan needs real interaction
-- traces, not synthetic ones — this table is what makes that data exist).
-- ---------------------------------------------------------------------------
--
-- Deliberately UI-driven, append-only, and never read by anything in
-- engine/src/advance/ itself: this table has no bearing on what Advance
-- generates or validates, only on what a later evaluation pass can measure
-- about what happened to a suggestion after it was returned.
CREATE TABLE advance_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  suggestion_id uuid NOT NULL REFERENCES advance_suggestion(id) ON DELETE CASCADE,

  -- 'shown'     — the suggestion was rendered in the card (pill at rest).
  -- 'revealed'  — the user's first interaction surfaced the full prompt
  --               (hover on desktop, or the reveal half of a click-to-reveal
  --               flow — see ui/src/App.tsx's ActionPill).
  -- 'committed' — the user's action actually staged the prompt to the host
  --               via app.sendMessage() (still not proof the user hit send —
  --               see App.tsx's sendToHost comment on what that call can and
  --               cannot confirm).
  -- 'dismissed' — the user explicitly dismissed the card without engaging
  --               this suggestion.
  event_type text NOT NULL CHECK (event_type IN ('shown', 'revealed', 'committed', 'dismissed')),

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX advance_event_suggestion_id_idx ON advance_event (suggestion_id);
CREATE INDEX advance_event_event_type_idx ON advance_event (event_type);
