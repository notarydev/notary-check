# Annotator guide — DRAFT scaffold

**This is not the final annotation protocol.** It operationalizes the rules
already written down in `docs/build/tier-1-build-and-operating-plan.md` (§ Verification pipeline step 5, § LLM
judge design) into a checklist a non-engineer can follow. It restates the
plan's own already-decided policy; it does not invent new policy. Before real
annotation begins, this guide should be reviewed against the actual protocol
requirements in `docs/build/tier-1-build-and-operating-plan.md` § Evaluator governance and rollback (two
independent annotators per packet, written guide, blinded adjudication,
per-class agreement reporting) and revised by whoever owns that process.

## Your job, in one sentence

For each case (a claim + a piece of evidence), decide whether the evidence
**applies** to the claim (same subject), and if it does, whether it
**supports**, **contradicts**, or leaves the claim **unsupported**. You are
not deciding whether the claim is *true in the world* — only whether *this
specific evidence*, read plainly, backs it up.

## Step 1 — read the claim and pull out its fields

Every claim can (in principle) be broken into up to eight fields. You don't
need to fill these in yourself if `claim_fields` is already populated in the
case file — but you must check that the pre-filled fields actually match
what the claim text says, and flag it in your notes if they don't.

| Field | What it is | Example |
|---|---|---|
| entity | who/what the claim is about | "Acme", "the Northeast region" |
| period | the time window | "FY25", "Q3 2024" |
| metric | the noun being measured | "revenue", "headcount", "market share" |
| operator | direction of change (closed set: increase / decrease / no_change) | "grew" → increase |
| valueUnit | the number and its unit | "17%", "$4.2M" |
| comparatorBaseline | what it's being compared against | "prior year", "the industry average" |
| modality | is this an actual reported figure, a forecast, a target, a guess | "actual", "projected" |
| scope | company-wide vs. a subset | "company-wide", "North America only" |

A claim doesn't have to assert every field. Only fill in / check fields the
claim text actually states.

## Step 2 — read the evidence passage and ask the same eight questions

For each field the claim asserts, ask: **does this evidence passage address
that field, and if so, what does it say?** Use only what's on the page in
front of you — no outside knowledge, no assuming a company is "probably" the
same one, no filling in a plausible-sounding date.

## Step 3 — apply the material-mismatch rule (this is the whole game)

> **A material mismatch on ANY field excludes the evidence from support, even
> when the wording or number is otherwise attractive.** (docs/build/tier-1-build-and-operating-plan.md § 5)

Concretely, go field by field:

- **entity** — is it the *same* organization/subject, not just a
  similar-sounding one? "Acme Inc." and "Acme Corp" are the same (spelling
  variant); "Acme" and "Acme Robotics" are **not** the same entity unless the
  passage establishes they're the same thing. Mismatch → excluded.
- **period** — is it the *same* time window? "FY25" and "fiscal 2025" are the
  same (label formatting only). "FY25" and "FY24" are **not** the same, even
  if off by one year. We never convert calendar dates to fiscal quarters or
  vice versa by inference — if the passage doesn't make the equivalence
  explicit, treat it as a mismatch.
- **metric** — is it the *literal same measure*? "Revenue" and "gross
  revenue" are **different metrics** — do not treat them as equal even though
  they sound related. "Net income" and "profit" are different unless the
  passage equates them. When in doubt, treat metrics as different.
- **operator** — does the passage state the same direction of change
  (increase / decrease / no_change)? Paraphrases count: "grew," "rose,"
  "climbed," "was up" all mean increase. But a claim of increase against
  evidence of decrease (or vice versa) is a value-level conflict, not a
  simple mismatch — see Step 4.
- **valueUnit** — same unit? "%" and "$" are never interchangeable. If the
  unit differs, it's a mismatch (excluded from support), not a contradiction.
  If the **unit matches but the number differs** (17% claimed vs. 12% in the
  evidence), that is a **contradiction**, not an exclusion — see Step 4.
