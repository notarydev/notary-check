> Status: snapshot
> Owner: Hardyk
> Last verified: 2026-09-03 (live production deploy — audit fixes + Clerk auth + Advance wiring; see "2026-09-03 deploy" section below)
> Supersedes: —

# Notary Check — Architecture and infrastructure progress

*A factual snapshot of what's actually deployed and running, as of 2026-09-02. Every claim below is sourced to a real file, a live secret on disk, or a command run against the repo — not to a plan or a doc's stated intent. Where the repo's own docs contradict what's actually deployed, that's called out explicitly rather than silently resolved one way.*

## The headline gap this doc exists to close

**There is no accurate, up-to-date deployment/infra doc anywhere in this repo.** The only ground truth for what's actually live is gitignored `.env` files plus a couple of stray code comments. `README.md` only covers Phase 0 tunnel-based local testing; `HANDOFF.md` is a narrative build log, not a runbook, and doesn't mention AWS at all; `engine/README.md` predates the Clerk, billing, and Datadog work and actively contradicts current reality in two places. This doc is the first attempt at closing that gap — treat it as a snapshot to keep current, not a one-time artifact.

## Repo shape

Four real subprojects under `notary-check/`:

| Dir | What it is | Status |
|---|---|---|
| `engine/` | Node/TS/Express API on Postgres, no ORM (raw SQL migrations). The actual verification pipeline — claim extraction, evidence ingestion, applicability, judge, state machine, billing, quotas. | Most-built component, live and confirmed working end-to-end by direct testing (see "Live verification" below) — including DeepSeek and Tier A.5 normalization actually firing, not just configured. |
| `server/` | Thin MCP server (Express + MCP SDK + `ext-apps`), calls `engine/` over HTTP. | **Live at `mcp.getnotary.ai`, running the current build as of 2026-09-03** — Clerk OAuth is now gating both MCP POST routes (confirmed live: unauthenticated `POST /mcp` returns `401` with a real `WWW-Authenticate` challenge pointing at `clerk.getnotary.ai`). |
| `ui/` | React/Vite app, builds to one inlined HTML file served as the MCP App resource. | Live, minimal — just the card renderer. |
| `dashboard/` | Next.js 16 App Router app — landing page + `/account` billing page, Clerk auth. | This checkout's `dashboard/` has never been confirmed live anywhere. **A live, polished marketing site exists at `getnotary.ai`** (real copy, real title, Cloudflare-fronted) that does not match this checkout's code at all (this checkout's `layout.tsx` still had the unedited `create-next-app` title before this session's edits) — status of that site relative to this repo is unresolved, flagged as stale/needs-update by the product owner, not yet investigated further. |

## Infrastructure, service by service

### Compute — AWS Lightsail (live), Cloudflare Container (scaffolded, not evidenced as ever deployed)

The engine is live on **AWS Lightsail Container Service**, region `us-east-2` — confirmed only by the gitignored `server/.env`'s `ENGINE_URL`, pointing at a `*.cs.amazonlightsail.com` address, and corroborated by a code comment in `engine/src/observability/log.ts` referencing "Lightsail's own container logs." **This is nowhere documented** — no README, no HANDOFF entry, nothing — it only exists as a fact on disk.

~~There's a real contradiction sitting in the repo: `engine/wrangler.jsonc`, `engine/worker/container.ts`, and a `@cloudflare/containers` dependency scaffold a Cloudflare Container deployment path instead.~~ **Deleted 2026-09-03.** All three were removed after confirming `@cloudflare/containers` was imported nowhere in `engine/src` or `server/src`. Cloudflare was evaluated or partially built out; Lightsail is what actually shipped, and there is no longer a scaffold to mistake for a live option.

**Corrected 2026-09-02, superseded 2026-09-03**: the `server/` MCP layer's deployment target IS established — it's live and reachable at `https://mcp.getnotary.ai/`, DNS-confirmed pointing at a Lightsail container endpoint. **As of 2026-09-03, the live deployment is the current build**, redeployed as image `:notary-check-mcp.server.10` (Lightsail deployment version 7). Clerk OAuth is now live: `.well-known/oauth-protected-resource/mcp` resolves and points at `clerk.getnotary.ai`; an unauthenticated `POST /mcp` returns `401` with a real `WWW-Authenticate` challenge. `INTERNAL_SERVICE_SECRET` and live Clerk keys (`CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY`) are now set on this container service's env — previously absent. Do not assume this stays in sync automatically — verify against the live endpoint again after any future deploy.

### Database — plain Postgres, not Neon

