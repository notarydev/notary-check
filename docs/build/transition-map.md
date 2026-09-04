> Status: canonical
> Owner: Hardyk
> Last verified: 2026-09-03
> Supersedes: —

# Transition map — from what's built to where this is going

The other four docs each answer one question. This one answers the
question *between* them:

> **Is what we have built shaped so it can become what we said we're
> building — and do the docs and the code still tell the same story?**

Two jobs, both meant to be re-run rather than read once:

1. **Structural readiness.** Which parts of today's CHECK build are on
   the path to WATCH/CAPTURE and must not be casually broken, which parts
   are placeholders that will be replaced, and which decisions would
   *foreclose* the vision if made carelessly.
2. **Sync.** A concrete procedure for keeping `docs/` and the code from
   drifting apart, since nothing enforces it automatically.

It deliberately does not restate the vision
([`../guide/canonical-product-definition.md`](../guide/canonical-product-definition.md)),
the rules ([`tier-1-build-and-operating-plan.md`](tier-1-build-and-operating-plan.md)),
the facts ([`architecture-and-progress.md`](architecture-and-progress.md)),
or the queue ([`whats-left.md`](whats-left.md)). It reads all four and
reports on the seams.

---

## 1. The target, compressed to its structural requirements

Only what the destination *demands of the schema and code*. The reasoning
is in the vision doc; this is the part that constrains today's build.

| Mode | Status | What it structurally requires |
|---|---|---|
| **CHECK** | Live | One bound manifest, per-claim typed state, exact resolved locators, four states + `no_source`. |
| **WATCH** | Not started | Deterministic interception — a gateway, SDK middleware, or host hook. This is the *only* thing that can ever support an invocation-coverage claim. No amount of prompt biasing substitutes, and none of it may be described as if it does. |
| **CAPTURE** | Not started | A `Decision` object keyed to a business reference; `Attestation`, `Correction`, `BoundaryEvent` entities; `CONFLICTED` and `ATTESTED` states; computed `Standing`; a real payload store; append-only supersession. |

The single most important structural fact about the target: **CAPTURE is
sold on being able to re-open a record months later and have it still
resolve.** Everything in section 2 exists to make that possible, and
everything in section 4 threatens it.

---

## 2. Load-bearing — already on the path, do not casually break

These are not incidental implementation details. Each exists because of
where this is going, and each would be expensive or impossible to
retrofit once there is real data. **Changing any of these is a decision,
not a refactor.**

| What | Where | Why it's on the path |
|---|---|---|
| `claim.lifecycle_state` kept strictly orthogonal to `claim.state` | migration `0011` | WHERE a claim got to vs WHAT the evidence showed. CAPTURE needs both independently — a record must be able to say "this never completed" without that reading as a finding about the world. Collapsing them looks like simplification and destroys the distinction. |
| `evidence.retrieval_status` vs `evidence.parse_status` | `0011` | "Did the bytes arrive" vs "is there readable, locatable content." Only the second licenses a completed check. Conflating them is what turned an unreadable PDF into `UNSUPPORTED` instead of `INDETERMINATE`. |
| `evidence.text_provenance` (`fetched` \| `caller_supplied`) | `0011` | Provenance is a CAPTURE requirement, not a nicety. A record that cannot say who obtained a payload cannot be defended later. |
| `canonical_text_hash` + `locator_resolved` + re-dereference at state-assignment time | `0011` | This is the integrity metadata that makes "reconstruction" a real claim rather than a hope. A locator computed once at write time and never re-resolved proves nothing months later. |
| `payload_revoked_at` and the revocation purge | `0011` | Honest deletion: after purge a record must become *unable to re-resolve*, never quietly keep rendering. Canonical § 8. |
| `policy_version`, `evaluator_version`, `prompt_version` on stored rows | `0003`, `0012`, `0013` | Controlled re-evaluation needs to know which procedure generation produced a result. Without it, re-running a check later measures nothing. |
| `claim.state` CHECK deliberately excludes `CONFLICTED` / `ATTESTED` | `0003` | With a comment saying a later migration extends it when CAPTURE is built. This is designed-for, not an oversight — do not "fix" it by widening the constraint early. |
| Non-authoritative output lives in its own tables, never on `claim` | `0012`, `0013` | `challenge_item` and `advance_suggestion` have **no** verdict, confidence, or score column, so a smuggled field has nowhere to land even if it passed validation. The separation makes one class of mistake require a deliberate JOIN rather than a forgotten WHERE. |
| The four-move `CHECK` constraint on `advance_suggestion.move` | `0013` | The closed vocabulary is enforced in the database independently of the validator, so a future caller that bypasses the validator still cannot invent a fifth move. |
| `advance_enabled` read before any client construction | `0014`, `reviewFlow.ts` | Per-customer rollout, and a disabled org costs exactly zero model calls — not a call whose result is discarded. |

