# Where everything lives

Infrastructure, domains, and deploy procedure. Written because none of it was
written down: the Lightsail hosting existed only as a URL in a gitignored
`.env`, and the deploy commands existed only in shell history.

**Nothing secret is in this file.** Credentials live in the Lightsail container
service environment and in gitignored `.env` files. This is the map, not the keys.

---

## The four codebases

Only the first is this repo. The other three are separate, and a new agent will
not find them from here unless told.

| What | Where | Deployed to | Live? |
|---|---|---|---|
| **Notary Check** (engine, MCP server, card, dashboard) | `~/Documents/Notary/notary-check` — GitHub `notarydev/notary-check` | AWS Lightsail, `us-east-2` | **yes** |
| **Marketing site** (`getnotary.ai`) | `~/Documents/Notary/GetNotary.ai` — its own git repo, package `notary-site` | Cloudflare Worker (`wrangler deploy`) | **yes** |
| **Dashboard** | `notary-check/dashboard/` (Next.js) | — | **no** — not deployed anywhere |
| `notary-platform/`, `phase1-*` | siblings in `~/Documents/Notary` | — | **unrelated product.** Different tool contract, verification pipeline and judge. Do not read them for context on this one. |

---

## Domains

| Domain | Points at | Status |
|---|---|---|
| `getnotary.ai` | Cloudflare Worker (the marketing site) | live |
| `www.getnotary.ai` | 301 → `getnotary.ai` | live |
| `mcp.getnotary.ai` | Lightsail `notary-check-mcp` | live — the connector Claude talks to |
| `api.getnotary.ai` | Lightsail `notary-check-api` | live — the engine |
| `clerk.getnotary.ai` | Clerk | live — OAuth |
| `app.` / `dashboard.` | — | **do not resolve.** No dashboard is deployed. |

DNS and the Worker's domain binding are managed in the Cloudflare dashboard, not
in `wrangler.toml` — deliberately, so wrangler doesn't try to recreate records
that already exist.

---

## There is no sign-up flow

This is the honest state, not an omission:

- The marketing site's every call to action goes to `#contact`, a form that
  emails `hello@getnotary.ai` through a Cloudflare `send_email` binding
  (rate-limited to 5/60s). There is no "sign up", no pricing page, no checkout.
- The engine **does** have a waitlist route (`routes/waitlist.ts`) and Stripe
  billing wired (`routes/billing.ts`, `routes/webhook.ts`, still test-mode
  keys). Nothing on the marketing site calls either.
- Clerk OAuth is live and works — but it authenticates the **connector**, in
  Claude's OAuth flow. It is not a website sign-up.

So: a person cannot currently create an account. Closing that needs (a) the
dashboard deployed somewhere, (b) a sign-up entry point on the marketing site,
(c) Stripe flipped to live keys. See `docs/build/whats-left.md`.

---

## AWS

Two Lightsail **container services**, region `us-east-2`. Not ECS, not EKS, not
EC2 — Lightsail's own container product, which builds nothing itself: you push a
local Docker image to its registry and then create a deployment referencing it.

| Service | Container | Port | Behind |
|---|---|---|---|
| `notary-check-api` | `engine` | 4001 | `api.getnotary.ai` |
| `notary-check-mcp` | `server` | 3333 | `mcp.getnotary.ai` |

Postgres is a **standalone instance** (not Lightsail managed Postgres, not RDS),
database `notary_check`, TLS required. Its address and credentials exist only in
the container service environment — read them from there, they are not in the repo.

```bash
# what is live right now
aws lightsail get-container-services --region us-east-2 \
  --query 'containerServices[].{name:containerServiceName,state:state,ver:currentDeployment.version,img:currentDeployment.containers.*.image}'

# logs
aws lightsail get-container-log --region us-east-2 \
  --service-name notary-check-api --container-name engine
```

There is **no `/healthz` or `/readyz`** on either service. `curl api.getnotary.ai/`
returns 404 and that is expected, not a fault. Building them is on the punch list.

---

## Deploying

Both images must be built `linux/amd64` — Lightsail is x86 and dev machines here
are ARM. Omitting `--platform` produces an image that pushes fine and then
crash-loops.

