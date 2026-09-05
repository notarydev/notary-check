> Status: reference
> Owner: Hardyk
> Last verified: 2026-09-05
> Supersedes: —

# Change map — choose scope before editing

Read [MODULES](../../MODULES.md) for enforced import boundaries. Use this map to
identify implementation files, dependencies and proof. Paths identify ownership,
not permission to rewrite the whole directory. The work item's plan names the
exact files and acceptance cases. Unknown scope must be investigated first.

| Change | Primary files | Read / update when behavior changes | Required proof |
|---|---|---|---|
| State/applicability/normalization | `engine/src/verification/`, orchestration in `engine/src/review/` | Canonical authority §5–6; MECHANISM, MODULES | Engine boundaries + full DB suite; wrong-source/period/unit distractors; no-source integrity |
| Extraction / judge prompts | `engine/src/extraction/`, `engine/src/judge/` | MECHANISM; evaluator governance in canonical build guide | Engine suite + live judge cases; fixed/adjudicated fixtures including false-supported controls; record prompt/model version |
| Source intake / locators | `engine/src/ingestion/`, `engine/src/evidence/` | MECHANISM; retained-coordinate and provenance contracts | Engine suite; unavailable source, SSRF/parser hostility, locator re-resolution and wrong-source cases |
| Detectors / Act | `engine/src/detect/`, `engine/src/act/`, Challenge code in `judge/` | MECHANISM; frozen Challenge and Move contract | Engine suite + isolation/boundaries; Act cannot change Verify; zero-claim and rejected-output cases |
| MCP tools / engine wire contract | `server/src/`, matching `engine/src/routes/` | MODULES, MECHANISM; OPERATIONS/architecture for auth | Server + engine tests/typechecks; card build; tool-description/result trust boundary; real-host check if host behavior changes |
| Review card | `ui/` | Canonical card contract; MECHANISM | Card build + browser interaction; evidence rendering; move staging; real-host limitations recorded |
| Production schema / auth / deploy | `engine/migrations/`, auth routes, `scripts/deploy.sh`, Dockerfiles | OPERATIONS and architecture in same diff; roadmap | Isolated DB migration + engine/server checks; explicit rollout/rollback plan; release requires existing owner gate |
| Local monitoring / eval | `engine/scripts/runs-report.*`, `measure-cant-check.mjs`, `engine/eval/` | Development workflow; architecture for monitoring behavior | Syntax + targeted behavior tests; local browser/API; read-only production queries only; distinguish estimates, labels and candidates |
| Customer dashboard | `dashboard/` | Component README and generated AGENTS instructions; installed Next docs | `npm --prefix dashboard run lint` and `npm --prefix dashboard run build`; browser checks; record required configuration |
| Workflow / tooling | root AGENTS, CLAUDE, `scripts/`, `.githooks/`, `.github/` | This map, development workflow, docs index | Hygiene tests/checker; full guarded local verification; inspect CI config; report remote CI as pending until run |
| Product meaning | `docs/guide/proposals/` | Canonical guide read-only until explicit named merge | Owner decision and precise proposal linkage; never infer acceptance from discussion |
| Queue / progress | ROADMAP, whats-left, PROGRESS | Update existing entries; keep historical notes labelled | Links and status headers; evidence supporting changed status |

## Close every change

1. Read the diff against its plan. Keep unrelated owner changes out of staging.
2. Run the applicable proof above; record commands, outcomes, failures/skips,
   limitations, and the tested commit or uncommitted scope in `verification.md`.
3. Update the roadmap's in-flight entry and PROGRESS current summary if status
   changed. Update current references in place; don't add competing status files.
4. Run `node scripts/check-hygiene.mjs` during work, then stage explicit paths and
   run `node scripts/check-hygiene.mjs --staged`. Commit related code/docs together.
5. Report local verification separately from CI, deployment and real-host proof.
   Mark released only with verified release evidence. Preserve blockers for the
   next agent; leave no undocumented failed gate or temporary production change.

The checker validates structure, not whether a test proves the requirement. It
cannot verify human approval, classify all secrets, or certify release safety.