**The pattern worth naming, because it is the thing to preserve:** every
one of these puts a rule in *schema or code structure* rather than in
convention or prose. That is the same discipline the product enforces on
models — propose freely, but authority is structural — applied to its own
implementation. A new subsystem that cannot state its rules structurally
is not ready.

---

## 3. Placeholders — known stand-ins, expected to be replaced

Not problems. They become problems only if something starts depending on
them as if they were permanent.

| Placeholder | Stands in for | What must be true when it's replaced |
|---|---|---|
| `evidence.resolved_text` (migration `0006`) | A real object/payload store (S3-equivalent) | Migration `0006`'s own comment says this explicitly. Retention policy and honest deletion must survive the move — a purge has to purge the real store, not just the column. |
| `Review` | The `Decision` object | A Decision is keyed to a business reference and a party role, and begins where accountability changes hands — not at every invocation. `Review` is per-invocation, so this is a real remodel, not a rename. |
| Page-level PDF locators | Bounding-box locators | The text API exposes no glyph geometry, so an (x, y, w, h) rectangle is deliberately not faked. Whatever replaces it must keep that honesty. |
| `json_path` locator kind, real and tested, with no producer | Structured-evidence ingestion | The coordinate system exists; the MIME allowlist admits HTML and PDF only. Wire the producer, don't redesign the locator. |
| In-process rate limiting and the in-memory org cache | Shared/distributed limits | Both are documented "sufficient for a single instance." They stop being sufficient the moment there are two engine instances behind a load balancer. |

---

## 4. Foreclosure risks — what would cost us the vision

Ranked by how expensive the mistake is to undo. Each is cheap to avoid
now and very expensive later.

1. **Any detector that writes `Claim.state`.** The entire product is one
   sentence — *a model may propose; a record earns a state only through an
   evidence-bound procedure*. A detector pool multiplies the number of
   places this could be violated. The defence is structural: every new
   detector must declare what the model produces, what code decides, and
   what it may never write, enforced in schema.
2. **Erosion by accretion.** No single detector breaks the authority
   boundary; several, each drawing the line slightly softer, collectively
   turn Notary into a model that opines with extra steps — while every
   individual review passes. This is the failure mode most likely to
   actually happen, because nothing about it looks wrong at any single
   step.
3. **Retention without consent** (`whats-left.md` B4). CAPTURE is sold to
   regulated buyers on compliance. A retention violation shipped at CHECK
   is not a small local bug — it is a fact about the company that a
   procurement review will find. Fix at CHECK scale, not at enterprise
   scale.
4. **An excerpt with no retrievable source reaching a supporting state.**
   `quoted_excerpt` with no URL is the one path a fabrication can enter as
   evidence, because nothing fetches it and nothing can. CAPTURE's whole
   value is that evidence re-resolves months later; an unresolvable
   excerpt cannot, so it must never support anything.
5. **Mutating rows instead of superseding.** Canonical § 8 requires
   append-only correction lineage. One convenient `UPDATE` in a hot path
   is how that gets lost.
6. **Collapsing `lifecycle_state` into `state`**, or widening the state
   CHECK early. See section 2.
7. **Letting a model reconcile its own sub-answers into a verdict.**
   Explicitly ruled out (canonical § 6), and specifically tempting when a
   model produces several independently reasonable pieces.
