# Notary Check

An MCP connector that checks the claims in a Claude answer and shows only what
breaks. It renders as an interactive card inside the conversation.

Notary runs **outside** the conversation. It cannot see the chat; it only sees
what Claude hands it in one tool call, and it answers once. That single
constraint shapes most of the design — see `docs/` below.

## Start here

| If you want to | Read |
|---|---|
| Understand how it works end to end | [`MECHANISM.md`](MECHANISM.md) — **start here** |
| Know what the words mean | [`CLAUDE.md`](CLAUDE.md) — Verify / Act / Challenge / Move, and the one authority rule |
| Find your way around the code | [`MODULES.md`](MODULES.md) — what each directory owns and what it may import |
| Know what's actually live | [`docs/build/architecture-and-progress.md`](docs/build/architecture-and-progress.md) |
| Deploy, or find the infra/domains/keys | [`OPERATIONS.md`](OPERATIONS.md) |
| Know what's left to a real SaaS | [`ROADMAP.md`](ROADMAP.md) — **the index** |
| Know the detail behind a roadmap item | [`docs/build/whats-left.md`](docs/build/whats-left.md) |
| Know the rules code is held to | [`docs/build/tier-1-build-and-operating-plan.md`](docs/build/tier-1-build-and-operating-plan.md) |
| See status at a glance | [`PROGRESS.md`](PROGRESS.md) |

## What it does

One invocation has two halves:

- **Verify** — deterministic. Compares each material claim against the evidence
  actually supplied, re-dereferences the locator against retained canonical
  text, and assigns a state through the state machine. A model may propose
  here; only an evidence-bound procedure decides.
- **Act** — judged, and never decides anything. Two layers: **Challenge** (0–2
  bounded questions about a resolved claim, built but flag-off) and **Move**
  (0–2 next actions from a closed set: `clarify` / `test` / `compare` /
  `repair`).

Act cannot assign a claim state. That is enforced by
`engine/scripts/check-boundaries.ts`, not by convention.

## Structure

```
notary-check/
├── engine/       Verification engine + HTTP API. Postgres, DeepSeek judge.
│   ├── src/        see MODULES.md for the layering
│   ├── migrations/ applied, append-only — never edit one that has run
│   ├── eval/       measurement harnesses (these cost real model calls)
│   └── scripts/    ops, plus check-boundaries.ts
├── server/       The MCP server Claude talks to (Express + MCP SDK)
├── ui/           The review card (React → one inlined HTML file)
├── dashboard/    Customer dashboard (Next.js)
└── docs/         Governed docs — see docs/README.md for what's canonical
```

## Run it

Tests use a real Postgres and a real judge — deliberately not mocked. Without a
database, ~19 tests fail with `ECONNREFUSED` and nothing else tells you why.

```bash
docker run -d --name notary-pg -p 5432:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=notary_check postgres:16
docker exec notary-pg psql -U postgres -c "CREATE ROLE $USER LOGIN SUPERUSER;"
cd engine && npm run migrate && npm test
```

```bash
cd ui && npm run build        # build the card first
cd ../server && npm start     # then the MCP server
```

To test inside Claude, the server must be reachable from Anthropic's
infrastructure — `localhost` will not do:

```bash
cloudflared tunnel --url http://localhost:3333
```

Register the printed HTTPS URL + `/mcp` as a custom connector in Claude's
developer settings.

## Deployed

Two AWS Lightsail container services in `us-east-2`: `notary-check-api` (the
engine, behind `api.getnotary.ai`) and `notary-check-mcp` (the MCP server, at
`mcp.getnotary.ai`). Postgres runs on a separate Lightsail instance. Clerk
provides OAuth. Credentials live only in the container service environment and
are deliberately not recorded in this repo.

The full picture — every domain, the four separate codebases, the deploy
procedure, and why there is no sign-up flow yet — is in
[`OPERATIONS.md`](OPERATIONS.md). Current image versions are in
[`docs/build/architecture-and-progress.md`](docs/build/architecture-and-progress.md).
Don't assume it's in sync — check the live endpoint after any deploy.
