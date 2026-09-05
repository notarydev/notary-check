# The road to a real SaaS

One page. What stands between the thing that works today and a product a
stranger can pay for and rely on.
## Which document does what — read this first

There are four status files and they have different jobs. Confusion between
them has been a real cost, so:

| File | Job | Time |
|---|---|---|
| `MECHANISM.md` | How it works right now, end to end. Not a plan and not history — if it is out of date that is a bug. | present |
| **`ROADMAP.md`** (this) | The priority list. **Engine correctness and cost is priority 1; open issues are priority 2.** The index — start here. | future |
| `docs/build/whats-left.md` | The detailed queue, with stable IDs (`B1`, `O4`, `E5`…) and the full argument for each. **This file cites those IDs; it does not restate them.** | future |
| `PROGRESS.md` | The audit trail. Every review pass, every bug found. Append-only history. | past |
| `docs/build/architecture-and-progress.md` | What is *actually* built and live right now, including infra. | present |

How the system actually works, end to end, is in `MECHANISM.md`. Operational
facts — hosts, domains, deploys — are in `OPERATIONS.md`. Code layout is in
`MODULES.md`. Vocabulary is in `CLAUDE.md`.

---
## Where we actually are

Notary Check works. The engine verifies claims against evidence deterministically,
Act suggests next moves, the card renders, Clerk OAuth is live, and the whole
thing runs in production on Lightsail (engine.52 / server.49 as of 2026-09-05,
455 engine tests / 451 passing per the latest commits' runs).

**Speed is solved; correctness is not.** The E-LAT cost/latency fixes are
measured in production (261→52 judge calls per real run — see below). Fetching
real pages is now live (Step 1, engine.52), and diagnostics persist per claim.
**But basic real-world facts still fail**: review `74ea42e8` (2026-09-05, cloud
egress pricing) returned 8/10 claims `required_field_unresolved` even though
"$0.09/GB for the first 10 TB" is verbatim on the fetched page — the engine is
architected for clean single-sentence claims and cannot handle tables, tier
qualifiers, synonyms, or derived totals. **That class is the reason for the
structural rebuild queue in Priority 1 below.**

**And nobody can buy it.** The gap is not the engine — it is everything around the engine.

---

## PRIORITY 1 — The engine: correctness and cost

**This is the top of the list. Nothing below it matters if the engine is
wrong, slow, or expensive.** Everything here is measured from production
rows, not inferred.

### The structural rebuild queue (2026-09-05)

The engine was built around one clean input ("Acme's revenue grew 17% in
FY25") and real content breaks every assumption: multi-atom sentences,
tables, tier qualifiers, synonyms, derived totals. Judge-prompt tweaks will
not fix it — the *unit* (whole-sentence claims) and the *gate* (every field
must literally anchor or the whole claim dies as INDETERMINATE) are wrong.
Detailed arguments and statuses live in `docs/build/whats-left.md`
(**E9–E18**); this table is the order of operations.

| # | Item | Why | Status |
|---|---|---|---|
| **E9** | Real HTML parser + entity decode + table-row intake (replace regex `stripHtml`) | Regex misses escaped markup (`&lt;style&gt;` leaked in prod), has no tables → pricing runs fail. | not started |
| **E10** | Atomic claim decomposition + non-atom quality gate | A sentence is many claims; "not 714M"/"should be corrected" aren't checkable. Kills the noise. | not started |
| **E11** | Core vs qualifier semantics (decision needed) | entity+metric+value match must not be annihilated by an unanchorable tier/scope qualifier. | needs owner decision |
| **E12** | Derived-claim calculator | "$913 for 10TB" is recompute-or-say-derived, never "UNSUPPORTED". | not started |
| **E13** | Bounded concurrency on the judge wave (and evidence fetch) | `Promise.all(rows)` is unbounded — hundreds of parallel calls at scale. | 🔨 IN PROGRESS |
| **E14** | Chunked/parallel claim extraction | Extraction is the remaining 8–18s tail. | not started |
| **E15** | Normalization routing + $/GB / unit/format layer (confirm-only) | "$0.09/GB" should resolve deterministically before any judge call. | not started |
| **E16** | Observation cache + page storage growth / eviction (ties to B4) | Unbounded storage; no TTL. | not started |
| **E17** | Early-return / async card decision (STEP 2 of speed plan) | Users wait on full e2e; groundwork is built but inert. | needs owner decision |
| **E18** | Regression harness over real runs (ground truth) | Without labels every fix ships unmeasured. | not started |

**Order:** E9 → E13 (small, de-risks) → E18 harness → E10 → E12 → E15 → E11/E17 (owner decisions) → E14 → E16.

### The two immediate operator chores (before more test runs)
- Rotate the invalid `CLERK_SECRET_KEY` in the deployed server env and the
  invalid `DEEPSEEK_API_KEY` in local `engine/.env`; close F4 (live keys in
  `.claude/settings.local.json`).
- Decide E11/E17 — the two decisions every other correctness/latency item
  depends on.

### ~~E-LOC~~ — FIXED 2026-09-05 (whitespace-tolerant matching, live engine.48+)

**Was "the top bug". Closed in code and shipped.** The deterministic pass and
the locator now share `findExactSpan` (locators.ts), which normalises runs of
whitespace only — never punctuation or semantics — and returns offsets into the
original text. A field that matches deterministically is therefore guaranteed a
resolvable locator, removing both the wasted model calls AND the
`judge_value_not_found_in_canonical_text` failures this section described. The
diagnosis below is kept as the record; the residual `checks_did_not_complete`
class on real input is the E-EVIDENCE excerpt problem and the scope-locator
mechanism, not byte-exact matching.

Found 2026-09-05 on the first real multi-source test. Review `9cf6a001`:
16 claims, 8 sources, all fetched cleanly (5k–28k chars of text each), and
**every single claim came back `INDETERMINATE / checks_did_not_complete`**. The
card said "Could not verify this against the supplied evidence." Nothing was
verified, nothing was contradicted, 358 judge calls were paid for.

**Cause, from the logs:** `judge_value_not_found_in_canonical_text:metric`, five
times in the visible log window. The judge extracts a field value, and
`evidence/locators.ts:146` then tries to find it in the retained text with

```ts
haystack.toLowerCase().indexOf(needle.toLowerCase())
```

Case-insensitive, and otherwise **byte-exact**. HTML-to-text extraction collapses
whitespace, introduces non-breaking spaces, and breaks lines — so a value that is
genuinely present fails to locate over a single whitespace difference. When it
fails, `hadUnresolvedLocator` is set, `checksCompleted` becomes false, and the
claim is forced to INDETERMINATE.

**Why `metric` specifically:** entity, period and value are short or single-token
and survive. `metric` is a multi-word phrase ("data egress pricing", "internet
egress rate") and therefore spans whitespace — the field most likely to break on
exactly this.

**Candidate fix.** Locate against a whitespace-normalized projection of the
canonical text while still returning offsets into the ORIGINAL text. This keeps
the authority rule intact — the passage really is there, we are not accepting a
model assertion in place of evidence — while surviving the whitespace noise that
HTML extraction unavoidably produces.

Do NOT fix it by adding `metric` to `CLOSED_VOCABULARY_FIELDS`. That exemption
exists for derived values with no literal span; `metric` is open-vocabulary and
should be quotable.

**This likely explains E-RATIO too.** A locator that fails on multi-word fields
would push claims toward INDETERMINATE and UNSUPPORTED regardless of what the
source says.

### E-UI — the card looks like a dev tool, and has no logo

Reported 2026-09-05. The collapsed state renders as `Notary
check_answer` with a `</>` glyph — the raw MCP tool name. It reads
as debug output, not a product. Needs the Notary mark (three connected circles,
on the marketing site) and a human label.

### ~~E-EXTRACT~~ — FIXED. This was the real blocker, not a footnote.

Recorded first as "low frequency". It then caused the ONLY thing the user saw
on two consecutive real tests: `could not verify this against the supplied
evidence` on a fully-sourced answer, with nothing downstream running at all.

```
claim_extraction_parse_failure: model output is not a valid JSON object
claims_extracted  latency_ms: 17698  error_cause: model_output_unparseable
```

17.7 seconds of generation means it ran to the `max_tokens` ceiling and was cut
off mid-object. One clipped claim discarded every claim that had arrived whole,
so no claims were submitted, no evidence was checked, and the speed work,
E-LOC and the moves fix never got a chance to run.

`CLAIM_EXTRACTION_MAX_TOKENS` had already been raised once (1024 → 4096) for
this exact failure. **Raising it again is a treadmill** — there is always a
longer answer. The defect is losing N claims because the (N+1)th was clipped.

Now salvaged: a truncated response yields every syntactically complete claim in
it. Partial objects are DROPPED, never repaired or guessed at, and salvaged
claims face the same schema and the same verbatim-in-the-answer check as any
other. Genuine garbage is still a parse failure.

**Still open, and worth deciding:** whether to cap the claim count in the
prompt. ~16 claims from one answer is what produces both the truncation and the
cartesian product with sources. A cap would bound both. It is a coverage
tradeoff, so it is a product call rather than a bug fix.

#### Original note

One claim-extraction call returned unparseable JSON

`claim_extraction_parse_failure: model output is not a valid JSON object`, once
in the same run. Low frequency, but it silently drops a whole batch of claims
when it happens.

### E-EVIDENCE — we verify against a 19-character snippet, not the page

**Root cause of `checks_did_not_complete`, found 2026-09-05 by reading the
evidence rows rather than guessing.**

On the run where all 18 claims failed to complete, all six sources were
`content_kind = inline_excerpt`, `canonical_url = inline`, and **19 to 224
characters long**. Claude supplied URLs *and* excerpts;
`server/src/engineClient.ts`'s `registerEvidence` sends both and the engine
prefers the excerpt, so the pages were never fetched.

**CORRECTION (2026-09-05, verified against production rows + engine logs).**
The original write-up below claimed "there were no locator failures" and that
`checks_did_not_complete` was "arguably CORRECT" on that input. Production
contradicts both. The persisted `lifecycle_detail` for the same 18-claim run
says **16 of 18 claims were `locator_unresolved`**, only **2 of 18**
`required_field_unresolved`. The logs show
`review_flow_locator_unresolved judge_value_not_found_in_canonical_text:scope`
repeatedly. The cached observation shows why: on a passage mixing two scopes
the judge returned `scope: present` with a **fused, non-literal value**
("internet egress at Premium Tier and Standard Tier" — not contiguous in the
text). The locator correctly refused an unanchored model assertion and the
claim died by that mechanism, not by abstention. Thin excerpts are a real
contributor, but they are not the recorded mechanism of these failures.

Nor is the engine merely "honest" on thin input: the same day, review
`900530a5` (Pacific Ocean, three cited sources) completed its checks and
returned **UNSUPPORTED for a claim the evidence states almost verbatim**
(Geology In: *"The Pacific Ocean contains approximately 714 million cubic
kilometers (171 million cubic miles) of water"*). That is a **false negative**
on real, supportive evidence — the state machine's word, not a shrug. The
open questions are therefore three, not one:
(i) intake — fetch the cited page, keep the excerpt as locator hint/fallback;
(ii) the judge's `scope` (and general) contract — a passage naming several
readings must answer `ambiguous` + candidates, never a fused `present`;
(iii) routing — "50.1 percent" vs claim "50.1%" should resolve through the
existing `VALUE_PERCENT_V1` normalization before the judge is asked at all.
And none of it is diagnosable from the DB today: `claim_fields` and
`rejectedCandidates` are returned per request and never persisted (see
E-MEAS's original framing — it closed only the detector half).

**Preferring the excerpt was a deliberate decision** and the comment defends it:
an excerpt is text somebody actually had, while a URL may be paywalled, may
have changed, or may never re-fetch. That reasoning is sound for provenance and
wrong for verification, because verification needs context the excerpt does not
carry.

**Proposed fix — NOW IMPLEMENTED AND DEPLOYED (2026-09-05, engine.52).** When a URL
is present, review-time resolution fetches the page and verifies against it,
keeping the excerpt as `evidence.caller_excerpt` and as the fallback when the
fetch fails or yields no text; a caller excerpt with no URL is unchanged.
Fetches measure 10–250ms, so the latency cost is small.
**Full design, sequencing, and the second two fixes (the scope judge contract
and normalization routing): [`docs/guide/proposals/evidence-index-and-retrieval.md`](docs/guide/proposals/evidence-index-and-retrieval.md).**

**Open question for the owner:** should an excerpt too thin to establish the
claim's fields be reported as a GAP ("this source is a snippet — the page would
let me check it") rather than silently becoming INDETERMINATE? That is probably
the more honest card either way.

### Speed — the plan, ready to hand to anyone

**Executable spec: [`docs/build/speed-implementation-plan.md`](docs/build/speed-implementation-plan.md)**
— written to be run by someone with no memory of the conversation that produced
it. Non-negotiables, what is already done, build order, and a definition of done
in measurable numbers.

**It opens with STEP 0: measure before building.** The two most recent commits
delete model calls rather than speeding them up, and may already be enough —
steps 3 and 4 are weeks of work that could turn out to be unnecessary. Baseline
to beat: 21 claims, 5 sources, 270 judge calls, 21s.

**Correctness comes before speed in that plan**, because two things are known
broken: 18 of 21 claims return `checks_did_not_complete`, and a live
self-contradiction finding was a FALSE POSITIVE that Claude acted on.

**Both moved 2026-09-05.** The false positive is FIXED — a tier, plan or variant
is now extracted into `scope`, which is what `couldCompare` needs to refuse the
comparison; two regression tests assert both halves (tiers do not conflict, the
same tier at two prices still does). And `checks_did_not_complete` was expected
to share the call volume's root cause: making `deterministicPass`
whitespace-tolerant produced SUPPORTED on a local run where everything used to
abstain.

**That did NOT confirm against production.** The post-fix production runs
(05:27: 18/18 INDETERMINATE; 10:40 Pacific: 1 UNSUPPORTED + 1 INDETERMINATE)
show the whitespace fix did not clear `checks_did_not_complete` on real input —
the binding constraint there is the evidence itself (19–224 char excerpts) plus
the scope-locator mechanism, not byte-exact matching. See the **E-EVIDENCE**
correction above; the local "SUPPORTED" was on short, clean, synthetic sources.

### Speed — the option set

Every latency fix so far has helped and none has solved it, because the shape
of the problem is "a large language model in every step". The options, what
each actually buys, and what to do first:
**[`docs/build/speed-and-streaming.md`](docs/build/speed-and-streaming.md)**.

Short version: stream progress and verify asynchronously (feels instant at any
input size), match plain numbers without a model at all (deletes calls rather
than speeding them up), and only then consider retrieval and a small entailment
model.

### ~~E-LAT~~ — FIXED 2026-09-05, MEASURED IN PRODUCTION

Both halves shipped, and the saving is now measured from production rows
(review `9f3958a6` 05:14 vs review `891ee8f5` 05:27, `usage_event`):

| | 05:14 | 05:27 |
|---|---|---|
| claims | 12 | 18 |
| judge calls | 261 | 52 |
| per claim | 21.8 | 2.9 |
| review wall (created→complete) | 31.0s | 10.7s |
| metered cost | 9.70¢ | 1.93¢ |

**7.5× fewer calls per claim, cost roughly 5× lower, on more claims.** The
judge phase itself is near the floor when the observation cache hits (review
`900530a5`, 10:40: **10 judge calls in a 0.19s span, 4.5s total, 0.35¢**).
Remaining wall-clock is dominated by the single claim-extraction call
(4–18s) plus the detect/finalize tail — not the judge.

```sql
-- judge calls per claim, per review. The old number was ~20.
SELECT r.id, count(DISTINCT c.id) AS claims, count(u.id) AS judge_calls,
       round(count(u.id)::numeric / NULLIF(count(DISTINCT c.id),0), 1) AS per_claim
FROM review r
LEFT JOIN claim c ON c.review_id = r.id
LEFT JOIN usage_event u ON u.review_id = r.id AND u.event_type = 'judge_call'
WHERE r.created_at > now() - interval '1 day'
GROUP BY r.id ORDER BY judge_calls DESC LIMIT 10;
```

Baseline to beat, from review `f6dd5300`: **14 claims, 286 judge calls, ~20 per
claim, 94 seconds, zero matches.**

- **E-LAT-a — entity fail-fast.** Entity is asked first and alone; a row whose
  entity comes back `absent` skips its remaining fields. Implemented as an
  ordering change, NOT a substring pre-filter, so `"Acme, Inc."` vs `"ACME INC"`
  still resolves through normalization.
- **E-LAT-b — the rest in parallel.** Independent questions about the same text.

The subtle part, and the reason this could have been a regression: skipped
fields must not set `hadAbstainedRequiredField`, or a claim flips from
UNSUPPORTED to INDETERMINATE ("checks did not complete") when the checks
completed fine and simply did not apply. Guarded by a distinct sentinel, with a
regression test asserting both the call count AND the unchanged verdict.

#### Original measurement — One answer cost 286 model calls, 94 seconds and 9.5¢

Measured on review `f6dd5300` (2026-09-04), the first real-world test:

| | |
|---|---|
| Claims extracted | 14 |
| Evidence rows | 4 |
| Judge calls | **286** |
| Evidence matches produced | **0** |
| Wall clock | **94s** — the tool call blocks Claude's turn the whole time |
| Cost | 9.5¢ for a single answer |

286 ≈ 14 claims × 4 evidence rows × ~5 residual fields. It is a **cartesian
product**, and on this review every single call was wasted — not one match
survived applicability.

`review/reviewFlow.ts:459` is `for (const field of row.residuals) { await
extractField(...) }` — fully sequential, nested inside a sequential loop over
evidence rows. Claims run 4-wide (that was E2), which is the only reason this
was 94 seconds rather than ten minutes. **E2 parallelised across claims, not
the inner field loop** — an external reviewer flagged exactly this and was
right.

Two fixes, in value order:

**E-LAT-a — fail fast on entity.** The bigger win, because it removes calls
rather than speeding them up. Entity disagreement alone disqualifies a
claim-evidence pair, so extract entity FIRST; if the judge cannot find it in
that source, skip the remaining ~4 fields for that pair.

> **Do not implement this as a substring pre-filter on entity.** That is the
> tempting version and it breaks `"Acme, Inc."` vs `"ACME INC"` — precisely the
> normalization case E1 exists to fix. The judge must still decide; it just
> decides that field first.

Caveat to write down when doing it: skipped fields must be recorded explicitly
(`skipped_entity_mismatch`), not left silently blank, or `rejectedCandidates`
detail in L3 quietly thins out. The claim's STATE is unchanged either way —
entity mismatch drops the row regardless.

**E-LAT-b — parallelise the residual fields.** They are independent questions
about the same text. Bounded `Promise.all`.

Expected together: 286 → ~60 calls, 94s → ~15s. Both numbers should be
re-measured from `usage_event`, not assumed.

### E-RATIO — UNSUPPORTED is 45.6% of all claims, 3.5× SUPPORTED

Production distribution over 114 claims:

```
UNSUPPORTED     52  (45.6%)   all "no_support_after_completed_checks"
INDETERMINATE   35  (30.7%)   30 of them no_source
SUPPORTED       15  (13.2%)
CONTRADICTED    12  (10.5%)
```

Either Claude genuinely makes that many unsupported claims, or the
applicability comparator is too strict and is rejecting valid claim-evidence
relationships. The same external review flagged this risk independently.

**Answerable today from rows already in the database** — no new instrumentation
needed. Start with the `rejectedCandidates` on UNSUPPORTED claims and look at
which field caused the rejection.

The state machine itself is confirmed CORRECT: no claim is reported
UNSUPPORTED when the truth is "no source" — unsourced claims route to
INDETERMINATE. That was checked directly and is not the concern here.

### E-EVID — Only 27 evidence matches for 114 claims

Most claims never get a source at all. This is the product's real ceiling:
Verify can only speak when there is something to check against, and today
there usually is not. It is why the source-gap ask and Act's coverage matter
more than any additional detector.

### ~~E-MEAS~~ — FIXED 2026-09-05. Findings and gaps are now persisted

**Live and verified in production 2026-09-05** (`engine.42`): a detect run wrote
1 finding and 2 gaps, with `detector = self_contradiction`, `missing =
addressable_source`, and `input_provenance = model_reported` all recorded
correctly.

Migration `0017` adds `finding` and `gap`. Written on every `/detect` call,
before Act runs so an Act failure cannot cost the measurement. Separate tables
deliberately — a gap is not a weak finding, and one careless SELECT should not
turn "we had nothing to check" into a defect.

**Nothing reads these tables yet, and they hold one real row.** The fire-rate
query they exist for is written below but is not worth running until real
traffic has accumulated:

```sql
SELECT detector, count(*) FROM finding GROUP BY detector;
SELECT missing, count(*) FROM gap GROUP BY missing;
```

#### Original: findings were never persisted (was S4)

There is no `finding` table, so nothing measures which detectors ever fire in
production. After 91 reviews we cannot say whether the detector bank earns its
place. `detection.outcomes` is now logged (`detect_completed`), which is a
start but is not queryable state.

Related and now closed: move interaction telemetry exists in code — see F1, it
is built and not deployed.

### E-VERIFY — Two fixes are proven only by unit test

The **claim-level source gap** and **Act's restored context** both ship in
`engine.37` and neither has live evidence. The smoke test cannot exercise the
first, because all its claims are ungrounded and the old code would pass it
too. See F3 for the prompts written to test them.

---

## PRIORITY 2 — Open issues, half-finished work

Picked up mid-stream on 2026-09-04. None of it is blocked on a decision; it is
blocked on finishing.

### F1 — ~~main is ahead of production~~ CLOSED 2026-09-05 (re-verified 2026-09-05 later run)

Everything on `main` is deployed. Live at last check (Lightsail API):
`:notary-check-api.engine.51` (deployment 24) / `:notary-check-mcp.server.49`
(deployment 27), migrations through `0019` — including the E-LAT fixes, the
`evidence_field_observation` cache (0018 re-keyed on text by 0019), the
whitespace-tolerant matching, and the `checks_did_not_complete` diagnostic.

Verified against production, not against the deploy's exit code:

- version numbers incremented (a failed Lightsail deploy rolls back silently)
- the detector bank and Act both answer live
- **the invocation path now persists** — `act_invocation` rows with
  `claim_id IS NULL` went 0 → 2, with 3 moves attached. Every move shown to a
  user before this deploy was unrecorded.
- `POST /v1/move-events` returns 401 unauthenticated, so it is routed and
  auth-gated rather than missing.

`act_move_event` is no longer empty: real conversations through the connector
have produced `shown` events (observed 2026-09-05 05:26, org `898a0428`). If it
goes quiet again while cards render, the card wiring is the suspect.

Re-check this any time with:

```bash
aws lightsail get-container-services --region us-east-2 \
  --query 'containerServices[].{n:containerServiceName,v:currentDeployment.version,img:currentDeployment.containers.*.image}'
git log --oneline <commit-that-built-the-live-image>..HEAD
```

### F2 — The deploy gate fails and has not been reproduced

`./scripts/deploy.sh` runs the engine suite before building, and it failed
twice on the owner's machine with the script's own "probably the DeepSeek
flake" message. **That message has already been wrong once** — the first
failure was a real, deterministic quota-test bug (`5c07734`).

The suite passes twice consecutively here (435/435). The failing test name was
never captured, so this is unresolved rather than fixed. **Get the name
first:**

```bash
cd engine && npm test 2>&1 | grep -E '^not ok|^# (pass|fail)'
```

If it reproduces identically twice it is real, whatever file it is in.
`SKIP_TESTS=1 ./scripts/deploy.sh both` bypasses the gate if the code is
otherwise verified — but only with that reasoning stated, not by reflex.

### F3 — Live testing is underway, results not yet in

Seven scripted prompts were handed to the owner to run through the real
connector, each probing one thing with a named failure signature. The two that
matter most:

- **Mixed grounding** (one cited claim beside uncited ones). The claim-level
  source-gap fix is proven only by unit test; no live case has exercised it,
  because both claims in the smoke test are ungrounded and the old code would
  have passed too.
- **Constraint + prior attempts** — does a move respect a stated budget and
  avoid re-proposing what was already tried? Act saw neither field until
  `7584e7e`.

And the one the product actually rests on: **the closed loop** — finding →
move → Claude corrects → re-check → the original finding is gone. If that works
twice in a row it is demonstrable; nobody has yet run it end to end.

### F4 — Secrets are sitting in a settings file

`.claude/settings.local.json` contains a **live production database URL with
its password** and an `sk_live_` Clerk key, embedded in permission rules.
Rotate the Clerk key and move both out. This is unrelated to every other item
here and is the only one with a security consequence.

---

## PRIORITY 3 — Proving it works

Today "it works" rests on a passing test suite and hand-checked examples.
That is not the same claim.

| | What's missing |
|---|---|
| **B1** | **The held-out eval set is 20 unadjudicated drafts.** The pre-pilot gate's thresholds are literally blank because there is no labelled data to set them from. Needs human annotators — **no engineering path around this.** |
| **B2a** | The flagship two-block contradiction returns a single finding against the live connector. Found, never diagnosed. |
| **B5** | 17 of the 18 locked cases have never been run against the *live* deployment, only locally. |
| **S5b** | **`inputProvenance` is set but never persisted or surfaced.** The semantics are now correct in memory; no row records them and the card does not distinguish a finding computed over observed material from one computed over Claude's own report. |
| **S4** | **Findings are not persisted.** There is no `finding` table, so nothing measures which detectors ever fire in production. We cannot answer "is the detector bank earning its place." |
| ~~**O2**~~ | ~~`act_move_event` is written by nothing.~~ **RESOLVED 2026-09-04** — the card now records shown / revealed / committed / dismissed through a `record_move_event` app tool. The root cause was deeper than the missing write: the invocation-level Act path persisted nothing at all, so there was no row for an event to reference. |

S4 is the same shape as O2 was: we ship things and then cannot tell whether they
did anything. That pattern has already cost this codebase seven features that
were built, deployed, confirmed live, and silently inert.

---

## PRIORITY 4 — Making it useful more often

Measurement says Verify alone has something to say on at most ~19% of real
turns. Act was built to cover the rest. Making both fire more often, and more
usefully, is the product work.

| | What's missing |
|---|---|
| **E4** | **Ask for a missing source**, two ways — response text plus a card button. Needs an **ask ledger**: today an ignored gap would repeat on every single invocation. |
| **E5b** | **Give Move the finding's STATE.** (E5a — the field-delta handoff — shipped in `engine.37`.) `act/prompt.ts` contains zero per-state guidance; verified, not assumed. It sees one sealed sentence and must infer what kind of mismatch happened. |
| **S5** | **The intent classifier is weak** — it defaults to `general` on obviously classifiable input, which resolves to the full move set and constrains nothing. |
| **S6** | **Act has no detector bank of its own** (deferred deliberately). Verify has three detectors; Act has none. |
| **S7** | Deferred Verify detectors: arithmetic (6.7% of turns), requirement (2.3%), drift, overreach. |

---

## PRIORITY 5 — Someone can pay for it

Nothing here is hard. It is simply absent, and it is the whole difference
between a demo and a business.

| | What's missing | Detail |
|---|---|---|
| **S1** | **There is no sign-up flow.** Every call to action on `getnotary.ai` goes to a contact form. No sign-up, no pricing page, no checkout. | `OPERATIONS.md` |
| **S2** | **The dashboard is deployed nowhere.** `app.` and `dashboard.getnotary.ai` do not resolve. The Next.js app exists and builds. | `OPERATIONS.md` |
| **S3** | **Stripe is in test mode.** The live-key swap is env-only, but no live payment has ever been taken end to end. | `whats-left.md` § Billing |
| **O5** | Clerk Restricted sign-up mode not confirmed — the IdP-level half of the signup gate. Manual dashboard action. | `whats-left.md` |
| **L1** | **Terms and Privacy Policy do not exist.** Needs a lawyer. The Privacy Policy must disclose that evidence text goes to a third-party model. | `whats-left.md` § Legal |
| **B4** | **Retention violates our own canonical rule** — `claim.text` and `evidence.resolved_text` are kept indefinitely, no consent, no TTL. Blocks L1, because the policy would have to describe a retention rule that doesn't exist. | `whats-left.md` |

**M1 is blocked on L1/B4 for *public* self-serve.** An invited, paid pilot is
not — that path needs only S1–S3 and O5.

---

## PRIORITY 6 — Someone else can operate it

| | What's missing |
|---|---|
| **S8** | **No `/healthz` or `/readyz`** on either service. Nothing can tell whether a deploy is healthy except a smoke test run by hand. |
| **S9** | **No CI.** Tests run only when a human remembers. |
| **S10** | **No staging environment.** Every change is verified locally and then goes to production. |
| **S11** | **Rollback never drilled.** Lightsail rolls back on a failed deploy; we have never exercised a deliberate one. |
| **S12** | Datadog key is set; **ingestion never confirmed**. |
| **S13** | **No named incident owner, no support inbox, no billing-support owner.** |
| **O4** | Quota check is read-then-decide, not atomic. Low risk at current volume, real at scale. |

---

## Everything else still open

Small or blocked items, kept here so nothing open lives only in
`docs/build/whats-left.md`. Detail and full argument are there.

| | Item |
|---|---|
| **O6** | Profile Preferences copy was written and tested and never added to the onboarding page — a user has never seen it. |
| ~~**D4**~~ | **Handled 2026-09-05** — the brief now opens with a stale banner pointing at `MECHANISM.md`. Kept rather than rewritten, because past reviews cite its sections. |
| **E6** | Retention — same item as **B4** above. Kept as a separate engine-queue entry in `whats-left.md`; do not treat as two pieces of work. |
| **E7** | Decouple Verify and Act properly. Needs the revision step and a channel to update the card after first render; neither is optional. **Do not do this for latency** — E-LAT is the latency fix and dominates it. |
| **E8** | Reconcile. Depends on E7 *and* on the invocation pivot being decided. Not before. |

---

## Open questions that redirect the work

Not tasks — answers here change what gets built.

- **Research or coding?** Claims about code are checkable against a repo or a
  test run, not a document, and are excluded by the current claim definition.
  So for research Verify fires constantly; for coding it is near-silent. This
  determines what Notary *is*, and it has not been chosen.
- **Does silence need a marker?** Nothing tells a user that Notary ran and
  found nothing. Silence is indistinguishable from never having been called.
- **What counts as a claim?** Attributed opinion, predictions, claims about
  code, definitional statements — four unresolved cases.
- **The invocation pivot** (`docs/guide/proposals/invocation-pivot.md`) — a
  proposal, not committed work. Becomes canonical only when the owner says to
  merge it.

---

## The shortest path to revenue

If the goal is a paying customer rather than a finished product:

1. **S3** — flip Stripe to live keys and take one real payment end to end.
2. **S2** — deploy the dashboard somewhere.
3. **S1** — one sign-up entry point on the marketing site.
4. **O5** — confirm Clerk Restricted mode.

That is an *invited, paid pilot* — legally fine without L1, because the terms
can be a signed agreement rather than a public ToS. Everything in M2 still
needs doing before the product is described as validated to anyone.