**Where production actually points — resolved 2026-09-03, previously unrecorded and unknowable from this repo** (closes the long-standing "record what `DATABASE_URL` resolves to" action). Read directly off the `notary-check-api` container service's live environment:

```
postgres://<user>:<password>@3.147.139.53:5432/notary_check?sslmode=require&uselibpqcompat=true
```

A standalone Postgres on a Lightsail instance at `3.147.139.53`, database `notary_check`, TLS required. **Not** Lightsail managed Postgres, not RDS, not a co-located container. Credentials live only in the container service environment and are deliberately not recorded here. `uselibpqcompat=true` is a driver-compatibility flag, not a security setting.

Practical consequence worth knowing before the next migration run: this is a single instance with no documented backup schedule beyond the manual `pg_dump` taken before the `0007`–`0013` run. Take a verified dump before every migration.

No ORM — raw SQL migrations (`engine/migrations/0001`–`0015`) run by a minimal custom runner (`engine/src/migrate.ts`), using the plain `pg` package.

**Applied to production: `0001`–`0015`, all of them.** `0007`–`0013` ran on 2026-09-03; `0014`–`0015` ran later the same day (see the deploy record below). Migration `0013_advance.sql` adds `advance_invocation`/`advance_suggestion`/`advance_event` for the Advance (Track 2 v2) feature — see "2026-09-03 deploy" below. **Neon is not used** — the only mention of it anywhere in the repo is a pricing-comparison footnote in `docs/build/tier-1-build-and-operating-plan.md`, alongside Vercel/R2/DeepSeek pricing citations, not a decision record. The checked-in local-dev `DATABASE_URL` points at `localhost:5432`; production's is recorded at the top of this section.

**Schema, as it stands** (all raw SQL, no schema file to point to instead):
- `organization` — plus `plan`, `stripe_customer_id`, `stripe_subscription_id` (migration 0005), `clerk_user_id` (0007). Still has **no `created_at` column** — `GET /v1/organization` (below) returns `created_at: null` rather than inventing one.
- `review` — plus `idempotency_key`, `status`, timestamps (0006); plus `review_organization_id_created_at_idx` on `(organization_id, created_at)` (0008), supporting keyset pagination for `GET /v1/reviews`.
- `evidence` — plus `resolved_text` (0006), which migration 0006's own comment documents as a **deliberate, narrow stand-in for a real object/payload store (S3-equivalent) that doesn't exist yet**; plus `created_at` and `evidence_created_at_idx` (0008) — `evidence` had no timestamp column at all before this, so no correct paginated listing was possible until now. Migration 0011 adds `content_kind`, `text_provenance` (`fetched` vs `caller_supplied`), `canonical_text_hash`, `parse_status`, `parse_error`, and `page_ranges`, and extends the `retrieval_status` CHECK with `revoked`. The load-bearing distinction: `retrieval_status` answers "did the bytes arrive", `parse_status` answers "is there readable, locatable content", and only the second licenses a completed check — conflating them was what turned an unreadable PDF into `UNSUPPORTED` instead of `INDETERMINATE`.
- `evidence_match` — plus `locator_json`, `locator_resolved`, `locator_resolved_at`, `payload_revoked_at` (0011). `locator_json` holds the real coordinate (`engine/src/evidence/locators.ts`); the pre-existing `locator` text column is now a human-readable label only. `locator_resolved` records that the locator was actually **re-dereferenced** against the retained canonical text at state-assignment time, not merely computed once at write time.
- `claim` — plus `lifecycle_state` / `lifecycle_detail` (0011): WHERE a claim got to in the pipeline, kept strictly orthogonal to `state` (WHAT the evidence showed). Only `lifecycle_state = 'completed'` licenses a caller to read `state` as a finding about the world. `claim.state` is still assigned by `verification/stateMachine.ts` and by nothing else.
- `claim`, `evidence_match` (0003); `claim` plus `created_at` and `claim_review_id_created_at_idx` on `(review_id, created_at)` (0008) — also backs `GET /v1/usage`'s "checks this calendar month" count.
- `"user"` (0004) — minimal stub, just id + organization_id
- `organization_api_key`, `usage_event` (0004); plus `usage_event.estimated_cost_millicents` (0015) — the *enforcing* cost unit, with `estimated_cost_cents` converted to a `GENERATED ALWAYS` column derived from it. Writing cents directly is now a hard Postgres error, which is what prevents a caller from silently under-metering by setting only the rounded value.
- `organization.advance_enabled` (0014) — Advance's own feature flag, `DEFAULT false` (ship dark) with a backfill to `true` so orgs that already had Advance running keep it.