- **comparatorBaseline** — same baseline? "vs. prior year" and "vs. industry
  average" are different comparisons even if the metric and value line up.
- **modality** — is the evidence reporting the same kind of figure? A claim
  that a company's revenue "grew 17%" (an actual, reported fact) is not
  supported by a passage that says revenue is "projected to grow 17%" (a
  forecast) — different modality, mismatch.
- **scope** — same population/breadth? "Company-wide" and "North America
  only" are different scopes even if every other field matches.

**Normalization is narrow.** Only these are treated as the same thing across
claim and evidence: case/punctuation/whitespace/Unicode differences,
corporate-suffix spelling ("Acme, Inc." ~ "ACME Inc"), percent notation ("12
percent" ~ "12%"), numeric grouping ("12,000,000" ~ "12000000"), declared
value multipliers ("m" ~ ",000,000"), and fiscal-year label formatting ("FY25"
~ "fiscal 2025", text only, never date math). Everything else — metric
synonyms, entity aliases beyond suffix spelling, semantic "close enough" —
is **not** normalized. If you catch yourself thinking "well, that's basically
the same thing," stop: unless it's on the narrow list above, it isn't the
same thing for this exercise.

## Step 4 — assign the label

Work through this checklist in order:

1. **Is there any addressable evidence at all for this claim?**
   No → label `INDETERMINATE`, `no_source = true`, reason `no_source`. Stop.
2. **Does every field the claim asserts match the evidence (per Step 3),
   except possibly valueUnit?**
   No (some other field is a material mismatch) → the evidence does not
   apply. If this was the *only* evidence available, label `UNSUPPORTED`
   (assuming no other candidate applies) or `INDETERMINATE` (if you can't
   tell whether other checks completed). Note which field(s) mismatched.
3. **All fields matched, but the unit differs from the claim's?**
   → does not apply (same as any other field mismatch, not a contradiction).
4. **All fields matched including unit, but the numeric value differs?**
   → `CONTRADICTED`. This is the flagship case: same entity, period, metric,
   operator's *direction claim*, baseline, unit — but 17% claimed vs. 12% in
   evidence. Same-direction, different-magnitude counts here too.
5. **All fields matched including value?**
   → `SUPPORTED`.
6. **Genuinely can't tell (garbled text, ambiguous table, passage half-cut
   off)?**
   → `INDETERMINATE`, and say why in notes (not the same as "no evidence" —
   there IS evidence, it just can't be read clearly enough).

## Step 5 — write your reason and notes

Use one of the reuse-friendly reasons where it fits: `no_source`,
`contradicting_applicable_relation`, `supporting_applicable_relation`,
`no_support_after_completed_checks`, `checks_did_not_complete` — or, for an
applicability exclusion, name the mismatched field(s) plainly ("wrong
entity", "unit mismatch: % vs $", "different metric: gross revenue vs
revenue"). Always add a one-line note on anything that gave you pause — that
note is exactly what disagreement adjudication will need later.

## What you are never asked to do

- Never use outside knowledge about whether the claim is actually true.
- Never search for more evidence — you only ever see what's already in the
  case file.
- Never give a confidence score or percentage. Only the state.
- Never resolve a disagreement with the other annotator yourself — flag it
  and let the (separate, blinded) adjudication step handle it.

## Blinded adjudication (for whoever runs the process, not the annotators)

Per `docs/build/tier-1-build-and-operating-plan.md` § Evaluator governance and rollback: annotators label
independently, without seeing each other's labels. Where two annotators
agree, that becomes the case's adjudicated label. Where they disagree, a
third reviewer — shown the claim, the evidence, and both annotators' stated
reasons but **not** which annotator gave which label — makes the final call
and records `disagreement_notes` explaining the resolution. Track per-class
agreement (how often annotators agreed, broken down by target label) — this
number matters for judging whether the guide itself needs revision, not just
for scoring any one case.
