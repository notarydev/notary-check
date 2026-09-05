> Status: reference
> Owner: Hardyk
> Last verified: 2026-09-05
> Supersedes: —

# DEV-002 — Plan

Work status: executed locally. Source: [spec](spec.md).
Base: e1b9fa8 plus the prior DEV-001 working diff.

1. Add change-map.md and connect root agent instructions and workflow.
2. Implement check-hygiene.mjs with staged/worktree/base-ref modes and targeted
   tests for real failure cases. Keep it dependency-free and secret-safe.
3. Add .githooks/pre-commit and .github/workflows/verify.yml. Install the hook only
   if no existing custom hooks configuration conflicts. Pin actions to resolved SHAs.
4. Remove duplicated operational snapshots from CLAUDE in favor of OPERATIONS;
   update roadmap/progress/current facts for this cleanup.
5. Test checker semantics and index isolation, run guarded local verification,
   review and commit only this agent's cleanup/baseline paths. Leave diagnostic
   edits and the reproduction file untouched. No push/deployment.

Risks: superficial documentation can pass structural checks, so semantic review
remains required. CI has no live model credentials, so skipped live cases are
reported, not treated as product-validation proof. The hook can be bypassed;
branch protection is an owner-controlled remote setting, not silently enabled.
