# How Notary actually works

One pass, start to finish, as the code runs **today**. No history, no plans —
if something here is out of date that is a bug in this file.

Vocabulary is in `CLAUDE.md`. Layout is in `MODULES.md`. This is the flow.

---

## The one constraint everything follows from

**Notary cannot see the conversation.** It is an MCP tool. It gets one payload,
it answers once, and it can never initiate contact. Claude decides whether to
call it and what to put in the payload.

Every design decision below is downstream of that. It is why the tool asks for
so many fields, why the tool *description* carries all the guidance, and why
Notary can never say "wait, show me more."

---

## The whole flow

```
Claude writes an answer
        │
        │  decides to call the tool  (its own judgment — see §1)
        ▼
  review_source_backed_answer(answer_text, source_refs, user_request, …)
        │
        ▼
  server/  (MCP)  ──►  engine/  (HTTP + Postgres + DeepSeek)
        │
        ├─ 1. create review
        ├─ 2. store each source as evidence
        ├─ 3. EXTRACT CLAIMS            1 model call  → N material claims
        │
        ├─ 4. VERIFY, per claim, 4 at a time         ← assigns state
        │       resolve evidence → deterministic pass → judge the residue
        │       → applicability → relation → re-dereference → assignState
        │
        ├─ 5. DETECT + ACT, once per invocation      ← never assigns state
        │       detector bank → findings + gaps
        │       then Move      → 0–2 next actions
        │
        └─ 6. assemble the card
        │
        ▼
  Card renders under Claude's answer.  User clicks a move →
  text lands in their input box → they send it → Claude corrects →
  Claude calls Notary again.        ← the loop; this is the product
```

---

## 1. What Claude is told, and why it's told there

The tool **description** in `server/src/server.ts` is the entire instruction
channel. In order, it tells Claude:

1. **What Notary is** — "an independent checker that runs outside this
   conversation. It cannot see the conversation…" This comes first because
   every field the schema asks for is self-justifying once it's said.
2. **Its two jobs** — find what's blatantly wrong; work out what the user is
   doing and suggest next moves.
3. **That silence is success** — "most calls find nothing — that is the normal
   result, not a failure." Without this, a model reasonably infers that calling
   a checker invites criticism.
4. **What to pass** — the verbatim answer, real sources, the user's own words.
   *"Never invent a citation, a constraint, or context that was not supplied:
   an omitted field is correct, a fabricated one is not."*
5. **When to call** — proactively, on any substantive answer, every time.
6. **What to do with a gap** — attach the source, then call again.

### The rule that cost us a real incident

> **Guidance goes in the tool DESCRIPTION. Never in the tool RESULT.**

The description is trusted configuration the host registers. A tool *result* is
data returned by a third party. An earlier build appended *"Keep calling Notary
proactively…"* to every response, and Claude flagged it as prompt injection
across three separate calls and disregarded it — **correctly**. It was removed.

### What Claude sends

| Field | Why it exists |
|---|---|
| `answer_text` | required — the thing being checked |
| `source_refs[]` | url / title / quoted_excerpt / role. Verify's only material |
| `user_request` | **Act's whole object.** Without it Act has nothing to recommend *about*, and skips rather than guessing |
| `explicit_constraints` | a budget or deadline the move must respect, not restate |
| `prior_attempts` | distinguishes "test" (nothing tried) from "repair" (something failed) |
| `execution_results` | tool output — what the self-report detector checks a "tests pass" against |
| `prior_context` | decisions/constraints Claude chooses to restate |

**`task_mode` is deliberately NOT asked for.** Inferring intent is Act's own job
(`act/intent.ts`). Asking Claude would put a field it skips ~19% of the time in
charge of Act's policy, and make the classification unauditable.

---

## 2. VERIFY — the half that decides

Runs once **per claim**, four claims at a time. `review/reviewFlow.ts`.

1. **Resolve evidence.** Fetch/parse each bound source to canonical text. A
   source that fetched but could not be parsed is *not* readable — that
   distinction is why an unparseable PDF routes to INDETERMINATE rather than
   "your claim is unsupported."
2. **Deterministic pass.** Literal, case-insensitive substring matching only,
   recording exact `[start,end)` offsets. No semantic matching here, ever.
3. **Judge the residue.** Only fields the deterministic pass could not settle.
   One DeepSeek call per field, quota-gated.
   **The judge never sees the claim's asserted value.** It is asked only: is
   this property present / absent / ambiguous / cannot-be-determined? It cannot
   agree with a claim it has not been shown.
4. **Assemble** deterministic findings + judge residue into `EvidenceFields`.
5. **Applicability** — is this evidence even *about* this claim? Entity,
   period, metric, scope, comparator, modality must agree. Deterministic.
6. **Relation** — supports or contradicts. Only for applicable rows.
7. **Re-dereference the locator** against the retained canonical text.
   Resolution that happened once at write time and was trusted forever is not
   resolution.
8. **`assignState()`** → `SUPPORTED` / `CONTRADICTED` / `UNSUPPORTED` /
   `INDETERMINATE`. **This function is the only thing in the codebase that may
   write `claim.state`, and only `review/` may call it** — enforced by
   `scripts/check-boundaries.ts`, not by convention.
9. **Persist** claim + evidence_match in one transaction.

