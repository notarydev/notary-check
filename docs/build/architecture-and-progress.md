> Status: snapshot
> Owner: Hardyk
> Last verified: 2026-09-02
> Supersedes: —

# Notary Check — Architecture and infrastructure progress

*A factual snapshot of what's actually deployed and running, as of 2026-09-02. Every claim below is sourced to a real file, a live secret on disk, or a command run against the repo — not to a plan or a doc's stated intent. Where the repo's own docs contradict what's actually deployed, that's called out explicitly rather than silently resolved one way.*

## The headline gap this doc exists to close

**There is no accurate, up-to-date deployment/infra doc anywhere in this repo.** The only ground truth for what's actually live is gitignored `.env` files plus a couple of stray code comments. `README.md` only covers Phase 0 tunnel-based local testing; `HANDOFF.md` is a narrative build log, not a runbook, and doesn't mention AWS at all; `engine/README.md` predates the Clerk, billing, and Datadog work and actively contradicts current reality in two places. This doc is the first attempt at closing that gap — treat it as a snapshot to keep current, not a one-time artifact.

## Repo shape

Four real subprojects under `notary-check/`:

| Dir | What it is | Status |
|---|---|---|
| `engine/` | Node/TS/Express API on Postgres, no ORM (raw SQL migrations). The actual verification pipeline — claim extraction, evidence ingestion, applicability, judge, state machine, billing, quotas. | Most-built component, live. |
| `server/` | Thin MCP server (Express + MCP SDK + `ext-apps`), Clerk-gated, calls `engine/` over HTTP. | Live, Clerk OAuth wired. |
| `ui/` | React/Vite app, builds to one inlined HTML file served as the MCP App resource. | Live, minimal — just the card renderer. |
| `dashboard/` | Next.js 16 App Router app — landing page + `/account` billing page, Clerk auth. | Live in production per live Clerk keys. |

## Infrastructure, service by service

### Compute — AWS Lightsail (live), Cloudflare Container (scaffolded, not evidenced as ever deployed)

The engine is live on **AWS Lightsail Container Service**, region `us-east-2` — confirmed only by the gitignored `server/.env`'s `ENGINE_URL`, pointing at a `*.cs.amazonlightsail.com` address, and corroborated by a code comment in `engine/src/observability/log.ts` referencing "Lightsail's own container logs." **This is nowhere documented** — no README, no HANDOFF entry, nothing — it only exists as a fact on disk.

There's a real contradiction sitting in the repo: `engine/wrangler.jsonc`, `engine/worker/container.ts`, and a `@cloudflare/containers` dependency scaffold a **Cloudflare** Container deployment path instead. Nothing indicates this path was ever actually used — no `wrangler deploy` in any script, no CI, no Cloudflare account reference beyond the scaffold itself, and the live `ENGINE_URL` is a Lightsail domain, not a Workers domain. Read this as: Cloudflare was evaluated or partially built out, then Lightsail is what actually shipped. Worth deleting the Cloudflare scaffold or explicitly marking it dead, so a future reader doesn't assume it's the deploy target.

The **`server/` MCP layer's own deployment target has no evidence anywhere in this repo** — not committed, not in any `.env` found. Its Clerk OAuth wiring and its outbound call to the live engine are both real and verified in source, but where `server/` itself physically runs is not established by anything in this checkout.

### Database — plain Postgres, not Neon

No ORM — raw SQL migrations (`engine/migrations/0001`–`0007`) run by a minimal custom runner (`engine/src/migrate.ts`), using the plain `pg` package. **Neon is not used** — the only mention of it anywhere in the repo is a pricing-comparison footnote in `docs/build/tier-1-build-and-operating-plan.md`, alongside Vercel/R2/DeepSeek pricing citations, not a decision record. The checked-in local-dev `DATABASE_URL` points at `localhost:5432`; what the live Lightsail deployment's `DATABASE_URL` actually points at (Lightsail's own managed Postgres, a co-located container, RDS, or something else) isn't recorded anywhere in this repo and is worth confirming and documenting explicitly, since it's currently unknowable from source alone.

**Schema, as it stands** (all raw SQL, no schema file to point to instead):
- `organization` — plus `plan`, `stripe_customer_id`, `stripe_subscription_id` (migration 0005), `clerk_user_id` (0007)
- `review` — plus `idempotency_key`, `status`, timestamps (0006)
- `evidence` — plus `resolved_text` (0006), which migration 0006's own comment documents as a **deliberate, narrow stand-in for a real object/payload store (S3-equivalent) that doesn't exist yet**
- `claim`, `evidence_match` (0003)
- `"user"` (0004) — minimal stub, just id + organization_id
- `organization_api_key`, `usage_event` (0004)

### Auth — Clerk, two separate integrations, both real

1. **`server/src/server.ts`** — `@clerk/express` + `@clerk/mcp-tools/express`. Both MCP POST routes (`/` and `/mcp`) gated by `mcpAuthClerk`; OAuth discovery routes wired (`/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`).
2. **`server/src/orgResolver.ts`** — resolves a Clerk user id to an engine API key via `POST {ENGINE_URL}/v1/internal/resolve-organization`, authenticated with a shared `X-Internal-Secret` header, compared via `timingSafeEqual`. In-memory cache, process lifetime only.
3. **`dashboard/`** — separate `@clerk/nextjs` wiring: sign-in/sign-up/account page (`dashboard/src/app/page.tsx`, `dashboard/src/app/account/page.tsx`). The gitignored `dashboard/.env.local` holds **live** (`pk_live_`/`sk_live_`) keys, on a custom Frontend API domain `clerk.getnotary.ai` — per `HANDOFF.md`, added manually via Cloudflare DNS, but not independently confirmable from any committed config.

