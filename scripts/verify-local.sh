#!/usr/bin/env bash
# Reproducible local checks. Supply a dedicated local Postgres database.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-offline}"
if [[ "$mode" != offline && "$mode" != live ]]; then
  echo 'Usage: TEST_DATABASE_URL=postgres://.../notary_check_test scripts/verify-local.sh [offline|live]' >&2
  exit 2
fi
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a dedicated local test database}"
node --input-type=module - <<'JS'
try {
  const u = new URL(process.env.TEST_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
      !/^\/notary_check_(test|baseline)(_[a-z0-9]+)*$/.test(u.pathname) || u.search) {
    throw new Error('unsafe target');
  }
} catch {
  console.error('Refusing target: use loopback, no URL query, and database notary_check_test or notary_check_baseline_<suffix>. Never forward this port to production.');
  process.exit(2);
}
JS
export DATABASE_URL="$TEST_DATABASE_URL"
if [[ "$mode" == live ]]; then
  : "${DEEPSEEK_API_KEY:?Live mode requires DEEPSEEK_API_KEY in the environment}"
else
  export DEEPSEEK_API_KEY=''
fi
# Neither mode creates a database; test helpers apply migrations to this target.
log_dir=".local/verification/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$log_dir"
run_check() {
  local label="$1"
  shift
  if "$@" > "$log_dir/$label.log" 2>&1; then
    echo "PASS $label"
  else
    echo "FAIL $label — inspect $log_dir/$label.log" >&2
    exit 1
  fi
}
run_check hygiene-tests node --test scripts/check-hygiene.test.mjs
run_check engine-test npm --prefix engine test
run_check engine-typecheck npm --prefix engine run typecheck
run_check server-test npm --prefix server test
run_check server-typecheck npm --prefix server run typecheck
run_check ui-build npm --prefix ui run build
rg '^# (tests|pass|fail|skipped)' "$log_dir/engine-test.log" "$log_dir/server-test.log"
printf 'Mode: %s. Local logs: %s\n' "$mode" "$log_dir"
