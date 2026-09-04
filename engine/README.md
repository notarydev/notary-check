# Notary Check — engine

> This file covers `engine/` only. See [`../docs/README.md`](../docs/README.md)
> for the doc structure and [`../docs/build/architecture-and-progress.md`](../docs/build/architecture-and-progress.md)
> for the current live-deployment snapshot (updated in the same commit as
> any infra change — check there before trusting anything below about what's
> deployed).

Started as source manifest binding plus an immutable locator/snapshot layer
(the `Evidence` table), then grew the deterministic verifier, adversarial
source ingestion, the constrained DeepSeek judge, and auth / quotas /
retention / observability / kill switch. **Also now includes**: Clerk-based
per-user organization resolution (`src/routes/internal.ts`, called by
`server/`'s `orgResolver.ts`), Stripe billing (`src/billing/`, currently
test-mode keys only — not live payment), and optional Datadog log shipping
(`src/observability/log.ts`, ships only if `DD_API_KEY` is set). Still
absent: a real payload/object store (`evidence.resolved_text` is a
documented stand-in), CI, and anything beyond the CHECK tier.

## What exists

- The `Evidence`, `Claim`, `EvidenceMatch`, `organization_api_key`, and
  `usage_event` tables (§ Core data model), plus minimal
  `Organization`/`Review`/`User` stubs purely for referential integrity and
  organization scoping.
- Raw SQL migrations in `migrations/` run by a minimal runner (the `pg`
  package, no ORM).
- HTTP endpoints: `POST /v1/evidence` (registers a source into the
  manifest — accepts `submitted_url`, `payload_ref`, and/or an inline
  `payload`; does not fetch or parse anything), `POST /v1/reviews`,
  `GET /v1/reviews/:id/claims`, `POST /v1/extract-claims`,
  `POST /v1/billing/*` (Stripe checkout + webhook), and
  `POST /v1/internal/resolve-organization` (Clerk-user-id → API key,
  gated by a shared `X-Internal-Secret`, called only by `server/`).
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

## What does NOT exist here

- No per-glyph PDF geometry. Corrected 2026-09-03: HTML and PDF parsing
  DO exist (`src/ingestion/parsePdf.ts`, with `parsePdf.test.ts` and
  `hostilePdf.test.ts`), and migration `0011` added `parse_status`,
  `page_ranges`, and `canonical_text_hash`. A character offset maps
  deterministically to exactly one page. What does not exist is a
  bounding-box locator — the text API exposes no glyph geometry, so an
  (x, y, w, h) rectangle is not derivable and is deliberately not faked.
- No producer for structured (JSON) evidence. `locators.ts`'s `json_path`
  kind is real and tested, but the ingestion MIME allowlist admits HTML
  and PDF only, so it is deliberately unwired.
- No real payload/object store — `evidence.resolved_text` (migration 0006)
  is a deliberate, narrow stand-in for what should eventually be an
  S3-equivalent store.
- No CI.
- No held-out, adjudicated evaluation gate — `engine/eval/` holds 20 draft
  cases, each explicitly marked not yet independently annotated (see
  `engine/eval/SCHEMA.md`). No real pass/fail number exists yet for the
  actual release gate.
- No corrections/revision flow beyond full claim resubmission.

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
