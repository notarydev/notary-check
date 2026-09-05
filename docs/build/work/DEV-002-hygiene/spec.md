> Status: reference
> Owner: Hardyk
> Last verified: 2026-09-05
> Supersedes: —

# DEV-002 — Acceptance

Work status: implemented locally. Source: [intent](intent.md).

- One entry point links the change map, shared rules, roadmap and work records.
- Each change category names owned paths, related documentation and proof.
- Deterministic diff checks reject missing work proof, broken local Markdown
  targets, missing docs headers, existing migration edits, sensitive paths and
  common embedded credentials without printing values.
- Staged checking reads the index, so unstaged fixes cannot falsely pass a commit.
- A local hook and GitHub CI use the same checks; CI uses disposable Postgres and
  no production/model secrets. Remote enforcement is reported pending until pushed.
- Current facts are updated in place; historical documents and owner diagnostics
  remain intact. Product meaning and release gates remain unchanged.
