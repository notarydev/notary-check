-- Notary Check engine — Phase 1 build-order step 5 (auth, quotas, retention,
-- observability, kill switch). Two new tables:
--   organization_api_key — real service-to-service auth, replacing step 1's
--     `x-notary-organization-id` header stub.
--   usage_event — the UsageEvent from § Core data model, feeding quotas and
--     spend caps.
-- Plus the smallest possible "user" stub (id + organization_id only) so
-- usage_event.user_id can be a REAL foreign key, matching how 0001 introduced
-- minimal Organization/Review stubs for FK integrity. No auth/OIDC for a
-- human-facing login is built here — that is explicitly deferred (it is a
-- vendor decision: Auth0/Clerk/WorkOS/custom).

-- Minimal user stub. Same rationale as the organization/review stubs in 0001:
-- the full User model (auth_subject, role, ...) is later, separate work.
-- `user` is a reserved keyword, hence the quotes — required in Postgres.
CREATE TABLE "user" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id)
);

-- organization_api_key(id, organization_id, key_hash, key_prefix, created_at,
--   revoked_at)
--
-- key_hash: the full key is NEVER stored in plaintext. Only a SHA-256 hex
-- digest of the key is persisted, so a database leak does not leak usable
-- credentials (the key itself is high-entropy, so a digest is not rainbow-
-- table-attackable the way a low-entropy password would be). Verification
-- hashes the presented key and looks that digest up.
--
-- key_prefix: a short, non-secret prefix (e.g. "nk_live_a1b2c3d4") stored in
-- plaintext so a key can be identified in logs / support triage WITHOUT
-- exposing the secret itself. Logs must never carry the full key.
--
-- revoked_at: NULL while the key is live. A key with revoked_at set must stop
-- working IMMEDIATELY (a revocation write is a hard fail for that key, never a
-- silent pass).
CREATE TABLE organization_api_key (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  key_hash        text NOT NULL UNIQUE,
  key_prefix      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

CREATE INDEX organization_api_key_organization_id_idx ON organization_api_key (organization_id);

-- UsageEvent(id, organization_id, user_id, review_id, event_type,
--            input_tokens, output_tokens, fetch_bytes, estimated_cost_cents)
-- exactly per § Core data model. Row per billable unit of work (a judge call,
-- a source fetch, ...); organization_id is the scope for every quota/spend
-- query. estimated_cost_cents is a derived estimate computed at write time from
-- the provider's published prices.
CREATE TABLE usage_event (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organization(id),
  user_id              uuid REFERENCES "user"(id),
  review_id            uuid REFERENCES review(id),
  event_type           text NOT NULL,
  input_tokens         integer NOT NULL DEFAULT 0,
  output_tokens        integer NOT NULL DEFAULT 0,
  fetch_bytes          bigint NOT NULL DEFAULT 0,
  estimated_cost_cents integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Supports the calendar-month per-org sum and the global spend-cap sum.
CREATE INDEX usage_event_organization_id_created_at_idx ON usage_event (organization_id, created_at);
CREATE INDEX usage_event_created_at_idx ON usage_event (created_at);

-- Honest-deletion support (§ Security, privacy, and reliability requirements:
-- "after payload deletion, a record becomes unable to re-resolve"). 0001's
-- CHECK required submitted_url OR payload_ref OR payload_hash to be present.
-- That was correct for a live source, but it would REJECT the honest deletion
-- of an inline-payload-only row (payload_hash nulled, no URL): revocation makes
-- "no resolvable content" legal. The rewritten constraint permits a contentless
-- row exactly when access_revoked_at is set — revocation is the one legitimate
-- way for a row to become unresolvable, and it must not be able to do so
-- silently by violating the old CHECK.
ALTER TABLE evidence DROP CONSTRAINT evidence_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_resolvable_unless_revoked CHECK (
  access_revoked_at IS NOT NULL
  OR submitted_url IS NOT NULL
  OR payload_ref IS NOT NULL
  OR payload_hash IS NOT NULL
);
