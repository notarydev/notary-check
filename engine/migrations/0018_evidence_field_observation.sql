-- Notary Check engine — cache the judge's reading of a SOURCE.
--
-- WHY THIS IS SOUND, AND WHY IT IS NOT A CACHE OF A VERDICT.
--
-- extractField() takes the evidence text and a field name. It does NOT take the
-- claim — the judge is deliberately blind to what is being asserted, which is
-- the property that stops it agreeing with a claim it has been shown. That
-- blindness has a consequence nobody had used: the judge's answer is a fact
-- about the SOURCE, identical for every claim ever checked against it.
--
-- Measured on a real answer: 21 claims x 5 sources produced 270 judge calls,
-- but there are only 5 sources x ~7 fields = ~35 DISTINCT questions. Everything
-- else was the same question asked again, at full price and full latency, while
-- the user waited.
--
-- WHAT IS CACHED IS AN OBSERVATION, NEVER A DECISION. No state, no relation and
-- no applicability result is stored here — all of those depend on the claim and
-- are recomputed every time. This holds only "what does this source say about
-- <field>", which is exactly what the judge was asked.
--
-- STALENESS CANNOT HAPPEN. evidence_id is in the key, and an evidence row's
-- resolved_text is immutable once retrieved — it carries its own content hash
-- and is re-dereferenced against that text. A revoked source has its text
-- nulled and is excluded from new reviews, so its observations become
-- unreachable rather than wrong. prompt_version and model are in the key too,
-- so changing either invalidates every prior answer by construction rather than
-- by anyone remembering to clear something.

CREATE TABLE evidence_field_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  field       text NOT NULL,

  -- In the key, not merely recorded beside it: a different prompt or model is a
  -- different question, and reusing an answer across them would silently mix
  -- generations of the judge.
  prompt_version text NOT NULL,
  model          text NOT NULL,

  outcome     text NOT NULL CHECK (outcome IN ('present', 'absent', 'ambiguous', 'cannot_be_determined')),
  value       text,
  source_span text,
  -- Candidate readings when the outcome was 'ambiguous'. immaterialAmbiguity.ts
  -- needs these to decide whether an ambiguity could change the verdict, so a
  -- replayed answer without them would behave differently from a fresh one.
  candidates  jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- The lookup, and the uniqueness that makes a second identical call impossible
-- rather than merely unlikely.
CREATE UNIQUE INDEX evidence_field_observation_key_idx
  ON evidence_field_observation (evidence_id, field, prompt_version, model);