Migration 0008 backfilled `claim.created_at` / `evidence.created_at` to `now()` (the migration's apply time) for every pre-existing row, since neither column ever existed before — an approximation, not a real historical timestamp, for anything created earlier.

### Dashboard read endpoints (engine/, new)

Org-scoped, read-only endpoints added for the SaaS dashboard (`dashboard/`, built separately) to consume — review history, an evidence library, usage/quota, plan info, and API-key management. All follow the same `Authorization: Bearer <api-key>` → `verifyApiKey()` → org-derived-from-key pattern as every other engine route; none of them write `claim.state` or touch the verification pipeline.

- `GET /v1/reviews` — org-scoped review history, keyset-paginated on `(created_at DESC, id DESC)`, optional `status` filter, base64 `(created_at, id)` cursor.
- `GET /v1/reviews/:id` — one review plus its claims (by `ordinal`) plus each claim's `evidence_match` rows joined to `evidence`. 404 (not 403) cross-org.
- `GET /v1/evidence` — org-scoped evidence library (via `JOIN review`), same keyset pagination, deliberately excludes `resolved_text`.
- `POST /v1/extract-claims` — since the 0011 pass, a failure is **never** a 200 with an empty claim list: a quota denial is `429` and a provider/parse failure is `502`, and neither response carries a `claims` key at all. A successful extraction of zero claims stays `200` with `extraction_status: "ok"` — that is a real finding and must remain one.
- `GET /v1/usage` — `{plan_id, checks_used_this_month, checks_limit, cost_cents_this_month, org_monthly_limit_cents}`, reusing `quotas/quotaCheck.ts` and `billing/plans.ts`.
- `GET /v1/organization` — `{plan_id, plan_name, checks_per_month, price_cents, has_payment_method, created_at}`; `has_payment_method` derives from `stripe_customer_id IS NOT NULL`, never exposing the raw Stripe id.
- `GET /v1/api-keys`, `POST /v1/api-keys`, `DELETE /v1/api-keys/:id` — list/issue/revoke, thin wrappers around `auth/apiKey.ts`'s `listApiKeys`/`issueApiKey`/`revokeApiKey`. The org-ownership check for `DELETE` lives in the route (`revokeApiKey` itself takes a bare key id with no org check) — idempotent on double-revoke, 404 (not leaking existence) cross-org.

### Public signup gate (engine + dashboard, new)

The canonical build plan (`docs/build/tier-1-build-and-operating-plan.md`) blocks public self-serve signup/payment until the held-out eval gate passes — it hasn't (see "Held-out eval set" below). The dashboard's public sign-up is gated by two independent layers, both required:

1. **App-level (soft, flippable via env var)**: `dashboard`'s landing page reads `NOTARY_SIGNUP_MODE` (default, and anything other than exactly `"open"`, means `"waitlist"`) — in `"waitlist"` mode it renders an email-capture form (`WaitlistForm` -> `joinWaitlist` server action -> `POST /v1/waitlist`) instead of Clerk's sign-up flow. Sign-in remains available in either mode -- this only gates *new* account creation.
2. **IdP-level (hard, not app code)**: Clerk's own Restricted sign-up mode should be enabled on the production Clerk instance so account creation is refused at the identity-provider level even if the app-level gate is bypassed. **Not yet confirmed set** -- this is a manual Clerk-dashboard action, not verifiable from this repo.

`POST /v1/waitlist` (`engine/src/routes/waitlist.ts`, migration `0009_waitlist.sql`) is the one engine route deliberately open to the public internet with no credential -- no org exists yet to scope a request to. Upsert-by-email (`ON CONFLICT (email) DO NOTHING`), always 201 on a syntactically valid email so a repeat submission can't be used to probe list membership. A simple in-process per-IP token-bucket rate limit (5 requests/60s, resets on process restart -- same "simple and sufficient for a single instance" tradeoff as `server/src/orgResolver.ts`'s in-memory cache) is the only abuse resistance; revisit if this ever needs to survive multiple engine instances behind a load balancer. `waitlist_signup` rows are approved manually (an ops action sets `invited_at` and sends a real Clerk invitation) -- there is no automation from a waitlist row to an actual Clerk invite in v1.

### Auth — Clerk, two separate integrations, both real