**No source → INDETERMINATE, never UNSUPPORTED.** "We had nothing to check" and
"the evidence didn't support you" are different statements and the second is
the most damaging thing this product could say wrongly. Verified in production:
all 52 UNSUPPORTED claims carry `no_support_after_completed_checks`; every
unsourced claim routes to INDETERMINATE.

---

## 3. THE DETECTOR BANK — Verify's other half

`engine/src/detect/`. Runs once per invocation, inside the `/detect` call. Pure
code, no model calls.

Emits two kinds of **fact**:

- **Finding** — something is blatantly wrong.
- **Gap** — a detector could have run but an input was missing.

A `Finding` deliberately has **no** `state`, `verdict`, `confidence` or `score`
field. A detector that wanted to assign a verification state would have nowhere
to put it. A test asserts this.

Three detectors are registered. Four more are *named* in the type and not
built — restraint, not omission.

| Detector | What it compares | Provenance of its input |
|---|---|---|
| `self_contradiction` | the answer against itself — same entity/metric/period, conflicting values. Requires scope agreement, so "revenue grew 17%" vs "excluding one-time items, 12%" is **not** a contradiction | `model_reported` |
| `self_report` | a success claim against the tool output supplied in the payload — "tests pass" vs a failure in the log | `caller_supplied` |
| `source_gap` | which material claims had **no source of their own**. Per claim, not per review | — |

### owner vs provenance

`owner` says *how* it was concluded. `inputProvenance` says *who vouched for the
input*. They vary independently, and collapsing them overstates independence:

> "Notary compared Claude's claim against the test output **Claude said it got**"

is not the same as

> "Notary compared it against output **Notary observed**."

Both are `computed`. Only the second would be `host_observed`, which nothing can
produce until WATCH exists.

---

## 4. ACT — the half that never decides

Runs **once per invocation**, in the same `/detect` call, after the bank.
`act/runForInvocation.ts`. Two layers:

- **Challenge** — pressure-test questions. Built, tested, and **flag-off in
  production** (`act_challenge_enabled = false`). It does not run today.
- **Move** — 0–2 next actions. This is what's live.

How a Move is produced:

1. **Infer intent** — `act/intent.ts`, a deterministic lexical classifier, no
   model call. An unmatched or tied request returns `general`, which resolves
   to the **full** move set. Abstaining never narrows anything.
2. **Allowed moves** — `act/policy.ts`, keyed on intent × whether Verify found
   something. Closed set: `clarify` / `test` / `compare` / `repair`.
3. **Rank candidates** — findings before gaps, deterministically. Selection is
   code; only the *wording* is judgment.
4. **Build the bounded context** — the user's request, Claude's answer, prior
   attempts, explicit constraints, restated context, and the ranked findings as
   *sentences*. Restated conversation is rendered after established findings and
   labelled "not verified by Notary."
5. **One model call**, then a six-layer validator: closed vocabulary, ≤2 items,
   strict JSON, no extra keys, authority deny-list, request-language test.
   A response that breaks any layer is rejected **whole** — never salvaged.
6. **Persist**, and return moves carrying their database ids.

### The line that makes Act safe

**Act never sees the evidence corpus or the rejected-candidate pool.** It gets
`boundaryText` — one sentence of what Verify established — plus the structured
field deltas. Handing it enough raw material to *disagree* with Verify would
make it a second verifier, and then two things in the system would be entitled
to an opinion about the same evidence.

**Act runs even when Verify has nothing.** Zero claims and zero findings are
valid inputs. That is ~37% of substantive answers, and it is exactly where Act
is the entire product.

---

## 5. The card, and the loop

Three levels of disclosure:

- **L1** — one line, plus any moves. Quiet by default.
- **L2** — what was found, in consequence terms (`"$6.9M vs $8M"`), not
  classification terms.
- **L3** — "See basis": how we know.

A move shows a short imperative label; clicking reveals the full prompt;
clicking again stages it in the user's input box. `sendMessage` **stages, it
does not send** — the user always chooses.

Then the loop, which is the actual product:

> Claude says X → Notary catches X → user clicks → Claude corrects →
> **Notary independently checks the correction.**

Not "Notary found a contradiction." The second pass is the point.

---

## Invariants — break these and it isn't Notary any more

1. **Only `assignState()` writes a state, and only `review/` may call it.**
   A model may propose; a record earns a state through an evidence-bound
   procedure.
2. **The judge never sees the claim's asserted value.**
3. **Act cannot assign a state, add evidence, or alter the manifest.**
4. **A tool result is data, not instructions.** Guidance belongs in the tool
   description.
5. **No source is INDETERMINATE, not UNSUPPORTED.**
6. **A detector emits facts. Only Act turns a fact into an action.**

---

## Known gaps in this mechanism

Not hidden here — the full list with numbers is `ROADMAP.md` § Priority 1.

- **`/detect` runs after the claim loop, not alongside it.** Act does not need
  Verify's verdicts, so this is pure latency.
- **The field-extraction loop is a cartesian product.** One real answer cost
  286 judge calls, 94 seconds and 9.5¢ — and produced zero matches.
- **The endpoint `/detect` is misnamed.** It runs Verify's detector bank *and*
  Act's Move call, so the word straddles the one line the vocabulary otherwise
  keeps clean. The module `detect/` is named correctly; the route is not.