8. **A fifth card state that is really a score.** No trust score, no
   percentage, no green badge. `not_checked` was added because three
   states could not stay *honest*; that is the only admissible reason to
   add another.
9. **Metrics that silently measure nothing** (`whats-left.md` O3 — the
   cost meter rounds to whole cents, so most calls meter as zero). An
   enterprise buyer audits usage and cost. A meter that reads zero is
   worse than no meter, because it is trusted.

---

## 5. Keeping docs and build in sync

The rule already exists in [`../README.md`](../README.md): **`build/`
updates in the same commit as the code change that makes it true.** The
gap is that nothing enforces it, and the failure is silent.

### 5.1 If you change X, touch Y

| Change | Must update in the same commit |
|---|---|
| A migration | `architecture-and-progress.md` schema section |
| Deploy target, image tag, env var, or service | `architecture-and-progress.md` deploy + domains sections. **Verify the deploy actually landed** — `aws lightsail get-container-service-deployments` — a `.14` was once built, pushed, and never deployed while the docs implied otherwise |
| The MCP tool schema or description | `tier-1-build-and-operating-plan.md` § Tool and UI contract |
| Card states, finding types, or what surfaces | `tier-1-build-and-operating-plan.md` § Engine state → finding type → card state |
| A new detector, move, or model call site | § Track 2 / Advance build order, plus this file's section 2 if it adds a structural rule |
| Judge prompt, model, or version | § Evaluator governance and rollback — **and re-run the pre-pilot gate**, which is a stated release requirement, not a suggestion |
| Anything that finishes, blocks, or reorders work | `whats-left.md` |
| Anything that changes what Notary *is* or may claim | A **proposal** in `guide/proposals/`. Never a direct edit to the canonical definition — see `CLAUDE.md` |

### 5.2 The periodic audit

Run before starting a chunk of work, or every few weeks. Roughly ten
minutes.

```bash
# 1. Do any docs claim something about another file that isn't true?
#    (This has produced real false findings — the arch doc claimed
#     engine/README.md was stale months after it had been fixed.)
grep -rn "still says\|still lists\|not yet\|stale" docs/ | less

# 2. Do all relative doc links resolve?
python3 - <<'PY'
import re, pathlib
for f in pathlib.Path("docs").rglob("*.md"):
    for m in re.finditer(r'\]\((\.\.?/[^)#]+\.md)', f.read_text()):
        if not (f.parent / m.group(1)).resolve().exists():
            print(f"BROKEN {f}: {m.group(1)}")
PY

# 3. Does every doc still carry a status header, and is any canonical
#    doc older than the last shipping day?
for f in $(find docs -name '*.md'); do
  printf "%-56s " "$f"; grep -m2 -E '^> (Status|Last verified)' "$f" | tr '\n' ' '; echo
done

# 4. Migrations on disk vs. what the arch doc says is applied.
ls engine/migrations/ | tail -3

# 5. Dead scaffolding: is anything in package.json imported nowhere?
```

### 5.3 The two failure modes that actually happen

Named because both have already occurred here, and neither looks like an
error at the time:

- **A doc claiming another file is stale, after that file was fixed.**
  The correction lands in one place and the *pointer to it* doesn't. Every
  "X is still wrong" sentence in a doc is a claim with a shelf life —
  verify it by reading the file, not by trusting the sentence.
- **A rule that owes something, where the debt is never collected.**
  "Advance gets its own flag once it has persisted state" sat true and
  unactioned for a day while Advance ran ungated in production. Any doc
  sentence of the form *"X once Y"* is a scheduled obligation — when Y
  happens, X is now overdue. Grep for `once ` in the plan periodically.

### 5.4 What "in sync" does and doesn't mean

In sync means: **no doc asserts something about the code that is false.**

It does not mean every intention is implemented. A canonical rule the
code has not yet met is not drift — it is a **tracked violation**, and it
belongs in `whats-left.md` written as a violation, not softened into
prose that matches what shipped. Editing a rule down to match the code is
the one move that makes the docs useless, because it converts a known gap
into an invisible one.
