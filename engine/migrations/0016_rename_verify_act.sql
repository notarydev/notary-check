-- Notary Check engine — the Verify / Act rename.
--
-- WHY THIS EXISTS.
--
-- The two halves of an invocation were called "Track 1" and "Track 2", and
-- Track 2's second layer was called "Advance". Three problems, all of them
-- costs paid by whoever reads this schema next:
--
--   1. "Track 1"/"Track 2" name an ORDER, not a job. Nothing in either name
--      says which one is the deterministic evidence check and which one is the
--      judged suggestion — a reader has to hold an external mapping in their
--      head, and every doc that explains the mapping is another thing that can
--      go stale.
--   2. "Advance" was doing double duty: it named Track 2 as a whole in some
--      places and Track 2's move-generation layer in others. The two readings
--      are not distinguishable from the identifier alone.
--   3. The `move` COLUMN already existed inside `advance_suggestion`, holding
--      the closed four-move vocabulary. The row was a move; the table said
--      "suggestion"; the layer said "Advance". Three words for one thing.
--
-- The vocabulary from here on is two verbs and one noun:
--
--   VERIFY  — the deterministic half. Claim vs. resolved evidence, run through
--             the state machine. Was "Track 1".
--   ACT     — the judged half, which never assigns a state. Was "Track 2". It
--             has two layers, and they keep their existing distinct names:
--               · CHALLENGE — bounded questions about a claim (unchanged).
--               · MOVE      — the closed four-move next-action set. Was
--                             "Advance".
--
-- This migration renames the schema to match. It is PURELY a rename: no
-- column is added or dropped, no CHECK constraint's admitted value set
-- changes, no row's meaning changes, and the authority boundary migration
-- 0012 established is untouched — `act_move` and `act_challenge_enabled` still
-- cannot produce a claim state, for exactly the reasons 0012 spells out.
--
-- WHY RENAME AT ALL, RATHER THAN LEAVE THE SCHEMA AND FIX ONLY THE CODE.
--
-- Because a schema that disagrees with its code is the same class of defect
-- this codebase already treats a stale doc as. The next person to open a psql
-- prompt would find a vocabulary that exists nowhere else in the repo, with no
-- signpost telling them `advance_suggestion` and `Move` are the same thing.
-- Doing it now is cheap — the alpha is not live-paid and the row counts are
-- small; doing it after launch would not be.

-- ---------------------------------------------------------------------------
-- act_invocation — one row per Act invocation. Was advance_invocation.
-- ---------------------------------------------------------------------------
ALTER TABLE advance_invocation RENAME TO act_invocation;

-- Constraints and indexes do NOT follow their table's rename in Postgres; they
-- keep whatever name they were created under. Renaming them explicitly is what
-- keeps `\d act_invocation` from printing the old vocabulary back at the
-- reader this migration exists to help.
ALTER TABLE act_invocation RENAME CONSTRAINT advance_invocation_pkey                TO act_invocation_pkey;
ALTER TABLE act_invocation RENAME CONSTRAINT advance_invocation_organization_id_fkey TO act_invocation_organization_id_fkey;
ALTER TABLE act_invocation RENAME CONSTRAINT advance_invocation_review_id_fkey       TO act_invocation_review_id_fkey;
ALTER TABLE act_invocation RENAME CONSTRAINT advance_invocation_claim_id_fkey        TO act_invocation_claim_id_fkey;
ALTER TABLE act_invocation RENAME CONSTRAINT advance_invocation_status_check         TO act_invocation_status_check;

ALTER INDEX advance_invocation_review_id_idx                 RENAME TO act_invocation_review_id_idx;
ALTER INDEX advance_invocation_claim_id_idx                  RENAME TO act_invocation_claim_id_idx;
ALTER INDEX advance_invocation_organization_id_created_at_idx RENAME TO act_invocation_organization_id_created_at_idx;

