-- Notary Check engine — Phase 1 build-order step 2.
-- Claim + EvidenceMatch, exactly per § Core data model. Schema only, matching
-- step 1's schema-first pattern: nothing reads or writes these tables in this
-- step. The pure deterministic modules added here (applicability + state
-- machine) operate on in-memory TypeScript types; the code that populates
-- these tables is later build-order work (extraction, resolution, the judge).

-- Claim(id, review_id, ordinal, text, decontextualized_form, materiality,
--       state, no_source, state_reason, policy_version)
CREATE TABLE claim (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id             uuid NOT NULL REFERENCES review(id),
  ordinal               integer NOT NULL,
  text                  text NOT NULL,
  decontextualized_form text,
  materiality           boolean NOT NULL DEFAULT false,
  -- CHECK-tier states only. CONFLICTED / ATTESTED are CAPTURE-tier (§
  -- Verification pipeline step 8) and are intentionally not allowed here;
  -- a later migration extends this when CAPTURE is built.
  state                 text NOT NULL DEFAULT 'INDETERMINATE'
                          CHECK (state IN ('SUPPORTED', 'CONTRADICTED', 'UNSUPPORTED', 'INDETERMINATE')),
  no_source             boolean NOT NULL DEFAULT false,
  state_reason          text,
  -- Written by the deterministic verifier's versioned policy library
  -- (§ Architecture, Deterministic verifier row), never defaulted here.
  policy_version        text NOT NULL
);

CREATE INDEX claim_review_id_idx ON claim (review_id);

-- EvidenceMatch(id, claim_id, evidence_id, locator, resolved_text_hash,
--               excerpt_ref, applicability_json, relation, method,
--               evaluator_version, evaluated_at)
CREATE TABLE evidence_match (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id           uuid NOT NULL REFERENCES claim(id),
  evidence_id        uuid NOT NULL REFERENCES evidence(id),
  -- Every candidate must resolve to exact displayed text or structured value
  -- in the preserved evidence (§ Verification pipeline step 5).
  locator            text NOT NULL,
  resolved_text_hash text NOT NULL,
  excerpt_ref        text,
  -- The serialized ApplicabilityResult from the deterministic comparator.
  applicability_json jsonb NOT NULL,
  -- Only supports/contradicts in this CHECK-tier build. CONFLICTED is
  -- CAPTURE-tier only and intentionally absent here, same rationale as the
  -- Claim.state constraint above.
  relation           text NOT NULL CHECK (relation IN ('supports', 'contradicts')),
  -- § Product contract: a resolved match is either an exact
  -- quotation/computation or a bounded semantic call by the judge.
  method             text NOT NULL CHECK (method IN ('quoted_or_computed', 'entailed')),
  evaluator_version  text NOT NULL,
  evaluated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX evidence_match_claim_id_idx ON evidence_match (claim_id);
