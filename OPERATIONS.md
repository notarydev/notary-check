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
