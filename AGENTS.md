# Notary Check — agent entry point

Read `CLAUDE.md` for the shared operating rules and product boundaries, then
`ROADMAP.md` → **In flight right now** before choosing work. Read `OPERATIONS.md`
before accessing services and `MODULES.md` before editing code. Read
`docs/README.md` for document authority.

Before editing, use `docs/build/change-map.md` to identify owned paths and required
checks. Before committing, run `node scripts/check-hygiene.mjs --staged`; keep
code and matching documentation/proof in the same commit.

The working process is `docs/build/development-workflow.md`. Current setup and
proof live in `docs/build/work/DEV-001-baseline/verification.md`.

Keep durable decisions and verification in the repo, not only in conversation.
Respect existing user changes. A named product proposal is not approved merely
because it exists. Never alter the canonical product definition without the
owner explicitly naming a proposal to merge. Never run tests against production.

Use per-work intent/spec/plan/verification files for substantial work; scale the
paperwork to the change. Existing user authorization persists: don't add repeated
approval requests for routine implementation within approved scope. Product
meaning, external release and owner-only actions retain their existing gates.
