> Status: reference — historical
> Owner: Hardyk
> Last verified: 2026-09-03
> Supersedes: —

# Notary Check — historical build material

Extracted from `tier-1-build-and-operating-plan.md` on 2026-09-03 so that
doc could shrink to what it actually is: the current operating spec.

**Nothing in this file is current guidance.** Two things live here:

1. **The Phase 0 build guide** — the exact step-by-step for the mocked,
   pre-engine connector. Phase 0 is long since done; the code it describes
   has been replaced by a real engine, a real judge, Clerk auth, and a
   redesigned card. It is kept because it records *why* several shipped
   decisions were made (the mocked scenario copy, the card's three-state
   compression, the "no trust score" rule), not because anyone should
   follow it.
2. **Act v1 / Challenge** — built, tested, isolation-verified, then
   frozen on 2026-09-03. `act_challenge_enabled` stays off. Do not extend it.
   "Act" now means **Move** — see the current plan.

If you are looking for what to build, read `whats-left.md`. If you are
looking for the rules, read `tier-1-build-and-operating-plan.md`. If you
are looking for what is live, read `architecture-and-progress.md`.

---

## Phase 0 build guide — exact steps, for any coding agent

This section assumes no prior context beyond this file. Follow it in order. Do not invent file names, card copy, or API calls not shown here — where the exact syntax isn't shown, it's marked **VERIFY** and a real source is linked; check that source before guessing.

**Scope of Phase 0, restated so it can't drift:** a working MCP App that Claude can call, showing a review card with **mocked data only** — no real claim extraction, no real evidence retrieval, no database, no auth, no billing. The goal is to prove the card is legible and useful before building the engine behind it. Every number, claim, and source in this phase is hardcoded.

**The question Phase 0 actually answers is narrower than "can we build a nice card":** it's "when people have a source-backed answer in Claude and Notary is available, do they actually invoke and use it" — the assumption underneath the whole wedge (§ Platform constraint and launch boundary already names invocation-is-not-coverage as a permanent ceiling; Phase 0 is where that assumption gets tested for the first time, not just acknowledged). A polished card that nobody chooses to call is not a Phase 0 pass.

### 0.1 Prerequisites

