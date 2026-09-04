#!/usr/bin/env bash
#
# Deploy Notary Check to AWS Lightsail.
#
# WHY THIS EXISTS. The deploy sequence used to live only in shell history, so
# every deploy was retyped from memory. Three things about it are easy to get
# wrong and each fails in a way that does not look like the mistake:
#
#   1. The image MUST be linux/amd64. Lightsail is x86; dev machines here are
#      ARM. An ARM image pushes successfully and then crash-loops, and the
#      deployment silently rolls back to the previous version — so the symptom
#      is "nothing changed", not "wrong architecture".
#   2. The deployment MUST be created from the CURRENT spec. The container
#      environment holds every secret and cannot be reconstructed from the
#      repo. A hand-written deployment starts a container with no database
#      credentials.
#   3. A failed deployment ROLLS BACK. If you assume success, you are looking
#      at the old build. This script therefore asserts the version number
#      incremented rather than trusting the create call's exit code.
#
# Usage:
#   ./scripts/deploy.sh engine            # engine only
#   ./scripts/deploy.sh server            # MCP server + card only
#   ./scripts/deploy.sh both              # both, pushed before either deploys
#   ./scripts/deploy.sh both --migrate    # …and run pending migrations in the
#                                         #   gap between push and deploy
#   ./scripts/deploy.sh both --dry-run    # build and push, deploy nothing
#   ./scripts/deploy.sh both --use-pushed # skip build+push, deploy the image
#                                         #   already at the top of the registry
#
# --use-pushed is for two situations: a deploy that failed after the push (retry
# without a ten-minute rebuild), and a --dry-run you now want to release.
#
# --migrate needs PROD_DATABASE_URL in the environment. Read it off the
# container service; it is deliberately not stored in this repo.
#
# See OPERATIONS.md for the wider picture (domains, the other codebases, why
# there is no /healthz to poll).

set -euo pipefail

REGION="us-east-2"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

TARGET="${1:-}"
shift || true
MIGRATE=false
DRY_RUN=false
USE_PUSHED=false
for arg in "$@"; do
  case "$arg" in
    --migrate) MIGRATE=true ;;
    --dry-run) DRY_RUN=true ;;
    --use-pushed) USE_PUSHED=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

case "$TARGET" in
  engine|server|both) ;;
  *) sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

DO_ENGINE=false; DO_SERVER=false
[[ "$TARGET" == "engine" || "$TARGET" == "both" ]] && DO_ENGINE=true
[[ "$TARGET" == "server" || "$TARGET" == "both" ]] && DO_SERVER=true

say() { printf "\n\033[1m==> %s\033[0m\n" "$*"; }
die() { printf "\n\033[31mFAILED: %s\033[0m\n" "$*" >&2; exit 1; }

command -v aws    >/dev/null || die "aws CLI not found"
command -v docker >/dev/null || die "docker not found"
command -v jq     >/dev/null || die "jq not found"
docker info >/dev/null 2>&1  || die "docker daemon is not running"
aws sts get-caller-identity >/dev/null 2>&1 || die "AWS credentials are not configured"

# ---------------------------------------------------------------------------
# Gate: never deploy something that does not pass its own tests.
#
# This is the whole reason a script beats a remembered command line. The engine
# suite runs the boundary check first, so a layering violation stops the deploy
# too.
# ---------------------------------------------------------------------------
if $USE_PUSHED && $DRY_RUN; then die "--use-pushed and --dry-run do nothing together"; fi

if $USE_PUSHED; then
  # Trust what is already in the registry. The tests were run before it was
  # pushed; re-running them here would not re-verify that image.
  latest_image() {
    aws lightsail get-container-images --region "$REGION" --service-name "$1" \
      --query 'containerImages[0].image' --output text
  }
  ENGINE_REF=""; SERVER_REF=""
  $DO_ENGINE && ENGINE_REF="$(latest_image notary-check-api)"
  $DO_SERVER && SERVER_REF="$(latest_image notary-check-mcp)"
  say "Using images already in the registry"
  [[ -n "$ENGINE_REF" ]] && echo "  engine: $ENGINE_REF"
  [[ -n "$SERVER_REF" ]] && echo "  server: $SERVER_REF"
else

