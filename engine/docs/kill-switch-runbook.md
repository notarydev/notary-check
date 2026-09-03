# Judge kill switch — operator runbook

> Covers the **existing** `NOTARY_JUDGE_KILL_SWITCH` mechanism only. This is
> not a proposal — every claim below was verified by reading
> `engine/src/judge/killSwitch.ts` and every call site of `isJudgeDisabled()`
> (`grep -rn "isJudgeDisabled\|NOTARY_JUDGE_KILL_SWITCH" engine/src`) before
> writing this doc. See `engine/docs/kill-switch-runbook.md`'s companion
> reading, `engine/.env.example`, for the shipped default and description.

## What it is

A single boolean, read from the environment, that turns off calls to the
DeepSeek semantic-evaluator ("judge") path across the engine while leaving
the deterministic verifier running. It exists so an on-call operator can
respond to a judge outage, cost spike, or bad-output incident by pulling the
judge out of the pipeline without a code change or a rollback.

## The real mechanism (from `engine/src/judge/killSwitch.ts`)

```ts
export function isJudgeDisabled(): boolean {
  const raw = process.env.NOTARY_JUDGE_KILL_SWITCH;
  return raw === "true" || raw === "1";
}
```

- Env var: **`NOTARY_JUDGE_KILL_SWITCH`**. Truthy values are exactly the
  strings `"true"` or `"1"`; anything else (including unset) leaves the
  judge enabled. Default is unset/false — **the judge is enabled unless an
  operator explicitly flips this**.
- The variable is read fresh from `process.env` on every call — there is no
  in-process caching of the flag itself. That means the check inside a
  *running* process reflects whatever `process.env.NOTARY_JUDGE_KILL_SWITCH`
  currently holds. In practice this does not make it "live" without a
  restart, though: Node processes do not pick up changes to a container's or
  host's environment after they start — an env var change only reaches
  `process.env` when the process (re)starts with the new environment
  attached. **Flipping the switch requires restarting/redeploying the engine
  process with the new env var value set**, it is not editable in a running
  process from the outside.

### Where it's actually enforced (two call sites, confirmed by grep)

The header comment in `killSwitch.ts` describes `fieldExtraction.ts`'s
`extractField()` as "the ONE real chokepoint through which every judge call
flows today." As of this reading that is slightly stale: there are
**two** enforcement points in the current code, both gated the same way,
both short-circuiting **before any judge client is constructed and before
any network call**:

1. **`engine/src/judge/fieldExtraction.ts`** (`extractField()`, around line
   113) — the per-field verification judge call. When disabled:
   ```ts
   if (isJudgeDisabled()) {
     logEvent({
       event: "judge_call",
       path: "judge-involved",
       error_cause: "judge_kill_switch_active",
       organization_id: options.organizationId,
     });
     return { field, outcome: "cannot_be_determined", record: { ...recordBase, error: "judge_kill_switch_active" } };
   }
   ```
   Every field this would have evaluated instead resolves to
   `cannot_be_determined` — no client is constructed, no request leaves the
   process.

2. **`engine/src/extraction/extractClaims.ts`** (around line 108) — the
   claim-extraction judge call (turns an answer's prose into candidate
   claims). When disabled:
   ```ts
   if (isJudgeDisabled()) {
     logEvent({
       event: "claim_extraction",
       path: "judge-involved",
       error_cause: "judge_kill_switch_active",
       organization_id: options.organizationId,
     });
     return [];
   }
   ```
   Returns an empty claim list instead of calling DeepSeek.

If a future code path adds a new judge caller that does not route through
one of these two functions, it will **not** be covered by the switch — that
is the risk `killSwitch.ts`'s own comment flags ("If a future caller routes
judge traffic around extractField, this is the module that must be
consulted there too"). Re-grep before trusting this doc after any change to
`src/judge/` or `src/extraction/`.

## What actually happens when it's flipped on (confirmed behavior)

- **Judge calls stop entirely.** No DeepSeek API request is made from either
  enforcement point — confirmed by the code returning before
  `createJudgeClient(...)` is ever invoked in both functions.
- **Deterministic checks are unaffected.** Verification steps 1–6 and 8 (the
  non-judge, non-semantic checks) run exactly as before; nothing about the
  kill switch touches that code path.
- **Pipeline degrades, not fails.** Every field that would have gone to the
  judge resolves to `cannot_be_determined` (verification) or an empty claim
  list (claim extraction) rather than an error or a crash. A review can
  still be created and will still surface deterministic-only results; it
  just cannot produce a semantic SUPPORTED/CONTRADICTED verdict for
  judge-only fields while the switch is on.