1. **`server/src/server.ts`** — `@clerk/express` + `@clerk/mcp-tools/express`. Both MCP POST routes (`/` and `/mcp`) gated by `mcpAuthClerk`; OAuth discovery routes wired (`/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`).
2. **`server/src/orgResolver.ts`** — resolves a Clerk user id to an engine API key via `POST {ENGINE_URL}/v1/internal/resolve-organization`, authenticated with a shared `X-Internal-Secret` header, compared via `timingSafeEqual`. In-memory cache, process lifetime only.
3. **`dashboard/`** — separate `@clerk/nextjs` wiring: sign-in/sign-up/account page (`dashboard/src/app/page.tsx`, `dashboard/src/app/account/page.tsx`). The gitignored `dashboard/.env.local` holds **live** (`pk_live_`/`sk_live_`) keys, on a custom Frontend API domain `clerk.getnotary.ai` — per `HANDOFF.md`, added manually via Cloudflare DNS, but not independently confirmable from any committed config.

~~`engine/README.md` still says "No OAuth/OIDC for a human-facing login"~~ — **corrected 2026-09-03: this callout was itself stale.** `engine/README.md` was updated on 2026-09-02 and now documents Clerk, Stripe (test-mode), and optional Datadog; neither the OAuth nor the metrics claim remains in it. Verified by reading the file, not assumed.

The static `ENGINE_API_KEY` fallback in `server/.env.example` is documented as exactly that — a manual-testing fallback for when no per-user Clerk-resolved key is available, not the primary path.

### Billing — Stripe, test mode only

Checkout + webhook handling lives in `engine/src/billing/`; the billing UI is `dashboard/src/app/account/page.tsx`, not a separate top-level dir. Keys in `engine/.env` are `sk_test_`/`pk_test_` — **not live**. This is the one area where "configured" and "actually taking real payment" are clearly different states; don't describe billing as production-ready without a live-mode key swap and a real webhook endpoint check first.

### Observability — Datadog, wired but unconfirmed live

`engine/src/observability/log.ts` always writes structured JSON to stdout, and separately does a bare `fetch` POST to Datadog's log intake endpoint — but only if `DD_API_KEY` is set, which it is not in any committed `.env`/`.env.example`. The code path is real, correctly fire-and-forget (a Datadog outage can't affect a request). `DD_API_KEY` was checked directly against the live AWS Lightsail container service configuration on 2026-09-02 and **is confirmed set** (32 chars) on the `notary-check-api` container service — so whether data is actually flowing is no longer unverifiable from this repo alone, it's a confirmed-live setting (whether Datadog is actually receiving/ingesting it is a separate question, not checked here). (An earlier version of this paragraph said `engine/README.md` still lists "a metrics/alerting platform" under "what does NOT exist" — **that was wrong as of 2026-09-02**, when that file was updated. Corrected 2026-09-03.)

Both live AWS Lightsail container services, region `us-east-2`, both currently `RUNNING`: `notary-check-api` (the engine) and `notary-check-mcp` (`server/`, the MCP layer). Naming them here so this isn't undiscoverable from the repo — previously this required querying Lightsail directly.

### Domains