- Node.js 20+ and npm installed.
- A Claude account with connector/MCP App development access enabled. **VERIFY** current setup steps at the official quickstart before starting: [MCP Apps Quickstart](https://apps.extensions.modelcontextprotocol.io/api/documents/quickstart.html).
- No Anthropic API key needed yet — Phase 0 makes zero model calls.

### 0.2 Repo structure

Create this exact structure inside a new `notary-check/` directory:

```text
notary-check/
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── server.ts
│       └── mocks/
│           └── scenarios.ts
└── ui/
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx
        └── App.tsx
```

Two separate `package.json` files, on purpose: `ui/` is a separate small build (Vite bundles it into one HTML file); `server/` is the MCP server that serves that HTML file as a resource.

### 0.3 Install dependencies

Run these exact commands — actually run, not just inspected, against `@modelcontextprotocol/ext-apps@1.7.5` on 2026-09-01, so the version pins below are load-bearing, not decorative:

```bash
cd notary-check/server
npm init -y
npm install @modelcontextprotocol/ext-apps @modelcontextprotocol/sdk express cors zod
npm install -D typescript tsx @types/express @types/cors @types/node
```

```bash
cd ../ui
npm init -y
npm install react react-dom @modelcontextprotocol/ext-apps
npm install -D typescript "vite@^5" "@vitejs/plugin-react@^4" vite-plugin-singlefile @types/react @types/react-dom
```

Two changes from an earlier draft of this section, both found by actually building it, not by inspection:

- **`ui` also needs `@modelcontextprotocol/ext-apps`**, not just `server` — § 0.8's `App.tsx` uses its `react` subpath (`useApp`) to receive real tool results from the host, which resolves what was previously a `VERIFY` placeholder.
- **`vite` is pinned to `^5` and `@vitejs/plugin-react` to `^4`, not left at latest.** `vite@8` ships on the rolldown bundler by default, and `vite-plugin-singlefile@2.3.3` (the current latest) crashes under it (`Cannot read properties of undefined (reading 'replace')` in `generateBundle`) — confirmed by building against `vite@8.2.2`, `vite@6.4.3`, and `vite@5.4.21` in that order; only 5.x built cleanly with this plugin as of this writing. Re-verify this pin before unpinning — it's a real, currently-open ecosystem incompatibility, not caution for its own sake.

`zod` and `@vitejs/plugin-react` are used below (§ 0.6's input schema, § 0.7's Vite config) — install them here, not as an afterthought when the build fails on a missing import.

### 0.4 `server/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

### 0.5 `server/src/mocks/scenarios.ts` — the mocked data, exact card copy

This is the single most important file in Phase 0. Every string here is already decided — do not rephrase it. It encodes the three canonical CHECK card states already specified in this document (§ Product contract, above).

```typescript
export type ReviewCardData = {
  status: "no_issue" | "issue_found" | "could_not_check";
  scope: string;
  claim?: string;
  findings?: Array<{
    label: string;
    text: string;
    why: string;
  }>;
  actions: string[];
};

// Scenario A — correct answer, nothing to flag.
export const NO_ISSUE: ReviewCardData = {
  status: "no_issue",
  scope: "1 factual claim reviewed against 1 accessible source.",
  actions: [],
};

// Scenario B — single-finding card: source exists but does not support the claim.
export const SINGLE_FINDING: ReviewCardData = {
  status: "issue_found",
  claim: "Acme's revenue grew 17% in FY25.",
  scope: "No applicable source was available to check Acme's FY25 figure.",
  findings: [
    {
      label: "The cited source cannot support this claim",
      text: "It refers to overall market growth.",
      why: "entity mismatch (market ≠ Acme).",
    },
  ],
  actions: ["Open evidence", "Qualify", "Dismiss"],
};

// Scenario C — the flagship two-block contradiction card.
export const TWO_BLOCK_CONTRADICTION: ReviewCardData = {
  status: "issue_found",
  claim: "Acme's revenue grew 17% in FY25.",
  scope: "6 factual claims reviewed against 4 accessible sources.",
  findings: [
    {
      label: "The cited 17% refers to overall market growth, not Acme.",
      text: "This source cannot support the claim.",
      why: "entity mismatch.",
    },
    {
      label: "Acme's FY25 annual report says revenue increased 12% year over year.",
      text: "Applicable contradictory evidence.",
      why: "same entity, period, metric, and baseline; the value conflicts.",
    },
  ],
  actions: ["Open both sources", "Replace with 12%", "Qualify", "Dismiss", "Recheck"],
};

// Scenario D — nothing inspectable was supplied at all.
export const COULD_NOT_CHECK: ReviewCardData = {
  status: "could_not_check",
  scope: "This answer contains claims but no inspectable sources were supplied.",
  actions: [],
};

// Route a fixed list of "answer_text" inputs to one of the four scenarios above.
// This is how Phase 0 fakes the engine: match on keywords, return canned data.
export function pickMockScenario(answerText: string): ReviewCardData {
  const text = answerText.toLowerCase();
  if (text.includes("17%") && text.includes("acme") && text.includes("annual report")) {
    return TWO_BLOCK_CONTRADICTION;
  }
  if (text.includes("17%") && text.includes("acme")) {
    return SINGLE_FINDING;
  }
  if (text.trim().length === 0) {
    return COULD_NOT_CHECK;
  }
  return NO_ISSUE;
}
```

**Rule for whoever builds this:** do not add new mocked scenarios beyond these four without checking this document's Product contract section first. The card copy above is locked language, not a draft.

### 0.6 `server/src/server.ts`

```typescript
import express from "express";
import cors from "cors";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// Verified against the installed @modelcontextprotocol/ext-apps@1.7.5 package.json
// exports map (this resolves what was previously a VERIFY note): registerAppTool,
// registerAppResource, and RESOURCE_MIME_TYPE live under the "./server" subpath,
// not the package root — the root export is the client-side App class used by
// ui/src/App.tsx instead. Importing from the bare package name builds but silently
// resolves the wrong module shape; import from "@modelcontextprotocol/ext-apps/server".
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { pickMockScenario } from "./mocks/scenarios.js";

// The MCP SDK's registerTool contract takes a Zod raw shape (a plain object of
// Zod schemas), not a JSON Schema object — this is the actual, buildable shape,
// not a placeholder. Only answer_text is used in Phase 0; source_refs is accepted
// and ignored until Phase 1 wires the real evidence manifest (§ Verification pipeline).
const reviewInputSchema = {
  answer_text: z.string().describe("The verbatim draft or sent answer text to review."),
  source_refs: z
    .array(
      z.object({
        url: z.string().url().optional(),
        title: z.string().optional(),
        quoted_excerpt: z.string().optional(),
        source_role: z.enum(["answer_citation", "user_added", "workspace_collection"]),
      }),
    )
    .optional()
    .describe("Sources Claude can identify as actually available — never invented."),
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST_DIR = path.join(__dirname, "../../ui/dist");
const RESOURCE_URI = "ui://notary/review-card";
// RESOURCE_MIME_TYPE is imported above, not hardcoded — the package's actual
// default is "text/html;profile=mcp-app", not "text/html".

function buildServer() {
  const server = new McpServer({ name: "notary", version: "0.1.0" });

  registerAppTool(
    server,
    "review_source_backed_answer",
    {
      title: "Check with Notary",
      description:
        "Reviews the material factual claims in a source-backed AI answer against the sources actually supplied, and returns a card showing only material issues. Pass the verbatim answer text and only sources you can identify as actually available — never invent citations or imply private context was delivered.",
      inputSchema: reviewInputSchema,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args: { answer_text: string; source_refs?: unknown[] }) => {
      const cardData = pickMockScenario(args?.answer_text ?? "");
      return {
        content: [
          {
            type: "text",
            text:
              cardData.status === "no_issue"
                ? "No issue found."
                : cardData.status === "could_not_check"
                  ? "Could not verify this against the supplied evidence."
                  : "1 thing to check.",
          },
        ],
        structuredContent: cardData,
      };
    },
  );

  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await readFile(path.join(UI_DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}

const app = express();
app.use(cors());
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT ?? 3333;
app.listen(PORT, () => {
  console.log(`Notary MCP server listening on http://localhost:${PORT}/mcp`);
});
```

### 0.7 `ui/vite.config.ts`

**An earlier draft of this config set `rollupOptions.output.entryFileNames: "mcp-app.html"` to get the built file named correctly. Do not do that — confirmed by building it, not by inspection, this breaks the build.** Naming the JS entry chunk itself `mcp-app.html` makes `vite-plugin-singlefile` misclassify that chunk as an HTML template to inline *into* (its filename matches `/\.html?$/`), rather than as JS to inline. The chunk has no `.source` (only `.code`), so the plugin crashes with `Cannot read properties of undefined (reading 'replace')` inside its own `generateBundle` hook. Leave entry naming at Vite's default and rename the real HTML output file after the build instead:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist",
  },
});
```

