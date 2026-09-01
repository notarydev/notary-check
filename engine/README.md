# Notary Check — engine

This is the **Phase 1 build-order engine** (steps 1–5). It started as source
manifest binding plus an immutable locator/snapshot layer (§ Verification
pipeline, step 1; the `Evidence` table in § Core data model) and has since
grown the deterministic verifier (step 2), adversarial source ingestion (step
3), the constrained DeepSeek judge (step 4), and auth / quotas / retention /
observability / kill switch (step 5). Still deliberately absent: billing,
OAuth/OIDC for a human-facing dashboard login, a metrics/alerting platform, and
anything beyond the CHECK tier.

## What exists

- The `Evidence`, `Claim`, `EvidenceMatch`, `organization_api_key`, and
  `usage_event` tables (§ Core data model), plus minimal
  `Organization`/`Review`/`User` stubs purely for referential integrity and
  organization scoping.
- Raw SQL migrations in `migrations/` run by a minimal runner (the `pg`
  package, no ORM).
- One HTTP endpoint: `POST /v1/evidence` — registers a new source into the
  manifest by creating an `Evidence` row. It accepts a `submitted_url`, a
  `payload_ref`, and/or an inline `payload`. It does **not** fetch or parse
  anything.
- Real service-to-service auth: `Authorization: Bearer <api-key>`, verified
  against the `organization_api_key` table (build-order step 5). The key is
  stored only as a SHA-256 hash plus a non-secret `nk_live_*` prefix; the
  plaintext is returned once at issue time.
- Quota enforcement (`src/quotas/`): per-org monthly spend limit and a hard
  global DeepSeek spend cap, both configurable via env and defaulting sanely.
- Honest payload deletion (`src/evidence/deleteEvidence.ts`): nulls
  `payload_ref`/`payload_hash` and sets `access_revoked_at` without hard-deleting
  history.
- A kill switch (`src/judge/killSwitch.ts`) that disables the judge path so
  `extractField` returns `cannot_be_determined` without any network call.
- Structured JSON logging (`src/observability/log.ts`) wired into the evidence
  route and the judge call site.

## What does NOT exist here (by design — later build-order work)

- No parsing of HTML/PDF/excerpts, no canonical text extraction beyond
  ingestion fencing.
- No OAuth/OIDC for a human-facing login (a vendor decision — Auth0/Clerk/
  WorkOS/custom — not something to guess) and no metrics/alerting platform
  (Datadog/Grafana/... — also a vendor choice). Structured logs are emitted as
  JSON lines a real platform could later ingest.
- No user-facing review orchestration, corrections, or billing.

## Scope discipline

Records are append-only: a later fetch of the same URL must create a **new**
`Evidence` row, never update an existing one (§ Security, privacy, and
reliability requirements). When an inline payload is supplied, it is hashed
(SHA-256) and only the hash is recorded; the raw bytes are not persisted here.
This step adds nothing beyond the evidence manifest binding.

## Requirements

- Node.js 20+ and npm.
- A Postgres instance and a connection string.

## Setup

```bash
cd engine
npm install
cp .env.example .env        # then set DATABASE_URL
npm run migrate             # applies engine/migrations/*.sql in order
npm start                   # Express API on http://localhost:4001
```

`migrations/0002_seed_dev.sql` seeds one demo organization and one review with
fixed ids so the endpoint is exercisable before review creation exists. Use
`review_id: 00000000-0000-4000-8000-000000000002` for local testing, with an API
key issued for the demo org (see below).

## API

`POST /v1/evidence`

Headers:

- `Authorization: Bearer <api-key>` (required). Keys are issued via
  `issueApiKey()` in `engine/src/auth/apiKey.ts` (there is no key-issuing
  endpoint yet — it's a library function; a future org-admin flow will call
  it). The organization is derived from the key; the old
  `x-notary-organization-id` header stub is gone.

Body (JSON; at least one of `submitted_url` / `payload_ref` / `payload` is
required):

```json
{
  "review_id": "00000000-0000-4000-8000-000000000002",
  "origin": "answer_citation",
  "submitted_url": "https://example.com/report.pdf",
  "submitted_by": "claude",
  "snapshot_reuse_policy": "reuse"
}
```

If an inline `payload` is supplied it is hashed and the row is marked
`retrieved`; otherwise `payload_hash` is null and `retrieval_status` is
`pending`.

## Commands

- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — `tsc` (emits `dist/`)
- `npm run migrate` — apply pending migrations
- `npm start` — run the API with `tsx`
- `npm test` — the full suite. The auth / quota / retention / evidence-route
  tests hit a REAL Postgres and skip cleanly when none is configured; point them
  at one via `TEST_DATABASE_URL` (or `DATABASE_URL`), e.g.
  `TEST_DATABASE_URL=postgres://... npm test`. The mocked judge tests and the
  kill-switch test never need a database.