| Domain | Evidence | What it is |
|---|---|---|
| `api.getnotary.ai` | Live `dig`, 2026-09-03 (CNAME → `notary-check-api...cs.amazonlightsail.com`, `3.129.182.157`) | **Confirmed live** — the friendly alias for the engine. `PROGRESS.md` referred to this before this table listed it; the table was incomplete, not `PROGRESS.md` wrong. |
| `notary-check-api.dht4me4ddy2y4.us-east-2.cs.amazonlightsail.com` | `server/.env` (live value) | The engine's underlying Lightsail endpoint, behind `api.getnotary.ai`. |
| `mcp.getnotary.ai` | Live `dig`/MCP protocol test, 2026-09-02 | **Confirmed live** — real MCP server, DNS-resolved to a Lightsail address, answers `initialize`/`tools/list`/`tools/call` correctly. Running an older, pre-Clerk-auth build (see "Repo shape" and "Live verification" above/below). |
| `getnotary.ai` | Live `curl`, 2026-09-02 | **Confirmed live** — a real, Cloudflare-fronted marketing site with actual copy, distinct from this checkout's `dashboard/`. Flagged by the product owner as older and needing an update; not yet reconciled with this repo. |
| `clerk.getnotary.ai` | Live `dig`, 2026-09-02 (CNAME resolves to Clerk's own frontend-api / Cloudflare) | **Confirmed live** — previously only described in `HANDOFF.md` prose, now independently verified. |
| `notarycheck.ai` | `dashboard/src/app/account/page.tsx` (`sales@notarycheck.ai` mailto) | Does not resolve (`dig` returned nothing, 2026-09-02) — this mailto address's domain is not live. |

## 2026-09-03 deploy — audit fixes, Clerk auth, and Advance now live

Both live Lightsail container services were redeployed with the current checkout's code:

- **`notary-check-api`** (engine): new image `:notary-check-api.engine.11`, deployment version 5. Ships all 5 audit-P0 fixes, the entitlement gate, live-mode-ready billing lifecycle, ops groundwork (rate limiting, backup/restore, kill-switch runbook) — all previously committed but not yet deployed — plus the new Advance wiring (below). `INTERNAL_SERVICE_SECRET` added to its env (previously unset, meaning `/v1/internal/resolve-organization` was failing closed).
- **`notary-check-mcp`** (server): new image `:notary-check-mcp.server.10`, deployment version 7. Clerk auth (`clerkMiddleware`, `mcpAuthClerk`) is now live-gating both MCP routes — confirmed via a real unauthenticated `POST /mcp` returning `401` with a working `WWW-Authenticate` challenge. `INTERNAL_SERVICE_SECRET` and live Clerk keys added to its env (previously absent).
- **Production database**: a `pg_dump` backup was taken and verified restorable (`pg_restore --list` confirmed real table data) immediately before running migrations. Migrations `0007`–`0013` were then applied via `engine/src/migrate.ts` against the live DB — each runs in its own transaction, all applied cleanly.
- **Advance (Track 2 v2) wired into the product for the first time**: previously an isolated, unwired module (`engine/src/advance/`). Now: new persistence tables (migration `0013`), the MCP tool schema accepts an optional `user_request` field (Advance is skipped, not guessed, when absent), Advance runs concurrently with Track 1 and Track 2/Challenge inside `reviewFlow.ts` — strictly after Track 1's result is committed, never gating or altering it — and is now kill-switch- and quota-gated (previously a known gap). The review response carries `advance_suggestions` separately from `challenges`; the UI renders it through the existing pill mechanism.
- **Verified post-deploy**: `GET /.well-known/oauth-protected-resource/mcp` resolves real Clerk metadata; unauthenticated `POST /mcp` gets a real `401`; an authenticated `POST /v1/reviews` against the live engine successfully created a real review row, confirming DB connectivity and the entitlement check both work post-migration.
- ~~**Not yet re-verified live**~~ — **done, same day.** A real Claude.ai session against the deployed connector produced a live end-to-end `tools/call` returning both a `CONTRADICTED` Track 1 finding and a real `advance_suggestions` payload. Advance is confirmed working through the deployed path, not only locally.

**Update, same day — real live testing surfaced and fixed three more issues**: a real Claude.ai session was connected against the live connector, requiring a fresh Clerk OAuth Application to be registered (Clerk has no dynamic client registration — a manually-registered client id/secret is required, now set up; see `docs/build/tier-1-build-and-operating-plan.md` for the exact client). Live testing then found: (1) a real transient `could_not_check` result on one call, root-caused by directly reproducing the same request against the live engine twice (extraction succeeded both times — a one-off DeepSeek hiccup, not a systematic bug) — also surfaced that Claude's own chat summary can misreport a `could_not_check` failure as a confident finding, worth a closer look separately; (2) a real UI layout bug — hovering a pill's revealed preview text forced a sibling pill onto a new flex-wrap row, which could shift the sibling under the cursor and produce a visible flicker, and a body with no width constraint let the iframe's offered width paint a blank rectangle beyond the actual card; (3) following that, the whole card was redesigned to a quiet, disclaimer-style treatment (modeled on Claude's own "Claude is AI and can make mistakes" footer) and wired to the host's real theme via `useHostStyles()` (`@modelcontextprotocol/ext-apps/react`) instead of a hardcoded white background, which had been rendering as a stark white box on Claude's dark theme — an iframe's rendering canvas has no transparent backdrop to fall back to, so the fix is an explicit `background: var(--color-background-primary, ...)`, not simply omitting a background. Redeployed as `:notary-check-mcp.server.13`.

**Current live images — verified directly against Lightsail, 2026-09-03, not inferred:**

| Service | Image | Deployment version | State |
|---|---|---|---|
| `notary-check-api` | `:notary-check-api.engine.11` | 5 | RUNNING |
| `notary-check-mcp` | `:notary-check-mcp.server.14` | 11 | RUNNING |

**Correction:** an earlier draft of this section claimed `.14` was built but never deployed and that `.13` was live. That was wrong — it was written from session recollection rather than from the API. `.14` is live. Always confirm with the command below rather than from memory; earlier the same day a failed `sed` did silently redeploy `.13` when `.14` was intended, which is where the mistaken belief came from.

```bash
aws lightsail get-container-services --region us-east-2 \
  --query 'containerServices[?contains(containerServiceName,`notary`)].{name:containerServiceName,image:currentDeployment.containers.*.image,ver:currentDeployment.version}'
```

## 2026-09-03, second deploy — Advance flag, sub-cent metering, and a self-inflicted outage