say "Verifying before building"
(cd engine && npx tsc --noEmit) || die "engine typecheck failed"
(cd server && npx tsc --noEmit) || die "server typecheck failed"
if [[ -n "${SKIP_TESTS:-}" ]]; then
  echo "SKIP_TESTS set — skipping the suites. You are deploying unverified code."
else
  (cd engine && npm test) || die "engine tests failed (re-run once: a few tests call DeepSeek for real and flake on network timing — see MODULES.md)"
  (cd server && npm test) || die "server tests failed"
fi

# ---------------------------------------------------------------------------
# Build. The card is built first and unconditionally: the server image COPYs
# ui/dist, so a stale card ships silently if it is skipped.
# ---------------------------------------------------------------------------
if $DO_SERVER; then
  say "Building the card (ui/dist — the server image copies it)"
  (cd ui && npm run build) || die "ui build failed"
fi

if $DO_ENGINE; then
  say "Building engine image (linux/amd64)"
  docker build --platform linux/amd64 -t notary-check-api ./engine || die "engine image build failed"
fi
if $DO_SERVER; then
  say "Building server image (linux/amd64)"
  docker build --platform linux/amd64 -f server/Dockerfile -t notary-check-mcp . || die "server image build failed"
fi

# ---------------------------------------------------------------------------
# Push. Both images go up BEFORE either service is deployed, so that when a
# migration is involved the window where schema and code disagree is as short
# as we can make it. Pushing is slow; deploying is fast.
# ---------------------------------------------------------------------------
push_image() {  # service, label, local tag  ->  prints the new image ref
  local service="$1" label="$2" tag="$3"
  local out
  out="$(aws lightsail push-container-image --region "$REGION" \
          --service-name "$service" --label "$label" --image "$tag" 2>&1)" \
    || { echo "$out" >&2; die "push failed for $service"; }
  # The ref is only available in the human-readable output; there is no
  # structured form of this command.
  local ref
  ref="$(echo "$out" | grep -oE ':[a-z0-9-]+\.[a-z]+\.[0-9]+' | tail -1)"
  [[ -n "$ref" ]] || { echo "$out" >&2; die "could not read the pushed image ref for $service"; }
  echo "$ref"
}

ENGINE_REF=""; SERVER_REF=""
if $DO_ENGINE; then
  say "Pushing engine image"
  ENGINE_REF="$(push_image notary-check-api engine notary-check-api)"
  echo "  -> $ENGINE_REF"
fi
if $DO_SERVER; then
  say "Pushing server image"
  SERVER_REF="$(push_image notary-check-mcp server notary-check-mcp)"
  echo "  -> $SERVER_REF"
fi

fi  # end of the build-and-push path (skipped by --use-pushed)

if $DRY_RUN; then
  say "--dry-run: images pushed, nothing deployed"
  [[ -n "$ENGINE_REF" ]] && echo "  engine: $ENGINE_REF"
  [[ -n "$SERVER_REF" ]] && echo "  server: $SERVER_REF"
  exit 0
fi

# ---------------------------------------------------------------------------
# Migrations, in the gap between push and deploy.
#
# Ordering is the whole point. A migration that RENAMES or DROPS makes the
# running code wrong the instant it applies, so it must land as close to the
# new deployment as possible — which means after the slow push, not before it.
# ---------------------------------------------------------------------------
if $MIGRATE; then
  [[ -n "${PROD_DATABASE_URL:-}" ]] || die "--migrate needs PROD_DATABASE_URL (read it off the container service environment)"
  say "Backing up production before migrating"
  BACKUP="$REPO/.backups/notary_check-$(date +%Y%m%d-%H%M%S).sql"
  mkdir -p "$REPO/.backups"

  # pg_dump refuses to dump a server NEWER than itself, so the client version
  # has to match production's major. Detect it rather than hardcode it: psql
  # has no such restriction and will connect to any server, so we can ask.
  PG_MAJOR="$(docker run --rm postgres:16 psql "$PROD_DATABASE_URL" \
      -tAc "SELECT current_setting('server_version_num')::int / 10000" 2>/dev/null | tr -d '[:space:]')"
  if [[ ! "$PG_MAJOR" =~ ^[0-9]+$ ]]; then
    die "could not reach production Postgres to read its version. Check PROD_DATABASE_URL and network access."
  fi
  echo "  production Postgres is major version $PG_MAJOR"

  DUMP_ERR="$(mktemp)"
  if command -v pg_dump >/dev/null && [[ "$(pg_dump --version | grep -oE '[0-9]+' | head -1)" -ge "$PG_MAJOR" ]]; then
    pg_dump "$PROD_DATABASE_URL" > "$BACKUP" 2>"$DUMP_ERR" || { cat "$DUMP_ERR" >&2; die "pg_dump failed — refusing to migrate without a backup"; }
  else
    docker run --rm "postgres:$PG_MAJOR" pg_dump "$PROD_DATABASE_URL" > "$BACKUP" 2>"$DUMP_ERR" \
      || { cat "$DUMP_ERR" >&2; die "pg_dump (postgres:$PG_MAJOR via docker) failed — refusing to migrate without a backup"; }
  fi
  BYTES="$(wc -c < "$BACKUP" | tr -d ' ')"
  [[ "$BYTES" -gt 1000 ]] || die "backup is only $BYTES bytes — that is not a real dump. Refusing to migrate."
  echo "  -> $BACKUP ($BYTES bytes)"

  say "Applying migrations to production"
  (cd engine && DATABASE_URL="$PROD_DATABASE_URL" npm run migrate) || die "migration failed — production may be mid-schema. Restore from $BACKUP"