`ui/package.json`'s `build` script does the renaming, after the fact, once the real HTML file exists:

```json
{
  "scripts": {
    "build": "vite build && node -e \"require('fs').renameSync('dist/index.html','dist/mcp-app.html')\""
  }
}
```

### 0.8 `ui/src/App.tsx` — the card, exact layout and copy

**The host-communication `VERIFY` from an earlier draft is now resolved, not just flagged.** Checked against the installed `@modelcontextprotocol/ext-apps@1.7.5` package: its `react` subpath exports a `useApp` hook that connects this sandboxed view to the host over `postMessage`; `app.ontoolresult` fires with the tool's `CallToolResult` once `review_source_backed_answer` completes, and `result.structuredContent` there is exactly what `server.ts` returned. That's the real wiring — the `?mock=` param stays only as a local-dev fallback for testing the card without a live Claude session.

```tsx
import { useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";

type ReviewCardData = {
  status: "no_issue" | "issue_found" | "could_not_check";
  scope: string;
  claim?: string;
  findings?: Array<{ label: string; text: string; why: string }>;
  actions: string[];
};

export default function App() {
  const [data, setData] = useState<ReviewCardData | null>(null);

  // Real host wiring, verified as described above.
  useApp({
    appInfo: { name: "notary-check", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as ReviewCardData);
        }
      };
    },
  });

  useEffect(() => {
    // Local dev only: read a `?mock=` query param so the card can be tested
    // standalone without a live Claude session (§ 0.9's isolated browser test).
    // URLSearchParams.get() already URL-decodes the value — do not
    // decodeURIComponent() it again. Confirmed by testing: a payload
    // containing a literal "%" (e.g. "17%" in the card copy) throws
    // "URI malformed" on the second, redundant decode — a bug in an earlier
    // draft of this exact snippet, not a hypothetical.
    const params = new URLSearchParams(window.location.search);
    const mock = params.get("mock");
    if (mock) setData(JSON.parse(mock));
  }, []);

  if (!data) return null;

  if (data.status === "no_issue") {
    return <div className="notary-card notary-quiet">No issue found.</div>;
  }

  if (data.status === "could_not_check") {
    return (
      <div className="notary-card notary-quiet">
        Could not verify this against the supplied evidence.
      </div>
    );
  }

  const isTwoBlock = (data.findings?.length ?? 0) > 1;

  return (
    <div className="notary-card">
      <div className="notary-header">1 thing to check</div>
      {data.claim && <div className="notary-claim">{data.claim}</div>}
      {data.findings?.map((f, i) => (
        <div className="notary-finding" key={i}>
          <div className="notary-finding-label">{f.label}</div>
          <div className="notary-finding-text">{f.text}</div>
          <div className="notary-finding-why">Why: {f.why}</div>
        </div>
      ))}
      <div className="notary-actions">
        {data.actions.map((a) => (
          <button key={a}>{a}</button>
        ))}
      </div>
      <div className="notary-scope">{data.scope}</div>
      {isTwoBlock && (
        <div className="notary-note">
          Two-block card — only render this shape when a rejected candidate AND
          separate applicable contradicting evidence both exist. See § Product
          contract in this document before reusing this layout elsewhere.
        </div>
      )}
    </div>
  );
}
```

