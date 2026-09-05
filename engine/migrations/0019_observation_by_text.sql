-- Notary Check engine — key the judge's observations on the TEXT, not the row.
--
-- WHY THIS CHANGES ONE DAY AFTER 0018.
--
-- 0018 keyed evidence_field_observation on evidence_id. That makes the cache
-- work within one review and useless across reviews — and across reviews is
-- exactly where the cost is.
--
-- Measured in production: Claude invoked Notary three times in two minutes on
-- one answer. It is designed to: Notary reports a gap, Claude fetches the
-- source it named, and calls again. Each invocation creates NEW evidence rows
-- for the same URLs, so every one got a fresh evidence_id and every lookup
-- missed. In a 40-minute window there were 24 evidence rows carrying only 15
-- distinct texts — nine documents re-read and re-judged from scratch.
--
-- WHY THE TEXT IS THE RIGHT KEY, and strictly better than the row.
--
-- extractField() is asked "what does this text say about <field>". It never
-- receives the claim, and it never receives the evidence id either — only the
-- text. Two rows holding byte-identical canonical text are therefore the same
-- question with the same answer, whoever registered them and whenever. Keying
-- on the row was an accident of implementation; keying on the content is what
-- the function actually depends on.
--
-- Staleness still cannot happen: the key IS the content hash, so text that
-- changes produces a different key rather than a stale hit.

DELETE FROM evidence_field_observation;

ALTER TABLE evidence_field_observation
  ADD COLUMN canonical_text_hash text;

-- evidence_id stays, nullable, for provenance only — it records which row first
-- produced the observation. It is no longer part of the identity, and nothing
-- reads it on the lookup path.
ALTER TABLE evidence_field_observation
  ALTER COLUMN evidence_id DROP NOT NULL;

ALTER TABLE evidence_field_observation
  ALTER COLUMN canonical_text_hash SET NOT NULL;

DROP INDEX IF EXISTS evidence_field_observation_key_idx;

CREATE UNIQUE INDEX evidence_field_observation_key_idx
  ON evidence_field_observation (canonical_text_hash, field, prompt_version, model);