fi

# ---------------------------------------------------------------------------
# Deploy: take the live spec, change ONLY the image, send it back.
# ---------------------------------------------------------------------------
deploy_service() {  # service, container name, new image ref
  local service="$1" container="$2" ref="$3"
  local spec before after
  spec="$(mktemp)"

  before="$(aws lightsail get-container-services --region "$REGION" --service-name "$service" \
             --query 'containerServices[0].currentDeployment.version' --output text)"

  aws lightsail get-container-services --region "$REGION" --service-name "$service" \
    --query 'containerServices[0].currentDeployment.{containers:containers,publicEndpoint:publicEndpoint}' \
    --output json > "$spec" || die "could not read the current spec for $service"

  jq --arg c "$container" --arg img "$ref" '.containers[$c].image = $img' "$spec" > "$spec.new" \
    || die "could not rewrite the spec for $service"
  # Sanity: the environment must have survived the rewrite. A spec with no env
  # starts a container with no database credentials.
  local envcount
  envcount="$(jq --arg c "$container" '.containers[$c].environment | length' "$spec.new")"
  [[ "$envcount" -gt 0 ]] || die "$service spec lost its environment block — refusing to deploy"

  say "Deploying $service ($ref, $envcount env vars preserved)"
  aws lightsail create-container-service-deployment --region "$REGION" \
    --service-name "$service" --cli-input-json "file://$spec.new" >/dev/null \
    || die "create-container-service-deployment failed for $service"

  # Wait for the service to settle. A FAILED deployment rolls back silently, so
  # "RUNNING" alone proves nothing — the version must have incremented.
  local state
  for _ in $(seq 1 60); do
    sleep 10
    state="$(aws lightsail get-container-services --region "$REGION" --service-name "$service" \
              --query 'containerServices[0].state' --output text)"
    [[ "$state" == "RUNNING" ]] && break
    printf "  %s…\n" "$state"
  done

  after="$(aws lightsail get-container-services --region "$REGION" --service-name "$service" \
            --query 'containerServices[0].currentDeployment.version' --output text)"
  if [[ "$after" == "$before" ]]; then
    die "$service is at version $after — unchanged. The deployment failed and rolled back. Check: aws lightsail get-container-log --region $REGION --service-name $service --container-name $container"
  fi
  echo "  $service: version $before -> $after, state $state"
}

$DO_ENGINE && deploy_service notary-check-api engine "$ENGINE_REF"
$DO_SERVER && deploy_service notary-check-mcp server "$SERVER_REF"

say "Deployed"
aws lightsail get-container-services --region "$REGION" \
  --query 'containerServices[].{name:containerServiceName,state:state,version:currentDeployment.version,image:currentDeployment.containers.*.image}' \
  --output table

cat <<'NOTE'

Now confirm it is actually running the new code, not just reporting success:

  cd engine && npx tsx scripts/prod-smoke.ts
  cd engine && npx tsx scripts/prod-detect-smoke.ts

"Deployed" is not "running" — seven features in this codebase were built,
deployed, confirmed live, and did nothing. Read production rows, not the card.
NOTE
