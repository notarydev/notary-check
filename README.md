# Notary Check

Phase 0 scaffolding for Notary Check — Notary's Tier 1, CHECK-tier product. An MCP App that shows an in-chat evidence-review card in Claude. This phase is **mocked data only**: no real claim extraction, no evidence retrieval, no database, no auth, no billing. **This description is historical** — Phase 0's mocked scaffolding has since been replaced by a real engine, judge, Clerk auth, and a redesigned card. For current state see [`docs/build/architecture-and-progress.md`](docs/build/architecture-and-progress.md); for what's next see [`docs/build/whats-left.md`](docs/build/whats-left.md). The original Phase 0 spec is archived at [`docs/build/phase-0-and-challenge-archive.md`](docs/build/phase-0-and-challenge-archive.md).

Separate, clean codebase — independent of the unrelated `notary-platform` repo.

## Structure

```
notary-check/
├── server/   MCP server (Express + @modelcontextprotocol/sdk + ext-apps), mocked scenario routing
└── ui/       The review card (React), built to a single inlined HTML file
```

## Run it

```bash
# 1. Build the card
cd ui
npm run build

# 2. Start the server (separate terminal)
cd ../server
npm start
```

Test the card in isolation, without Claude:
```
ui/dist/mcp-app.html?mock=<url-encoded JSON of one of the four scenarios in server/src/mocks/scenarios.ts>
```

To actually test inside Claude, the server needs to be reachable over the public internet — Claude's custom connectors call out from Anthropic's infrastructure, not `localhost`. Use a tunnel:

```bash
cloudflared tunnel --url http://localhost:3333
# or: ngrok http 3333
```

Register the printed public HTTPS URL (e.g. `https://<random>.trycloudflare.com/mcp`) as a custom connector in Claude's developer settings, then ask Claude to call `review_source_backed_answer` on a message containing "Acme's revenue grew 17%..." to trigger the mocked scenarios.

## Notes on this scaffolding

A few things were fixed here that the original build plan flagged as `VERIFY` or got wrong, found by actually building and running this — see the plan's § Phase 0 build guide for the full detail:

- `@modelcontextprotocol/ext-apps`'s server helpers (`registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE`) live under the `/server` subpath, not the package root.
- The UI needs `@modelcontextprotocol/ext-apps` too — its `react` subpath's `useApp` hook is the real (not mocked) way the card receives tool results from the host.
- `vite` is pinned to `^5` and `@vitejs/plugin-react` to `^4` — `vite@8`'s default rolldown bundler currently breaks `vite-plugin-singlefile`.
- Renaming the build output to `mcp-app.html` is done as a post-build rename, not via `rollupOptions.output.entryFileNames` (that approach makes the plugin misclassify the JS chunk as an HTML template and crash).
- `App.tsx`'s mock-param parsing calls `JSON.parse(mock)` directly — `URLSearchParams.get()` already URL-decodes, so an extra `decodeURIComponent()` throws on any literal `%` in the card copy (e.g. "17%").
- `index.html` declares `<meta charset="utf-8">` and `index.css` sets an explicit light background — without them, the card's em dashes/§ and dark-on-transparent text broke visually.

## What's not here yet

No auth, no billing, no real verification engine, no database, no live Claude connector test, no user testing. Per § 0.12 of the plan, Phase 0 isn't done until all four mocked scenarios have been confirmed through a live Claude conversation over a public tunnel URL, and 20–30 scripted test conversations have run with real people.