`ui/src/main.tsx` — imports a plain `index.css` (any minimal styling is fine; see the rule below):

```tsx
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
```

`ui/index.html` (Vite's entry point, not the built output) — **must declare `<meta charset="utf-8">`.** Confirmed by testing: without it, the card's own em dashes and `§` characters render as mojibake (`â€”`, `Â§`) in the built output, since the browser falls back to a different default encoding.

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`ui/src/index.css` should give the card its own explicit background (e.g. `html, body { background: #ffffff; color-scheme: light; }`) rather than leaving it transparent. Confirmed by testing: without an explicit background, the card's dark text is nearly unreadable against a dark host page — the view has no guaranteed host background to inherit. Full host-theme adaptation (matching Claude's own light/dark setting via `ext-apps`' `useHostStyleVariables`) is real work, correctly deferred past Phase 0; a plain, explicit light background is the Phase 0-appropriate fix.

**No CSS framework, no trust score, no percentage, no green badge, no dashboard — the styling can be plain, but the content and states above must not gain a fifth state or a numeric score. That's a locked product rule, not a Phase 0 simplification.**

### 0.9 Build and run, exact commands

```bash
# 1. Build the UI first — the server reads its output file.
#    (ui/package.json's "build" script is the two-step one from § 0.7 —
#    vite build, then rename dist/index.html to dist/mcp-app.html.)
cd notary-check/ui
npm run build

# 2. Start the server.
cd ../server
npx tsx src/server.ts
```

Test the card in isolation, without Claude, by opening:
`ui/dist/mcp-app.html?mock=<url-encoded JSON of one of the four scenarios in 0.5>`
in a browser — this confirms the card renders correctly before wiring it to a live Claude session. All four scenarios were rendered and visually confirmed this way during Phase 0 scaffolding (correct copy, correct two-block/single-finding/quiet layouts, correct special characters).

### 0.10 Expose the server publicly — required, not optional

**Claude's custom connectors reach out from Anthropic's cloud infrastructure to your server; they do not connect to `localhost` on your laptop.** This is easy to miss because the server *runs* locally and the browser test in § 0.9 *looks* like it proves the app works — it only proves the card renders, not that Claude can call it. Phase 0 is local code, but it needs remote connectivity to actually be tested inside Claude:

```text
localhost:3333
   ↓
Cloudflare Tunnel / ngrok / equivalent
   ↓
public HTTPS MCP endpoint (e.g. https://<random>.trycloudflare.com/mcp)
   ↓
Claude custom connector
```

```bash
# with the server already running on :3333, in a separate terminal:
cloudflared tunnel --url http://localhost:3333
# or: ngrok http 3333
```

Either command prints a public HTTPS URL. That URL — not `http://localhost:3333/mcp` — is what gets registered as the custom connector in § 0.11. A quick tunnel is sufficient for Phase 0; do not build a hosted deployment yet.

### 0.11 Connect to Claude

**VERIFY exact current steps** — this changes as the platform matures — at the [MCP Apps Quickstart](https://apps.extensions.modelcontextprotocol.io/api/documents/quickstart.html) and [Build an MCP App](https://modelcontextprotocol.io/extensions/apps/build). In general shape: register the public tunnel URL from § 0.10 (e.g. `https://<random>.trycloudflare.com/mcp`) as a custom connector in Claude's developer settings, then start a conversation and ask Claude to use the `review_source_backed_answer` tool on a message containing "Acme's revenue grew 17%..." to trigger each mocked scenario.

### 0.12 Phase 0 definition of done — do not call this phase complete until all of these are true

- [ ] All four mocked scenarios (0.5) render correctly through a live Claude conversation over the public tunnel URL (§ 0.10) — not just the isolated `?mock=` browser test, and not against `localhost` alone.
- [ ] The two-block card only ever appears for the contradiction scenario — never for the single-finding or no-source cases.
- [ ] Card copy matches this document's Product contract section exactly — no paraphrasing, no added score/badge/percentage.
- [ ] 20–30 scripted test conversations run with real people (per § Delivery sequence, Phase 0), testing comprehension and perceived helpfulness — not just that the code runs.
- [ ] Nobody has quietly added a real API call, a database, or a real evidence-fetch step. Phase 0 is mocked data only, end to end.

### 0.13 What Phase 0 explicitly does not include

No auth, no billing, no spend caps, no real verification engine, no database. Those are Pillars 3–7 from this project's broader pillar breakdown, and they start only after Phase 0's definition of done (§ 0.12) is met and the interaction is proven worth building further.

**A Phase 0 build is not a Phase 1 claim.** A demo or preview environment running this exact mocked scenario set — however polished — proves interaction comprehension only. It is not evidence that any real source manifest, extraction pipeline, or judge call works, and it should not be described internally or externally as an operating checker until Phase 1's real engine is live and passing § Locked test suite and release gates below. If a demo build and a deployed public build ever diverge, the deployed one is what counts as "resolved" — a fix that exists only locally has not shipped.


---

### Act / Challenge layer — SUPERSEDED 2026-09-03, kept for reference only

**Status: superseded, not the build target.** This section describes Act v1 ("Challenge"), which is built, tested, and isolation-verified — but as of 2026-09-03 it is a frozen, non-default feature (`act_challenge_enabled` stays off), not the thing being developed further. **"Act" now means "Move"** — see the new § Act / Move section immediately below this one, and `docs/guide/proposals/system-definition-synthesis.md` Part 11 for the full design. This section is retained because the code still exists and is referenced elsewhere in this doc (e.g. § Release gates), not because it's current guidance for new work. Do not extend this implementation; build against § Act / Move instead.

**Original status note, kept for history**: this was in scope for the current build, per an explicit product decision superseding this doc's earlier default (Act was previously deferred behind proven Verify repeat value — see `docs/guide/proposals/system-definition-synthesis.md` Part 6/9 for that history and the corrected design this section implements). This is an addition to the card contract above, not a replacement — every rule above (three-state compression, no severity levels, no trust score, mechanical-vs-AI-inferred labeling) is unchanged and still governs the **evidence record** register described below.

**The decision, precisely**: Verify and Act are two outputs of one Notary invocation, not two separate user journeys or a second button. `review_source_backed_answer` runs both — **as built, Act runs immediately after Verify completes for the same claim, not concurrently with it; that wording was aspirational and didn't match what this feature structurally requires.** Act's entire input is Verify's *resolved* finding (state, applicability comparison, surviving passages) — it generates questions about a finding, so it cannot start before that finding exists. True concurrency (starting before Verify finishes, working from task state rather than a resolved claim) is a different feature — see `docs/guide/proposals/system-definition-synthesis.md` Part 11 ("Move"), which is proposed, not built. Both outputs still return in **one combined card** with two registers, which is the part of the original decision that does hold:

1. **Evidence record** (existing, unchanged) — the authoritative result described everywhere above: exact claim, exact passage, applicability reason, mechanical-vs-AI-inferred label, cost/method line.
2. **"What to pressure-test"** (new) — a compact, clearly visually subordinate section beneath the evidence record. Never present without an evidence record above it; never the first thing the eye lands on.

```text
Notary found 1 material issue

Claim: "Acme's revenue grew 17% in FY25."
Acme's FY25 annual report says revenue increased 12% year over year.
Why: same entity, period, metric, and baseline; the value conflicts.
Resolution: exact match.

[Open evidence] [Replace with 12%] [Qualify] [Dismiss] [Recheck]
─────────────────────────────────────────
What to pressure-test
· Is "revenue" gross or net in the cited passage? [Clarify claim]
· No independent source was supplied for the causal framing. [Add source]
```

**Why concurrent-but-subordinate is a different thing from the "opens automatically" failure mode named in the synthesis doc's Part 6.** That failure mode is about a *separate, competing surface* stealing attention from the evidence result — a second panel, a second button someone has to notice and click, or a transcript that grows more persuasive than the quiet result above it. A single card with an unmistakable visual hierarchy (evidence record primary, challenge layer secondary, always in that order, never inverted) is a different design — this section exists specifically to write down why that distinction is load-bearing, so it isn't re-litigated as a contradiction later.

**Act is explicitly NOT `start_exploratory_review`/§ Exploratory review below.** That feature (an open-ended transcript between Claude and the judge) stays exactly where it already was — Phase 2+, deferred, not built. Act/Challenge is the narrower, safer design the synthesis doc's Part 6 argues for *instead of* an open transcript: typed, bounded, no free-form conversation, no verdict field. Building Act does not pull Exploratory Review's timeline forward.

**Output contract** (from the synthesis doc Part 6, adopted as-is): each challenge item is
```ts
{
  challenge_type: "ambiguity" | "missing_assumption" | "alternative_interpretation" | "evidence_request" | "adversarial_test",
  prompt: string,          // a neutral, bounded question — never a leading question that smuggles an assertion
  why_it_matters: string,  // conditional explanation tied to the existing claim/finding, never a free-standing opinion
  action: "clarify_claim" | "add_source" | "open_evidence" | "ask_host" | "draft_test" | "leave_unchanged",
}
```
No `verdict`, `confidence`, `answer`, or free-form transcript field, ever — same strict-parsing discipline `engine/src/judge/fieldExtraction.ts` already applies to the Verify judge (a sneaked-in field is rejected, not silently accepted). **Cap: at most 2 challenge items per material claim, at most 4 per invocation** (product decision, keeps the layer scannable and prevents it from out-growing the evidence record it's subordinate to).

**Action routing reuses the existing app-only tool contract** (§ Tool and UI contract, above) wherever it already fits — `add_source` for `evidence_request`, `open_evidence` for pointing at existing material, `qualify_claim` for `clarify_claim` (closest existing match; revisit if a distinct tool turns out to be needed once this is built), `recheck_claim` after any of the above changes something. `ask_host` and `draft_test` don't yet map to an existing tool — new, minimal additions if the challenge generator actually produces those action types in practice, not built speculatively ahead of need.

**Authority invariant, restated for this specific addition**: Act may propose a clarification or an additional source. It cannot itself add evidence, alter the manifest, or write `Claim.state` — every write it triggers routes back through the ordinary claim-revision or source-pointer machinery like a user-initiated action would, per the existing authority rule (§ 6 of the canonical product definition). Act running concurrently with Verify does not change this: it is a second **output** of one invocation, never a second **writer**.

**Feature-gated at the organization level** for initial rollout — ship dark first, per the existing "not yet validated" posture on the whole product (no held-out eval gate exists yet, see `docs/build/architecture-and-progress.md`).