-- ---------------------------------------------------------------------------
-- act_move — one row per emitted move. Was advance_suggestion.
-- ---------------------------------------------------------------------------
--
-- Named `act_move` rather than plain `move` deliberately: MOVE is a Postgres
-- command (cursor movement), and while it is not a reserved identifier, an
-- unquoted table named `move` alongside this table's own `move` column is a
-- readability trap for no gain. The `act_` prefix also groups the three tables
-- of this half together in an alphabetical `\dt`, which is the whole point of
-- the exercise.
ALTER TABLE advance_suggestion RENAME TO act_move;

-- model_move_id: the id the MODEL gave its own move in one response, kept so a
-- persisted row can be traced back to the exact model output that produced it.
-- Renamed with everything else; "suggestion" is the retired word.
ALTER TABLE act_move RENAME COLUMN model_suggestion_id TO model_move_id;

ALTER TABLE act_move RENAME CONSTRAINT advance_suggestion_pkey               TO act_move_pkey;
ALTER TABLE act_move RENAME CONSTRAINT advance_suggestion_invocation_id_fkey TO act_move_invocation_id_fkey;
ALTER TABLE act_move RENAME CONSTRAINT advance_suggestion_move_check         TO act_move_move_check;

ALTER INDEX advance_suggestion_invocation_ordinal_idx RENAME TO act_move_invocation_ordinal_idx;
ALTER INDEX advance_suggestion_invocation_id_idx      RENAME TO act_move_invocation_id_idx;

-- ---------------------------------------------------------------------------
-- act_move_event — telemetry on a move. Was advance_event.
-- ---------------------------------------------------------------------------
ALTER TABLE advance_event RENAME TO act_move_event;

-- The FK column is `suggestion_id`, and it is renamed with the table it points
-- at: the referenced table is now act_move, so a column called suggestion_id
-- would be the last surviving use of the word this migration is retiring.
ALTER TABLE act_move_event RENAME COLUMN suggestion_id TO move_id;

ALTER TABLE act_move_event RENAME CONSTRAINT advance_event_pkey              TO act_move_event_pkey;
ALTER TABLE act_move_event RENAME CONSTRAINT advance_event_suggestion_id_fkey TO act_move_event_move_id_fkey;
ALTER TABLE act_move_event RENAME CONSTRAINT advance_event_event_type_check   TO act_move_event_event_type_check;

ALTER INDEX advance_event_suggestion_id_idx RENAME TO act_move_event_move_id_idx;
ALTER INDEX advance_event_event_type_idx    RENAME TO act_move_event_event_type_idx;

-- ---------------------------------------------------------------------------
-- organization — the two per-org feature flags.
-- ---------------------------------------------------------------------------
--
-- Both keep their current VALUES exactly. Migration 0014's backfill decision
-- (existing orgs keep the feature they already had; new orgs start dark) is
-- preserved untouched — renaming a flag must not silently change who has it.
ALTER TABLE organization RENAME COLUMN track2_enabled  TO act_challenge_enabled;
ALTER TABLE organization RENAME COLUMN advance_enabled TO act_moves_enabled;

-- ---------------------------------------------------------------------------
-- challenge_item — the Verify-state snapshot columns.
-- ---------------------------------------------------------------------------
--
-- These hold the state the challenge was generated AGAINST, which is what lets
-- a reader tell a stale question from a current one (see 0012). They were
-- named for the track that produced the state; they are now named for it.
ALTER TABLE challenge_item RENAME COLUMN track1_state        TO verify_state;
ALTER TABLE challenge_item RENAME COLUMN track1_state_reason TO verify_state_reason;

-- ---------------------------------------------------------------------------
-- usage_event — the one place the old vocabulary lives in DATA, not DDL.
-- ---------------------------------------------------------------------------
--
-- `event_type` is free text with no CHECK, and the move-generation path wrote
-- 'advance_generation'. quotas/usage.ts now writes 'move_generation'. Without
-- this UPDATE the ledger would report one spend category as two, and every
-- cost query would have to know both spellings forever. Historical rows are
-- rewritten rather than left split precisely because the ledger's job is to be
-- summable.
UPDATE usage_event SET event_type = 'move_generation' WHERE event_type = 'advance_generation';
