> Status: reference
> Owner: Hardyk
> Last verified: 2026-09-05
> Supersedes: —

# DEV-002 — Verification

Work status: verified locally; included in the cleanup commit containing this record.
Base: e1b9fa8 plus DEV-001. Scope: [plan](plan.md).

## Checks

- Hygiene tests: **9/9 pass**, including staged/index isolation, migration edits
  and deletion, secret-safe detection, placeholder handling and broken links.
- Full guarded offline verification: engine **466 pass / 8 live-model skips / 0
  failures**; server **10/10**, both typechecks and card build pass.
- Diff hygiene and whitespace checks pass. Local hook installed after confirming
  no existing core.hooksPath; staged check repeats during commit.
- Workflow YAML syntax passes Ruby YAML parsing. Workflow inspected against the guarded verification command and isolated
  Postgres configuration. Remote CI execution remains pending; not a proven run.
- Logs: `.local/verification/20260905T195657Z-71869/`. Hygiene tests rerun after
  adding index-isolation coverage; no runtime source changed during this pass.

An initial credential regex falsely matched documented URL placeholders; narrowed
it and added a regression case. A deletion test initially demanded no work-record
requirement; corrected it to test the actual property: deleting private material
is permitted while normal proof requirements remain intact. Local hook and CI use the same dependency-free checker. GitHub CI
configuration is local only until pushed; no remote run or branch protection is
claimed. Actions v4 commit SHAs were resolved from their official GitHub repos.

## Limits and retained work

No engine semantics, product proposals, applied migrations, or production data
changed. Existing latest-review.ts changes and repro-pacific.ts belong to the
owner and remain outside this commit. Local backup is preserved and ignored.
Full product validation, E10, lifecycle triage, E11/E17 and credential chores
remain in the roadmap. Structural checks cannot prove approval or correctness.

## Remote rollout — PR 1

Branch pushed and [PR #1](https://github.com/notarydev/notary-check/pull/1) opened.
The first [CI run](https://github.com/notarydev/notary-check/actions/runs/33989012149)
passed hygiene, engine tests/typecheck, server tests/typecheck and card build, then
failed because the final summary used `rg`, unavailable on the runner. Replaced
that summary with portable `grep -E`; repeat CI is required on this correction.
No production deployment or merge occurred.
