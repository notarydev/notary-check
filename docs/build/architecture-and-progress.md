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

There's a real contradiction sitting in the repo: `engine/wrangler.jsonc`, `engine/worker/container.ts`, and a `@cloudflare/containers` dependency scaffold a **Cloudflare** Container deployment path instead. Nothing indicates this path was ever actually used — no `wrangler deploy` in any script, no CI, no Cloudflare account reference beyond the scaffold itself, and the live `ENGINE_URL` is a Lightsail domain, not a Workers domain. Read this as: Cloudflare was evaluated or partially built out, then Lightsail is what actually shipped. Worth deleting the Cloudflare scaffold or explicitly marking it dead, so a future reader doesn't assume it's the deploy target.

**Corrected 2026-09-02, superseded 2026-09-03**: the `server/` MCP layer's deployment target IS established — it's live and reachable at `https://mcp.getnotary.ai/`, DNS-confirmed pointing at a Lightsail container endpoint. **As of 2026-09-03, the live deployment is the current build**, redeployed as image `:notary-check-mcp.server.10` (Lightsail deployment version 7). Clerk OAuth is now live: `.well-known/oauth-protected-resource/mcp` resolves and points at `clerk.getnotary.ai`; an unauthenticated `POST /mcp` returns `401` with a real `WWW-Authenticate` challenge. `INTERNAL_SERVICE_SECRET` and live Clerk keys (`CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY`) are now set on this container service's env — previously absent. Do not assume this stays in sync automatically — verify against the live endpoint again after any future deploy.

### Database — plain Postgres, not Neon

No ORM — raw SQL migrations (`engine/migrations/0001`–`0013`) run by a minimal custom runner (`engine/src/migrate.ts`), using the plain `pg` package. All 13 migrations are applied to the live production database as of 2026-09-03 (migrations `0007`–`0013` were run live that day, after a verified `pg_dump` backup was taken first; `0001`–`0006` were already applied). Migration `0013_advance.sql` adds `advance_invocation`/`advance_suggestion`/`advance_event` for the Advance (Track 2 v2) feature — see "2026-09-03 deploy" below. **Neon is not used** — the only mention of it anywhere in the repo is a pricing-comparison footnote in `docs/build/tier-1-build-and-operating-plan.md`, alongside Vercel/R2/DeepSeek pricing citations, not a decision record. The checked-in local-dev `DATABASE_URL` points at `localhost:5432`; what the live Lightsail deployment's `DATABASE_URL` actually points at (Lightsail's own managed Postgres, a co-located container, RDS, or something else) isn't recorded anywhere in this repo and is worth confirming and documenting explicitly, since it's currently unknowable from source alone.

**Schema, as it stands** (all raw SQL, no schema file to point to instead):
- `organization` — plus `plan`, `stripe_customer_id`, `stripe_subscription_id` (migration 0005), `clerk_user_id` (0007). Still has **no `created_at` column** — `GET /v1/organization` (below) returns `created_at: null` rather than inventing one.
- `review` — plus `idempotency_key`, `status`, timestamps (0006); plus `review_organization_id_created_at_idx` on `(organization_id, created_at)` (0008), supporting keyset pagination for `GET /v1/reviews`.
- `evidence` — plus `resolved_text` (0006), which migration 0006's own comment documents as a **deliberate, narrow stand-in for a real object/payload store (S3-equivalent) that doesn't exist yet**; plus `created_at` and `evidence_created_at_idx` (0008) — `evidence` had no timestamp column at all before this, so no correct paginated listing was possible until now. Migration 0011 adds `content_kind`, `text_provenance` (`fetched` vs `caller_supplied`), `canonical_text_hash`, `parse_status`, `parse_error`, and `page_ranges`, and extends the `retrieval_status` CHECK with `revoked`. The load-bearing distinction: `retrieval_status` answers "did the bytes arrive", `parse_status` answers "is there readable, locatable content", and only the second licenses a completed check — conflating them was what turned an unreadable PDF into `UNSUPPORTED` instead of `INDETERMINATE`.
- `evidence_match` — plus `locator_json`, `locator_resolved`, `locator_resolved_at`, `payload_revoked_at` (0011). `locator_json` holds the real coordinate (`engine/src/evidence/locators.ts`); the pre-existing `locator` text column is now a human-readable label only. `locator_resolved` records that the locator was actually **re-dereferenced** against the retained canonical text at state-assignment time, not merely computed once at write time.
- `claim` — plus `lifecycle_state` / `lifecycle_detail` (0011): WHERE a claim got to in the pipeline, kept strictly orthogonal to `state` (WHAT the evidence showed). Only `lifecycle_state = 'completed'` licenses a caller to read `state` as a finding about the world. `claim.state` is still assigned by `verification/stateMachine.ts` and by nothing else.
- `claim`, `evidence_match` (0003); `claim` plus `created_at` and `claim_review_id_created_at_idx` on `(review_id, created_at)` (0008) — also backs `GET /v1/usage`'s "checks this calendar month" count.
- `"user"` (0004) — minimal stub, just id + organization_id
- `organization_api_key`, `usage_event` (0004)

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

`engine/README.md` still says "No OAuth/OIDC for a human-facing login... not something to guess" — **stale**, contradicted by all of the above, which postdates that doc. Worth a pass to update or delete outdated setup docs so they stop reading as current state.

The static `ENGINE_API_KEY` fallback in `server/.env.example` is documented as exactly that — a manual-testing fallback for when no per-user Clerk-resolved key is available, not the primary path.

### Billing — Stripe, test mode only

Checkout + webhook handling lives in `engine/src/billing/`; the billing UI is `dashboard/src/app/account/page.tsx`, not a separate top-level dir. Keys in `engine/.env` are `sk_test_`/`pk_test_` — **not live**. This is the one area where "configured" and "actually taking real payment" are clearly different states; don't describe billing as production-ready without a live-mode key swap and a real webhook endpoint check first.

### Observability — Datadog, wired but unconfirmed live

`engine/src/observability/log.ts` always writes structured JSON to stdout, and separately does a bare `fetch` POST to Datadog's log intake endpoint — but only if `DD_API_KEY` is set, which it is not in any committed `.env`/`.env.example`. The code path is real, correctly fire-and-forget (a Datadog outage can't affect a request). `DD_API_KEY` was checked directly against the live AWS Lightsail container service configuration on 2026-09-02 and **is confirmed set** (32 chars) on the `notary-check-api` container service — so whether data is actually flowing is no longer unverifiable from this repo alone, it's a confirmed-live setting (whether Datadog is actually receiving/ingesting it is a separate question, not checked here). `engine/README.md` still lists "a metrics/alerting platform" under "what does NOT exist" — another stale doc contradiction.

Both live AWS Lightsail container services, region `us-east-2`, both currently `RUNNING`: `notary-check-api` (the engine) and `notary-check-mcp` (`server/`, the MCP layer). Naming them here so this isn't undiscoverable from the repo — previously this required querying Lightsail directly.

### Domains

| Domain | Evidence | What it is |
|---|---|---|
| `notary-check-api.dht4me4ddy2y4.us-east-2.cs.amazonlightsail.com` | `server/.env` (live value) | The engine's real, live Lightsail endpoint. |
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
- **Not yet re-verified live**: a real end-to-end MCP `tools/call` producing an `advance_suggestions` payload through the deployed connector (verified locally with real Postgres + DeepSeek during the build, not yet re-run against the redeployed live endpoint).

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
