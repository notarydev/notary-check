> Status: reference
> Owner: Hardyk
> Last verified: 2026-09-05
> Supersedes: —

# DEV-001 — Requirements and design

Work status: implemented locally; reviewable diff, no release.
Source: [intent](intent.md). Product authority remains the existing canonical guide.

## Acceptance

- Record local commit, remote main, open PR/CI state, and actual Lightsail images.
- Run engine boundaries, real-Postgres tests, engine/server typechecks, server
  tests, and card build. Separate model-disabled and live-model results.
- Use an explicitly selected isolated local test database. Never run migrations
  or mutating test fixtures against production. Keep secrets and raw run data
  outside tracked files.
- Verify the local run dashboard with real rows. Bind its listener to loopback;
  distinguish unassessed runs from “none”; expose stale polling failures.
- Preserve one roadmap entry point and existing document authority. Introduce
  per-work intent/spec/plan/verification links and a reusable verification command.
- Capture monitoring limits and owner blockers; do not call harness candidates
  ground truth or passing tests product validation.

## Shared references

[CLAUDE.md](../../../../CLAUDE.md), [operations](../../../../OPERATIONS.md),
[mechanism](../../../../MECHANISM.md), [modules](../../../../MODULES.md), and
[docs authority](../../../README.md) stay in place. No content migration needed.
