-- Notary Check engine — persist what the detector bank found.
--
-- WHY THIS EXISTS.
--
-- The bank has run in production for 91 reviews and kept nothing. Findings and
-- gaps were computed, returned on the HTTP response, rendered once on a card,
-- and discarded. So the question that decides whether a detector deserves to
-- exist — "does it ever fire, and on what?" — was unanswerable from data and
-- could only be argued from memory.
--
-- That is the same failure this codebase has now made repeatedly: act_move_event
-- existed for a day short of a week holding zero rows; detection.outcomes was
-- computed from the day the bank was built and read by nobody. A thing that is
-- not recorded cannot be evaluated, and a detector that cannot be evaluated
-- will be kept or dropped on taste.
--
-- WHAT THIS IS NOT. Not authority. A finding row cannot produce a claim state:
-- `claim.state` is written only by the deterministic pipeline through
-- assignState(), and nothing here is read by it. This table is a LEDGER, in the
-- same sense usage_event is a ledger — written after the fact, read by humans
-- and queries, never by the verification path.

CREATE TABLE finding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  review_id uuid NOT NULL REFERENCES review(id) ON DELETE CASCADE,

  -- claim_ref, deliberately TEXT and deliberately not a foreign key.
  --
  -- The bank runs on the zero-claim path too, where no claim row exists and the
  -- connector passes a synthetic "ordinal-N" identifier. A uuid FK would either
  -- reject those rows or force the bank to stop reporting on the ~37% of
  -- answers that have no claims — which is exactly the population Act exists
  -- for. Integrity is traded for coverage here, knowingly.
  claim_ref text,

  -- Which detector, and which generation of it. A finding is immutable; its
  -- detector is not, so a row read months later must say which version produced
  -- it or it cannot be compared against anything.
  detector         text NOT NULL,
  detector_version text NOT NULL,
  type             text NOT NULL,

  -- The two halves of "why does Notary believe this", kept separate because
  -- they vary independently (detect/types.ts). `owner` is how it was concluded;
  -- `input_provenance` is who vouched for the input. A deterministic comparison
  -- over model-reported material is not independent evidence, and collapsing
  -- these two columns into one would assert that it is.
  owner            text NOT NULL,
  input_provenance text NOT NULL,

  -- boundary_text is the one sentence shown to a user and handed to Act.
  -- field_deltas is the structured disagreement — what lets a reader tell a
  -- wrong period from a wrong entity from a wrong number.
  --
  -- There is deliberately NO verdict, confidence, score or state column. A
  -- detector that wanted to assign a verification state would have nowhere to
  -- put it, which is the same absence Finding itself enforces in TypeScript.
  boundary_text text NOT NULL,
  field_deltas  jsonb NOT NULL DEFAULT '[]'::jsonb,
  basis         jsonb,
  rank          integer NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX finding_review_id_idx ON finding (review_id);
-- The measurement query this table exists for: fire rate per detector over
-- time. Indexed because it is the only query anyone will run repeatedly.
CREATE INDEX finding_detector_created_at_idx ON finding (detector, created_at);

-- ---------------------------------------------------------------------------
-- gap — the other half of the bank's output, and a separate table on purpose.
-- ---------------------------------------------------------------------------
--
-- A gap is not a weak finding. A finding says something is wrong; a gap says a
-- check could not run and names what would fix it. Storing them together would
-- mean the only difference between "this claim is contradicted" and "we had
-- nothing to check this against" is a discriminator column — one careless
-- SELECT away from a missing input being counted as a defect. The same
-- reasoning migration 0012 used for keeping challenge_item out of
-- evidence_match.
CREATE TABLE gap (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES review(id) ON DELETE CASCADE,
  claim_ref text,
  detector  text NOT NULL,
  missing   text NOT NULL,
  unblocks  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gap_review_id_idx ON gap (review_id);
CREATE INDEX gap_missing_created_at_idx ON gap (missing, created_at);