**What shipped:** migrations `0014` (Advance's org feature flag) and `0015` (millicent cost metering, with `estimated_cost_cents` converted to a `GENERATED ALWAYS` column), plus engine image `:notary-check-api.engine.15` — Lightsail deployment **version 6**, `notary-check-api`, RUNNING.

**Backup, genuinely verified before touching anything:** `~/notary-backups/notary-prod-20260903-223614.dump` (71K, `pg_dump -Fc` via `postgres:16-alpine` matching the server's 16.15). Verification was not `pg_restore --list` alone — the dump was restored into a throwaway Postgres and every row count compared against production: organization 2, review 75, claim 85, evidence 70, evidence_match 21, usage_event 228, advance_invocation 25. All matched. Both migrations were then dry-run against that restored copy before production, which is how the `GENERATED ALWAYS` conversion and the `advance_enabled` backfill were confirmed non-destructive.

**Gotcha for anyone scripting a backup:** production's `DATABASE_URL` carries `uselibpqcompat=true`, a node-driver flag. `pg_dump` rejects it outright (`invalid URI query parameter`). Strip it; keep `sslmode=require`.

**A real outage was caused and then closed — recorded because the reasoning error matters more than the fix.** Migrations were applied *before* the matching image was deployed. `0015` makes `estimated_cost_cents` unwritable, and the running image (`engine.11`) still wrote it, so every ledger insert raised a hard Postgres error. That was predicted as a harmless window on the reasoning that "quota gates already read zero, so nothing gets worse." **That reasoning was wrong**: `insertUsageEvent` is `await`ed bare inside `review/reviewFlow.ts`, not wrapped, so a rejected ledger write throws the whole review. For the duration, every judge-invoking review failed — not just its metering. The correct order is deploy-then-migrate, or split the migration so the destructive half lands after the new image. No users were affected (there are none yet).

**Post-deploy verification — an actual round trip, not schema introspection.** `engine/scripts/prod-smoke.ts` issues a throwaway API key, runs the flagship contradiction (claim 17% vs evidence 12%) against the live engine, and revokes the key. Result: `CONTRADICTED` / `contradicting_applicable_relation`, lifecycle `completed`, 1 resolved match, **1 Advance suggestion** (confirming the `advance_enabled` backfill left the existing org enabled), and **+53 millicents across 2 new ledger rows** — the first real cost this system has ever recorded. `engine/scripts/prod-check.ts` separately confirmed the schema: `estimated_cost_cents generated=ALWAYS`, `estimated_cost_millicents bigint`, `advance_enabled` present defaulting false, and all row counts preserved through the column drop/re-add.

**Confirmed by the same run:** the pre-fix ledger was entirely fictional. All 228 historical `usage_event` rows sum to **0 cents** — every production call since launch metered as zero, so neither the per-org limit nor the global provider cap has ever had anything to sum.

## 2026-09-04 — locked case 2 fixed (E1) and the claim loop parallelised (E2)

**Shipped:** `:notary-check-api.engine.16` (deployment version 7) and `:notary-check-mcp.server.17` (deployment version 12). No migration, so no deploy-ordering hazard this time.

**E1 — locked case 2, root cause.** The long-standing "paraphrased contradiction returns UNSUPPORTED" failure, open since 2026-09-02, is fixed. **The documented hypothesis was wrong**, and the correction is worth keeping: it blamed the judge for not recognising "declined" as a decrease. The judge does that perfectly — reproduced 3/3 with every field correct and `operator=present(decrease)` every time.

The real cause was entity comparison. Claim and evidence are extracted by different prompts from different texts and legitimately disagree on how much of a name to include: the answer says "Acme's revenue grew 17%", the passage says "Acme Corp FY25 results". `normalizeEntity` canonicalised the *spelling* of a corporate suffix ("Corporation" → "corp") but not its *presence*, so `acme` and `acme corp` stayed different strings. Entity landed in `mismatched` → the candidate was ruled inapplicable → it was dropped before `assignState` ever saw it, and the correctly-detected operator conflict never mattered.

**The asymmetry that explains the original intermittency:** a *differing* operator is a contradiction, but an *absent or mismatched* field is an applicability failure. Same evidence, opposite outcomes, turning on extraction granularity nobody controls.

Fixed with a new, deliberately asymmetric rule in `verification/normalization.ts` (`entity-optional-corporate-suffix-v1`): base names are compared only when **exactly one** side carries a known suffix. "Acme Corp" vs "Acme Inc" still mismatches — those can be different legal entities. "market" vs "Acme" (locked case 6) is untouched. Seven tests, six of them negative boundaries.

**Release gate not met, recorded rather than glossed:** § Evaluator governance requires scoring a comparator change against the held-out labelled set for false-supported rate. That set is 20 unadjudicated drafts (B1), so the number cannot exist. Shipped on the owner's explicit instruction with prod having no users. Re-score when B1 lands.

**Verified live** against `api.getnotary.ai` via `engine/scripts/prod-smoke.ts`, both cases returning `CONTRADICTED` with a resolved match and an Advance suggestion:
- `--case paraphrase` — "declined 12 percent in fiscal 2025" vs claim "grew 17% in FY25" (the case that was broken)
- `--case exact` — "increased 12%" vs "grew 17%" (regression check on the path that already worked)

**E2 — claim loop parallelised.** Claims were submitted one at a time, each round trip internally running a judge call and an Advance call, so a five-claim answer was five sequential waits while the MCP tool call blocked Claude's turn. Now bounded-concurrent at 4 in flight. Execution fans out; **accumulation stays in claim order**, because the challenge and Advance caps are first-come and accumulating by completion would let network timing decide which claim's suggestions survive.

**Also now live:** the `not_checked` card state (previously committed but undeployed), so an unsourced claim no longer reports as a Notary malfunction.

**Test counts:** engine 356/356 against real Postgres with all 15 migrations (up from 349); server 6/6.

## Live verification, 2026-09-02 — direct testing against `mcp.getnotary.ai`, not repo inspection

Everything in this repo's earlier snapshots about `server/`'s live status was inferred from source/`.env` files, never from actually calling the deployed service. This section corrects that — four isolated `tools/call` requests, run directly against `https://mcp.getnotary.ai/`, each changing exactly one variable from the last:

1. **Exact-wording support** (`"Acme Corp revenue grew 17% in FY25"` vs. an identical inline `quoted_excerpt`) → `no_issue`. Confirms the deterministic exact-match path works live, end to end, including the full claim-extraction → evidence-registration → applicability → state-machine chain.
2. **Paraphrased support** (`"grew 17% in FY25"` vs. `"increased 17 percent in fiscal 2025"`, plus a corporate-suffix variant) → `no_issue`. Confirms Tier A.5 normalization (percent notation, fiscal-year label matching, corporate-suffix spelling) is genuinely deployed and firing, not just present in source — this is deterministic, allow-listed code, not judge-dependent.
3. **Exact-wording contradiction** (`"grew 12%"` vs. `"grew 17%"`, same operator word) → correctly `CONTRADICTED` (`direct_contradiction`). Confirms the deterministic contradiction path works live too.
4. **Paraphrased contradiction** (`"declined 12 percent in fiscal 2025"` vs. `"grew 17% in FY25"` — an operator paraphrase, "declined" vs. "grew," combined with a differing value) → **came back `UNSUPPORTED`, not `CONTRADICTED`.** This is a real, live discrepancy: `engine/src/judge/promptTemplates.ts`'s own `operator` field instructions explicitly authorize exactly this recognition ("recognizing that 'grew' and 'increased' assert the same direction is exactly the kind of paraphrase recognition the judge is authorized to do" — the same authorization extends to "declined" mapping to `decrease`). Case 3 shows the deterministic/exact-match path correctly detects a contradiction when wording matches; case 2 shows deterministic normalization (not the judge) handles the percent/fiscal-year paraphrase in case 2's success. Case 4 needs the **judge** to recognize the operator paraphrase, and something in that path is not producing a contradiction on the live deployment — worth distinguishing whether this is: (a) already fixed in this checkout's current code and simply not yet deployed, (b) a genuine gap in how the judge-derived `operator` field feeds into contradiction detection, or (c) the judge not being invoked for this field at all (e.g. quota/kill-switch fallback silently degrading to deterministic-only). **Not yet root-caused — flagged here so it isn't lost, not diagnosed.** Given this maps directly to locked test case 2 ("17% answer versus 12% source contradiction," the project's own flagship scenario), this is worth prioritizing over UI polish.

## Test suite and evaluation status

- **Engine unit/integration suite**: 270 total, **266 pass, 0 fail, 4 skipped** (2026-09-02, after the five-bug audit-fix pass; migrations 0001–0011 applied to a real local Postgres, with the live DeepSeek judge tests actually running). The previous recorded figure was 212 total, **208 pass, 0 fail, 4 skipped** against a real local Postgres (`docker run postgres:16-alpine`, migrations 0001–0009 applied) — run directly against the repo as part of producing this doc, not pulled from a stale report. (An earlier snapshot of this doc recorded 151/206 against a sandbox with no live Postgres, where DB-gated tests are skipped instead of run; this run had a real database, which is why far fewer tests are skipped.) "Locked case" references found scattered through source for cases 1, 2, 3, 4, 6, 7, 8, 9, 10, 17 of the documented 18-case suite.
- **Held-out eval set** (`engine/eval/`): 20 draft JSON cases exist, each explicitly marked *"DRAFT — needs independent second annotation, not yet adjudicated."* `engine/eval/SCHEMA.md` states in bold that this directory is **not** the real gating set and none of it may be used to compute release-gate numbers yet. **There is currently no real pass/fail number anywhere for the actual held-out gate** (false-supported rate, wrong-source acceptance rate, contradiction precision) — `docs/build/tier-1-build-and-operating-plan.md` leaves those thresholds blank pending real annotation. This is the single most important open item before any claim of "validated" can be made.
- No CI configuration exists (`.github/` is absent).

## Honest status summary

**Actually live, verified**:
- Engine on AWS Lightsail (live domain + working API key format), running the current build as of 2026-09-03 (all audit-P0 fixes, entitlement, billing lifecycle, Advance) with all 13 migrations applied to production.
- `server/` MCP endpoint at `mcp.getnotary.ai` — live, real protocol responses, real judge + Tier A.5 normalization confirmed firing (see "Live verification" below). **As of 2026-09-03, running the current build with Clerk OAuth actually gating both MCP routes** — confirmed via a real `401`/`WWW-Authenticate` response to an unauthenticated call.
- `clerk.getnotary.ai` custom domain — confirmed via live `dig`, no longer just prose.
- `getnotary.ai` — a live marketing site, but a separate/unreconciled asset from this checkout's `dashboard/`; flagged by the product owner as stale, needs a refresh.
- Engine test suite genuinely passing at 208/212 (0 failures) against a real local Postgres.
- Clerk auth in production mode for `dashboard/` (live keys) — sign-in/sign-up confirmed working per earlier sessions; billing/org-resolution end-to-end not independently re-confirmed this pass.
- `DD_API_KEY` — confirmed set (32 chars) on the `notary-check-api` Lightsail container service, checked directly against the live container service configuration on 2026-09-02 (see "Observability — Datadog" above).

**Configured, not confirmed live**:
- (nothing currently in this category — see "Actually live, verified" above for `DD_API_KEY`, moved there 2026-09-02.)

**Configured, contradicts what's actually deployed**:
- Cloudflare Container scaffold (`wrangler.jsonc`, `@cloudflare/containers`) — no evidence it was ever the real deploy target; Lightsail is.

**Not built, per the repo's own documentation**:
- A real payload/object store (`evidence.resolved_text` is an explicit, deliberate stand-in).
- **PDF locators are page-level, not bounding-box.** `engine/src/ingestion/parsePdf.ts` extracts real per-page text and a character offset maps deterministically to exactly one page, but the text API exposes no per-glyph geometry, so an (x, y, w, h) rectangle is not derivable and is deliberately not faked.
- **Structured (JSON) evidence has a defined coordinate system but no producer.** `locators.ts`'s `json_path` kind is real and tested; nothing in the ingestion path yet produces JSON-shaped evidence (the MIME allowlist admits HTML and PDF only), so it is deliberately unwired.
- **`estimateDeepSeekCostCents` rounds each call to whole cents**, so a typical judge or extraction call meters as 0 cents and never accumulates toward the per-org limit or the global spend cap. Pre-existing and shared by both model call sites; it limits how much either quota gate actually bites in practice.
- The held-out annotated eval gate (20 unadjudicated draft cases only).
- CI.
- Any deployment runbook (this doc is the first attempt).

**Not used despite appearing in early planning**:
- Neon — a pricing footnote only, never adopted; plain Postgres via `pg` is what's actually wired.

## Recommended next documentation actions

1. Delete or explicitly mark dead the Cloudflare Container scaffold, so it stops reading as a live option.
2. Record what `DATABASE_URL` actually resolves to on the live Lightsail deployment — currently unknowable from this repo alone.
3. Update `engine/README.md`'s two stale "what does NOT exist" claims (OAuth, metrics/alerting) — both are now false.
4. ~~Confirm whether `DD_API_KEY` is actually set on Lightsail~~ — done 2026-09-02, confirmed set on `notary-check-api`. Remaining open question: whether Datadog is actually ingesting the shipped logs (not checked from this repo).
5. Treat the 20 draft eval cases' independent annotation and adjudication as the real gate before any "validated" claim is made publicly — this is the one gap that most directly matters for the honesty principle Part I of the Canonical Product Definition holds the whole product to.
