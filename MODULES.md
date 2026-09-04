# The module map

For infrastructure, domains and deploys, see `OPERATIONS.md`.

Read `CLAUDE.md` first for the vocabulary (Verify / Act / Challenge / Move) and
the one authority rule. This file is the map: what each directory owns, what it
may import, and where its tests are.

**The layering is enforced, not described.** `engine/scripts/check-boundaries.ts`
runs as the first step of `npm test` and fails the build on an upward or
sideways import, or on anything but `review/` importing the state machine. If
you disagree with a rule, change the `LAYERS` table in that file deliberately —
don't work around it.

---

## The two halves of an invocation

```
                     one Notary invocation
                              │
              ┌───────────────┴───────────────┐
              │                               │
           VERIFY                            ACT
    deterministic, decides            judged, never decides
              │                               │
   verification/ + detect/            act/ + judge/challenge*
              │                          ┌────┴────┐
              │                     CHALLENGE     MOVE
              │                    (questions)  (next actions)
              │                               │
              └───────────► review/ ◄─────────┘
                        orchestrates both
                              │
                           routes/
```

Verify runs first and commits. Act runs after, reads what Verify produced, and
writes only to its own tables. **Act cannot assign a claim state** — that is
enforced by `check-boundaries.ts` and asserted statically by
`judge/challengeIsolation.test.ts`, not left to review discipline.

---

## Engine modules

Layer numbers are from `scripts/check-boundaries.ts`. A module may import from a
**strictly lower** layer only — never sideways, never upward. Sideways is barred
because two same-layer modules that import each other can't be read
independently, which is the whole point of the layering; when they genuinely
need to share something, the shared thing moves down (see `verification/valueUnit.ts`
and `quotas/usage.ts`'s `ModelCallRecord` — both are that fix, applied).

| L | Module | Owns | May import |
|---|---|---|---|
| 0 | `verification/` | **The deterministic core.** `stateMachine.ts` (the only thing that can assign a claim state), applicability, normalization, immaterial-ambiguity, value/unit parsing. Imports **nothing** — it must be auditable without reading a line of model-calling code. | — |
| 0 | `quotas/` | Spend ledger and the quota gate every model call passes. | — |
| 0 | `evidence/` | Locators — building, resolving, re-dereferencing. | — |
| 0 | `auth/` | API keys, org resolution. | — |
| 0 | `billing/` | Stripe entitlement state. | — |
| 0 | `observability/` | Structured logging. | — |
| 0 | `middleware/` | Rate limiting. | — |
| 0 | `test/` | Test-only DB helpers. | — |
| 1 | `detect/` | **Verify's detector bank** — findings (blatantly wrong) and gaps (couldn't check). Deliberately has no `state`/`verdict`/`confidence` field; a test asserts this. | `verification`, `observability` |
| 1 | `ingestion/` | Fetching sources safely, resolving them to canonical text, delimiting untrusted text before it reaches a model. | `evidence` |
| 2 | `judge/` | **The model transport.** DeepSeek client, kill switch, field extraction, prompt templates — plus `challengeGeneration.ts`/`challengePrompts.ts`, which are Act's Challenge layer. | `ingestion`, `quotas`, `verification`, `observability` |
| 3 | `extraction/` | Pulling material claims out of a Claude answer. | `judge`, `quotas`, `verification`, `observability` |
| 3 | `act/` | **Act's Move layer.** The closed four-move set, intent classification, the six-layer validator, prompt construction, persistence. | `detect`, `ingestion`, `judge`, `quotas`, `observability` |
| 4 | `review/` | **Orchestration.** Owns the one call to `assignState()`. See the breakdown below. | everything below |
| 5 | `routes/` | HTTP. Nothing may import this — it is the outermost edge. | everything below |

`src/db.ts`, `src/migrate.ts` and `src/server.ts` sit directly in `src/` and are
the composition root — exempt from the layer rule by design.

### Inside `review/`

Split out of a single 1341-line file so each piece answers one question:

| File | Question it answers |
|---|---|
| `types.ts` | *What does a review run accept and return?* The wire contract, re-declared on the other side in `server/src/engineClient.ts`. Imports nothing that runs. |
| `reviewFlow.ts` | *How is a claim verified?* The nine-step deterministic pipeline and the single `assignState()` call. |
| `actForClaim.ts` | *What does Act do with a committed finding?* Both layers — Challenge and Move. Neither function can throw; a failure degrades to zero output over an intact Verify finding. |
| `lifecycle.ts` | *Did the checks actually run?* Claim lifecycle state, strictly orthogonal to `claim.state`. |

---

## The other packages

| Package | What it is |
|---|---|
| `server/` | The MCP server Claude talks to. `server.ts` holds the tool description — **trusted config**. `engineClient.ts` translates engine output into the card's shape. Note the boundary: a tool *description* is trusted, a tool *result* is data. Never put instructions to Claude in a result. |
| `ui/` | The review card (React), built to one inlined HTML file. Renders in a sandboxed iframe below Claude's answer — it has no access to the host DOM, so it cannot annotate the answer itself. |
| `dashboard/` | Next.js customer dashboard. |
| `status-page/` | Static build-status page. |
| `engine/migrations/` | Applied, append-only. **Never edit an applied migration's SQL** — add a new one. `0012`–`0014` still contain the retired Track 1/Track 2/Advance vocabulary because they are history; `0016` renamed everything and says so. |
| `engine/eval/` | Measurement harnesses (detector hit rate, Arena finding rate, adversarial move eval). These cost real model calls — read the header of one before running it. |
| `engine/scripts/` | Operational scripts, plus `check-boundaries.ts`. |

---

## Running things

```bash
cd engine && npm test          # boundaries check, then 428 tests
cd engine && npm run boundaries # just the layer rules
cd engine && npx tsc --noEmit
cd server && npm test
cd ui && npm run build
```

Tests need a real Postgres — they are not mocked, deliberately. If `DATABASE_URL`
is unreachable, ~19 tests fail with `ECONNREFUSED` and that is the only symptom
you get:

```bash
docker run -d --name notary-pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=notary_check postgres:16
docker exec notary-pg psql -U postgres -c "CREATE ROLE $USER LOGIN SUPERUSER;"
cd engine && npm run migrate
```

**Known flake:** a handful of tests in `review/` and `judge/` call DeepSeek for
real. Under the full suite's parallelism one of them occasionally fails on
network timing — a different one each time, passing in isolation. A single red
live-judge test is very likely this, not a regression. Re-run before
investigating; if it reproduces on the same test twice, it is real.

---

## Things that are true and easy to get wrong

1. **Only `verification/stateMachine.ts` assigns a state, and only `review/`
   calls it.** A model may propose; a record earns a state through an
   evidence-bound procedure. This is the product, not a style preference.
2. **A tool result is data, not instructions.** Guidance for Claude belongs in
   the tool *description* in `server/src/server.ts`. Instructions embedded in a
   result have been correctly refused by Claude as prompt injection — that was
   a real incident here, not a hypothetical.
3. **"Deployed" is not "running."** Seven features in this codebase were built,
   deployed, confirmed live, and did nothing. Verify against production rows,
   not against the card.
4. **Two individually correct components can cancel.** The self-contradiction
   detector was unreachable for days because the extractor over-populated a
   field the detector required agreement on. Both were right alone. The test
   suite was green throughout.
5. **Fixtures cleaner than production hide the failure entirely.** Claim
   extraction was truncating on 20–40% of real answers while every fixture
   passed.
