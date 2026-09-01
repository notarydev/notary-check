# Notary Check — engine

This is **Phase 1 build-order step 1 only**: source manifest binding plus an
immutable locator/snapshot layer (§ Verification pipeline, step 1; the
`Evidence` table in § Core data model). It is deliberately narrow. Everything
else the engine will eventually do — safe source fetching, parsing,
deterministic verification, the judge, the state machine, real auth, quotas,
retention/deletion, billing — is **later, separate work** and is not stubbed or
pretended at here.

## What exists in this step

- The `Evidence` table (exactly the fields from § Core data model), plus the
  smallest possible `Organization` and `Review` stubs purely for referential
  integrity and organization scoping.
- Raw SQL migrations in `migrations/` run by a minimal runner (the `pg`
  package, no ORM).
- One HTTP endpoint: `POST /v1/evidence` — registers a new source into the
  manifest by creating an `Evidence` row. It accepts a `submitted_url`, a
  `payload_ref`, and/or an inline `payload`. It does **not** fetch or parse
  anything.

## What does NOT exist here (by design — later build-order steps)

- No source fetching, URL resolution, or payload preservation (step 3).
- No parsing of HTML/PDF/excerpts, no canonical text extraction.
- No deterministic verifier, no claim-field checks, no state machine (step 2).
- No judge, no model calls at all (step 4).
- No auth — the organization identity is taken from the `x-notary-organization-id`
  request header as an explicit stub, cross-checked against the review's real
  organization. Real authentication is build-order step 5 and will replace the
  header.

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
fixed ids so the endpoint is exercisable before review creation exists (a later
step). Use org header `x-notary-organization-id:
00000000-0000-4000-8000-000000000001` with `review_id:
00000000-0000-4000-8000-000000000002` for local testing.

## API

`POST /v1/evidence`

Headers:

- `x-notary-organization-id: <uuid>` (required; stub until real auth)

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