- **Cost drops to zero for the judge** — no DeepSeek spend accrues while
  disabled (relevant if the reason for flipping it is the global spend cap
  in `NOTARY_GLOBAL_SPEND_CAP_CENTS`, not just an outage).

## How to flip it

The engine currently runs as an AWS Lightsail Container Service
(`notary-check-api`, `https://api.getnotary.ai`). Its env vars — including
`NOTARY_JUDGE_KILL_SWITCH` — are set directly in the Lightsail deployment
spec, not from a Dockerfile `ENV` or a committed file, and are **not live**:
a running container does not re-read a changed env var, so this always
requires a new deployment of the same image with the updated env var set.

1. Get the current deployment spec (or work from the AWS Console → Lightsail
   → Container services → `notary-check-api` → Deployments):
   ```bash
   aws lightsail get-container-services --service-name notary-check-api
   ```
2. Create a new deployment with the same image/container config, adding or
   changing the `NOTARY_JUDGE_KILL_SWITCH` environment variable to `"true"`
   (to disable the judge) or removing it / setting it to `"false"` (to
   re-enable):
   ```bash
   aws lightsail update-container-service \
     --service-name notary-check-api \
     --no-cli-pager
   # then create a new deployment via the console, or
   aws lightsail create-container-service-deployment \
     --service-name notary-check-api \
     --containers file://deployment-containers.json \
     --public-endpoint file://deployment-endpoint.json
   ```
   The exact deployment JSON must match the currently-running spec plus the
   one env var change — pull it from `get-container-services` first rather
   than reconstructing it from memory, to avoid accidentally reverting an
   unrelated env var or image tag.
3. Wait for the new deployment to reach `ACTIVE` (Lightsail Console shows
   deployment status; `aws lightsail get-container-services` also reports
   `state`). This is a real redeploy — expect the usual brief rollover, not
   an instant flip.

There is currently no faster "flip without a deploy" path (e.g. a
feature-flag service or a `/admin` endpoint) — this is the one and only
mechanism, and it costs a deployment cycle. If judge-outage response time
becomes a real operational problem, that gap is worth closing, but it is out
of scope for this doc (which documents what exists, not what should exist).

## User-visible effect

- API responses (`POST /v1/reviews`, claim extraction, per-field
  verification) continue to succeed, but any field/claim that depended on
  the judge comes back as `cannot_be_determined` (fields) or is simply
  absent (claims never extracted in the first place) instead of a
  SUPPORTED/CONTRADICTED/UNSUPPORTED verdict.
- No 5xx and no visible "judge is down" error — by design this is a silent,
  graceful degradation, not a user-facing failure. Communicate the state
  change to customers out-of-band (status page / direct message) if the
  outage is expected to last — the API itself gives no signal that the judge
  is deliberately disabled versus simply finding nothing to support.

## How to verify it actually took effect

1. **Confirm the env var landed in the running container:**
   ```bash
   aws lightsail get-container-services --service-name notary-check-api \
     --query 'containerServices[0].currentDeployment.containers'
   ```
   Check the `environment` map for `NOTARY_JUDGE_KILL_SWITCH: "true"` on the
   deployment that is actually `ACTIVE`.
2. **Confirm it in logs.** Every skipped judge call logs a structured event
   via `logEvent()` (`engine/src/observability/log.ts`, ships to Datadog
   when `DD_API_KEY` is set, otherwise stdout) with
   `error_cause: "judge_kill_switch_active"` and `event` either
   `"judge_call"` or `"claim_extraction"`. After flipping the switch on,
   exercise one review end-to-end (e.g. `POST /v1/reviews` against a real
   evidence-bound claim) and confirm those log lines appear — their absence
   (and instead a normal judge call/response log) means the new deployment
   did not actually take, or an old container is still serving traffic.
3. **Confirm it in behavior.** A field or claim that would previously have
   resolved to a semantic verdict should now come back as
   `cannot_be_determined` (fields) or simply not appear in the extracted
   claims list. If verdicts are still being produced, the switch has not
   taken effect — re-check step 1.
4. **To turn it back off**, repeat the deploy step with
   `NOTARY_JUDGE_KILL_SWITCH` removed or set to `"false"`, and re-run the
   same log/behavior check to confirm judge calls have resumed (look for
   normal `judge_call` / `claim_extraction` log lines without
   `error_cause: "judge_kill_switch_active"`).