```bash
# 1. build (from repo root; the server image needs ui/dist, so build the card first)
cd ui && npm run build && cd ..
docker build --platform linux/amd64 -t notary-check-api ./engine
docker build --platform linux/amd64 -f server/Dockerfile -t notary-check-mcp .

# 2. push to Lightsail's registry — prints the image ref, e.g. :notary-check-api.engine.34
aws lightsail push-container-image --region us-east-2 \
  --service-name notary-check-api --label engine --image notary-check-api
aws lightsail push-container-image --region us-east-2 \
  --service-name notary-check-mcp --label server --image notary-check-mcp

# 3. deploy. Capture the CURRENT spec and change only the image — the
#    environment block holds every secret and is not reconstructible from the
#    repo. Never hand-write a deployment.
aws lightsail get-container-services --region us-east-2 --service-name notary-check-api \
  --query 'containerServices[0].currentDeployment.{containers:containers,publicEndpoint:publicEndpoint}' \
  --output json > /tmp/api.spec.json
# edit .containers.engine.image to the new ref, then:
aws lightsail create-container-service-deployment --region us-east-2 \
  --service-name notary-check-api --cli-input-json file:///tmp/api.spec.json
```

A deployment takes a few minutes to reach `ACTIVE`. Poll `get-container-services`
and check the version incremented; a failed deployment silently rolls back to the
previous version, so **confirm the version number changed** rather than assuming.

### Migrations

The container does **not** run migrations on boot — `CMD` is `node dist/server.js`.
Run them yourself against the production `DATABASE_URL`:

```bash
cd engine && DATABASE_URL='<prod url from the container service env>' npm run migrate
```

Take a `pg_dump` first. There is one instance and no documented backup schedule.

**Ordering matters for any migration that renames or drops.** The running engine
and the schema must match, so a rename creates a window where one of them is
wrong. Build and push both images *first*, then run the migration and create both
deployments back-to-back. Note that `routes/reviews.ts`'s org-flag read sits
outside its try/catch, so during that window the detect route returns 500 rather
than degrading — it is short, but it is not graceful.

---

## Local development

```bash
docker run -d --name notary-pg -p 5432:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=notary_check postgres:16
docker exec notary-pg psql -U postgres -c "CREATE ROLE $USER LOGIN SUPERUSER;"
cd engine && npm run migrate && npm test
```

The role name must match your OS user — the checked-in `DATABASE_URL` is
`postgres://localhost:5432/notary_check` with no user, so libpq falls back to it.

Tests use a real Postgres and a real DeepSeek key. Without the database, ~19
tests fail with `ECONNREFUSED` and nothing else explains why.

---

## Third parties

| Service | Used for | Where the key lives |
|---|---|---|
| DeepSeek | the judge, claim extraction, Act | `DEEPSEEK_API_KEY` |
| Stripe | billing | `STRIPE_SECRET_KEY` — **test mode**, not live |
| Clerk | connector OAuth | `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` |
| Datadog | logs (fire-and-forget) | `DD_API_KEY`, set on `notary-check-api` |
| Cloudflare | the marketing site + DNS | wrangler auth, in the `GetNotary.ai` repo |

`engine/.env.example` and `server/.env.example` list every variable each service
reads. Both are current.

## 2026-09-05 ops addendum — Clerk/identity, local tooling, current prod (for the next agent)

### Current prod (verified 2026-09-05 against Lightsail)
- Engine: `:notary-check-api.engine.55` (deployment 28) — migrations through `0020`.
- Server/MCP: `:notary-check-mcp.server.49` (deployment 27). No server behaviour change deployed after it; `server/src/engineClient.ts` has only comment/doc edits on main since.
- `main` is ahead of prod only by: server comments, local tools under `engine/scripts/` (not in the runtime image path used in prod review flows), and unlanded E17.

### Clerk — how identity actually works (painfully learned 2026-09-05)
- **Instance/domain:** `clerk.getnotary.ai` (publishable key base64-decodes to this). Auth = Clerk is the OAuth **authorization server**; `server/` is the MCP **resource server** and serves `/.well-known/oauth-authorization-server` + `oauth-protected-resource` via `@clerk/mcp-tools/express`.
- **Keys (never commit values):** `CLERK_PUBLISHABLE_KEY` (public) and `CLERK_SECRET_KEY` are in local `server/.env` (VALID — used for all admin API calls) and in the deployed `notary-check-mcp` container env (**the deployed CLERK_SECRET_KEY is INVALID/stale** — Clerk returns `clerk_key_invalid`; rotate it in the container env and redeploy the server before relying on refresh flows).
- **OAuth application for Claude:** name "Claude (Notary connector)", confidential, `client_id = sI6NaxPkmPcFC49O`, callback `https://claude.ai/api/mcp/auth_callback`, scopes `openid email profile public_metadata private_metadata offline_access`. The secret was ROTATED 2026-09-05 (old one invalidated); current value is only in this session's output — re-rotate via `POST /v1/oauth_applications/{id}/rotate_secret` with the valid key if needed. Do NOT register Claude with the publishable key as client_id (`invalid_client`) and do NOT create a second public OAuth app with the wrong scope set (`invalid_scope`).
- **Account portal is NOT published** — `clerk.getnotary.ai/sign-in` and `/sign-up` 404, so a browser sign-in inside the OAuth flow fails with an `ofid_…` reference until the dashboard owner publishes the portal (Clerk Dashboard → Account portal). Only dashboard access can fix that; no API.
- **Orgs (engine DB `organization`):** `1cde4d65…` Notary (production, no clerk link, used by prod smoke), `898a0428…` "Notary user user_3Ip9iXL" (primary tester), `88a5e76d…` "Notary user user_3IuXVpb" = second identity `hms7tab@gmail.com` (Clerk user `user_3IuXV…`, created 2026-09-05 via admin API; temp password shown once, not stored in repo). New orgs ship `act_moves_enabled=false` (Act dark) — enable via `UPDATE organization SET act_moves_enabled=true WHERE id='…'` when a tester should see moves. Org → API keys auto-provision on first tool call via `POST /v1/internal/resolve-organization` (`INTERNAL_SERVICE_SECRET` on the server).
- **Admin API pattern** (valid secret from `server/.env`): users, invitations, oauth_applications, rotate_secret all via `api.clerk.com` with `Authorization: Bearer <sk>`.