`engine/README.md` still says "No OAuth/OIDC for a human-facing login... not something to guess" — **stale**, contradicted by all of the above, which postdates that doc. Worth a pass to update or delete outdated setup docs so they stop reading as current state.

The static `ENGINE_API_KEY` fallback in `server/.env.example` is documented as exactly that — a manual-testing fallback for when no per-user Clerk-resolved key is available, not the primary path.

### Billing — Stripe, test mode only

Checkout + webhook handling lives in `engine/src/billing/`; the billing UI is `dashboard/src/app/account/page.tsx`, not a separate top-level dir. Keys in `engine/.env` are `sk_test_`/`pk_test_` — **not live**. This is the one area where "configured" and "actually taking real payment" are clearly different states; don't describe billing as production-ready without a live-mode key swap and a real webhook endpoint check first.

### Observability — Datadog, wired but unconfirmed live

`engine/src/observability/log.ts` always writes structured JSON to stdout, and separately does a bare `fetch` POST to Datadog's log intake endpoint — but only if `DD_API_KEY` is set, which it is not in any committed `.env`/`.env.example`. The code path is real, correctly fire-and-forget (a Datadog outage can't affect a request), but **whether data is actually flowing in the live deployment is unverifiable from this repo** — that depends on Lightsail's own environment configuration, which isn't visible here. `engine/README.md` still lists "a metrics/alerting platform" under "what does NOT exist" — another stale doc contradiction.

### Domains

| Domain | Evidence | What it is |
|---|---|---|
| `notary-check-api.dht4me4ddy2y4.us-east-2.cs.amazonlightsail.com` | `server/.env` (live value) | The engine's real, live Lightsail endpoint. |
| `clerk.getnotary.ai` | `HANDOFF.md` prose only | Clerk's custom Frontend API domain — described, not independently verifiable from committed config. |
| `notarycheck.ai` | `dashboard/src/app/account/page.tsx` (`sales@notarycheck.ai` mailto) | Only evidence of this domain; no DNS/MX config in-repo to confirm it's live. |

## Test suite and evaluation status

- **Engine unit/integration suite**: 206 total, **151 pass, 0 fail, 55 skipped** (skips are DB/live-API-gated tests that don't run without a live Postgres/DeepSeek key in a sandbox) — run directly against the repo as part of producing this doc, not pulled from a stale report. "Locked case" references found scattered through source for cases 1, 2, 3, 4, 6, 7, 8, 9, 10, 17 of the documented 18-case suite.
- **Held-out eval set** (`engine/eval/`): 20 draft JSON cases exist, each explicitly marked *"DRAFT — needs independent second annotation, not yet adjudicated."* `engine/eval/SCHEMA.md` states in bold that this directory is **not** the real gating set and none of it may be used to compute release-gate numbers yet. **There is currently no real pass/fail number anywhere for the actual held-out gate** (false-supported rate, wrong-source acceptance rate, contradiction precision) — `docs/build/tier-1-build-and-operating-plan.md` leaves those thresholds blank pending real annotation. This is the single most important open item before any claim of "validated" can be made.
- No CI configuration exists (`.github/` is absent).

## Honest status summary

**Actually live, verified**:
- Engine on AWS Lightsail (live domain + working API key format).
- Clerk auth in production mode, both `server/` (MCP OAuth) and `dashboard/` (live keys).
- Engine test suite genuinely passing at 151/206 (0 failures).

**Configured, not confirmed live**:
- Datadog log shipping — code path real, no key found anywhere committed.
- `clerk.getnotary.ai` custom domain — described only in prose.

**Configured, contradicts what's actually deployed**:
- Cloudflare Container scaffold (`wrangler.jsonc`, `@cloudflare/containers`) — no evidence it was ever the real deploy target; Lightsail is.

**Not built, per the repo's own documentation**:
- A real payload/object store (`evidence.resolved_text` is an explicit, deliberate stand-in).
- The held-out annotated eval gate (20 unadjudicated draft cases only).
- CI.
- Any deployment runbook (this doc is the first attempt).

**Not used despite appearing in early planning**:
- Neon — a pricing footnote only, never adopted; plain Postgres via `pg` is what's actually wired.

## Recommended next documentation actions

1. Delete or explicitly mark dead the Cloudflare Container scaffold, so it stops reading as a live option.
2. Record what `DATABASE_URL` actually resolves to on the live Lightsail deployment — currently unknowable from this repo alone.
3. Update `engine/README.md`'s two stale "what does NOT exist" claims (OAuth, metrics/alerting) — both are now false.
4. Confirm whether `DD_API_KEY` is actually set on Lightsail; if not, either set it or stop describing Datadog as wired-and-shipping.
5. Treat the 20 draft eval cases' independent annotation and adjudication as the real gate before any "validated" claim is made publicly — this is the one gap that most directly matters for the honesty principle Part I of the Canonical Product Definition holds the whole product to.
