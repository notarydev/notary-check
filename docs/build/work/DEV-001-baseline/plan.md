> Status: reference
> Owner: Hardyk
> Last verified: 2026-09-05
> Supersedes: —

# DEV-001 — Implementation plan

Work status: executed locally. Scope authorized by [intent](intent.md).

1. Inspect repository instructions, remote state and live service metadata.
2. Create an isolated local baseline database and capture offline/live test logs
   under ignored `.local/verification/`; capture E18 output locally.
3. Add `scripts/verify-local.sh` with local-database validation and explicit
   live-model opt-in. Keep production credentials out of files and command output.
4. Correct local dashboard binding, unassessed labels, missing status and stale
   error feedback. Preserve its read-only queries and existing views.
5. Add root `AGENTS.md` as the agent entry point and a linked development workflow.
   Correct current roadmap contradictions and add current snapshot pointers to
   historical documents. Ignore backups and local verification material.
6. Verify the script, dashboard API/UI/listener, Markdown links and diff. Record
   results and remaining work in [verification](verification.md).

## Risks and proof

Tests mutate databases: validate loopback host and dedicated test database name.
Dashboard reads all organizations: bind loopback; never deploy publicly.
A green suite is not correctness ground truth: preserve B1 and owner decisions.
Existing uncommitted files belong to the owner: do not stage, discard or rewrite.
The baseline commit is e1b9fa8; changes remain on codex/development-baseline.
No push, merge or deployment is part of this setup.