### Local tooling a new agent should know
- **runs-report dashboard:** `cd engine && node scripts/runs-report.mjs` (or leave running) → http://localhost:8123. Local, read-only, auto-polls every 20s; shows the last 5 runs by default (toggle to all); per-run: flow bar (extract/verify/finalise), Verify & Track-2 verdict cards, Comms-with-Claude, second-trip, and full plumbing (claims incl persisted `claim_fields`/`rejected_candidates`, evidence provenance+lengths, usage, moves, findings/gaps). Restart after editing `runs-report.{mjs,html}`.
- **Regression harness:** `cd engine && node scripts/measure-cant-check.mjs` — flags claims whose value is verbatim on a fetched source yet ended UNSUPPORTED/INDETERMINATE (E18 baseline: 98 candidates / 219 unresolved).
- **Prod DB read pattern:** psql via `docker run --rm postgres:16-alpine psql …`; the prod URL from the Lightsail engine env carries `uselibpqcompat=true`, which libpq rejects — strip it first (see deploy.sh `libpq_url`). Everything is read-only from this repo unless you intend a deploy.
- **Key hygiene still open:** rotate the invalid deployed `CLERK_SECRET_KEY`; fix the invalid local `engine/.env` `DEEPSEEK_API_KEY` (breaks the engine test gate when present); close F4 (live keys in `.claude/settings.local.json`).

## Environment & access for a fresh agent — session-start checklist

Run these before claiming you can operate anything; each documents what it proves.

```bash
git ls-remote origin -h refs/heads/main      # GitHub push/pull works
aws sts get-caller-identity                  # AWS CLI authenticated (IAM `Opencode_Notary`)
docker info >/dev/null 2>&1 && echo docker-ok  # Docker daemon running (test PG, prod-DB psql, amd64 image builds)
aws lightsail get-container-services --region us-east-2 \
  --query 'containerServices[].{n:containerServiceName,v:currentDeployment.version}' --output text  # reach Lightsail
```

- **Prod DB URL + engine env**: fetch from the Lightsail `notary-check-api` container env
  (`aws lightsail get-container-services … --query 'containerServices[0].currentDeployment.containers.engine.environment'`).
  The engine's deployed `DEEPSEEK_API_KEY` there is VALID — use it for local live-judge tests; the local
  `engine/.env` key is stale/invalid (a known chore). psql via a throwaway `postgres:16-alpine` container
  (strip `uselibpqcompat` — see deploy.sh `libpq_url`).
- **Local test Postgres**: `docker run -d --name notary-pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=notary_check postgres:16` + `CREATE ROLE $USER LOGIN SUPERUSER;`; engine tests auto-migrate.
- **Clerk admin**: valid secret in local `server/.env` (`CLERK_SECRET_KEY`) → `api.clerk.com`. The secret in the
  **deployed** server env is INVALID (`clerk_key_invalid`) — a chore.
- **Local tools**: runs-report dashboard (`engine/scripts/runs-report.mjs`, localhost:8123) and harness
  (`engine/scripts/measure-cant-check.mjs`) both need only prod DB access.

**Owner-only (agent cannot do these — they are the access backlog):**
Clerk Dashboard (publish Account portal so `/sign-in` resolves; rotate the invalid deployed `CLERK_SECRET_KEY`;
approve OAuth-app changes), Stripe live keys + webhook, Google Cloud OAuth console, marketing site / Cloudflare,
driving a real `claude.ai` session, and any decision gated as "owner decision" in ROADMAP (E11, E17).
