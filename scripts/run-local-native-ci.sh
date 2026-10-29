#!/usr/bin/env bash
# Execute without GitHub Actions minutes, on an OWNER-AUTHORIZED host containing
# two existing private checkouts. Never fetch, mirror or publish private source.
# Requires locally prewarmed Maven dependencies, JDK 25/GraalVM and Node 22+.
set -euo pipefail
fail() { printf 'LOCAL_NATIVE_CI_UNVERIFIED %s\n' "$1" >&2; exit 2; }
demo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
: "${ORESLANG_COMPILER_ROOT:?set ORESLANG_COMPILER_ROOT to the authorized compiler checkout}"
: "${ORESLANG_COMPILER_SHA:?set exact 40-hex ORESLANG_COMPILER_SHA}"
: "${ORESLANG_DEMO_SHA:?set exact 40-hex ORESLANG_DEMO_SHA}"
[[ "$ORESLANG_COMPILER_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "invalid compiler SHA"
[[ "$ORESLANG_DEMO_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "invalid demo SHA"
scope="${ORESLANG_NATIVE_SCOPE:-full}"
[[ "$scope" == "full" || "$scope" == "guest-only" ]] || fail "invalid native scope"
command -v java >/dev/null || fail "java unavailable"
command -v mvn >/dev/null || fail "Maven unavailable"
command -v node >/dev/null || fail "Node unavailable"
command -v git >/dev/null || fail "Git unavailable"
compiler="$(cd -- "$ORESLANG_COMPILER_ROOT" 2>/dev/null && pwd -P)" ||
  fail "compiler checkout unavailable"
[[ "$compiler" != "$demo" ]] || fail "compiler and demo must be different checkouts"
[[ -f "$compiler/pom.xml" ]] || fail "compiler pom.xml missing"
[[ -f "$compiler/src/main/java/dev/oreslang/launcher/OresMain.java" ]] ||
  fail "unexpected compiler checkout; launcher source missing"
[[ -f "$demo/tests/guest/agent_pipeline.ores" ]] ||
  fail "unexpected demo checkout; guest fixture missing"
check_tree() {
  local where="$1" expected="$2" actual dirty
  actual="$(git -C "$where" rev-parse HEAD 2>/dev/null)" ||
    fail "cannot resolve git HEAD for $where"
  [[ "$actual" == "$expected" ]] || fail "git HEAD mismatch: $where"
  dirty="$(git -C "$where" status --porcelain --untracked-files=no)" ||
    fail "cannot inspect tracked status for $where"
  [[ -z "$dirty" ]] || fail "tracked working tree is dirty: $where"
}
check_tree "$demo" "$ORESLANG_DEMO_SHA"
check_tree "$compiler" "$ORESLANG_COMPILER_SHA"
java_version="$(java -version 2>&1)" || fail "java -version failed"
printf '%s\n' "$java_version"
grep -Eq 'version "25([." +]|$)' <<< "$java_version" ||
  fail "JDK 25 required for native acceptance"
grep -qi 'GraalVM' <<< "$java_version" ||
  fail "GraalVM JDK 25 required; plain OpenJDK is insufficient"
node --version
mvn --version
printf 'LOCAL_NATIVE_CI_START demo_head=%s demo_tree=%s compiler_head=%s compiler_tree=%s\n' \
 "$ORESLANG_DEMO_SHA" "$(git -C "$demo" rev-parse 'HEAD^{tree}')" \
 "$ORESLANG_COMPILER_SHA" "$(git -C "$compiler" rev-parse 'HEAD^{tree}')"
# Clean rebuild ensures stale untracked target/classes cannot impersonate a
# build of the checked-out compiler revision. -o prohibits network fetching.
(
  cd "$compiler"
  mvn -o -B -ntp -DskipTests clean package dependency:build-classpath \
    -Dmdep.outputFile=target/runtime-classpath.txt
)
check_tree "$compiler" "$ORESLANG_COMPILER_SHA"
(
  cd "$demo"
  node --test tests/*.test.mjs
  if [[ "$scope" == "guest-only" ]]; then
    # Java-main-supported messaging can be verified independently of the
    # separate sealed-state compiler integration still in draft.
    node scripts/run-native-guest.mjs
  else
    # Verify the actual native SQLite transaction backend independently.
    # This is NOT a linked Oreslang guest execution.
    bash scripts/check-native-sqlite.sh
    # Full gate includes sealed actor sources, storage port, typed-negative and
    # all three native guest stdout oracles.
    node scripts/run-native-acceptance.mjs
  fi
)
check_tree "$demo" "$ORESLANG_DEMO_SHA"
check_tree "$compiler" "$ORESLANG_COMPILER_SHA"
if [[ "$scope" == "guest-only" ]]; then
  printf 'LOCAL_NATIVE_GUEST_SMOKE_RESULT passed=true demo_head=%s compiler_head=%s scope=guest_only_no_sealed_actor_validation\n' \
    "$ORESLANG_DEMO_SHA" "$ORESLANG_COMPILER_SHA"
else
  printf 'LOCAL_NATIVE_CI_RESULT passed=true demo_head=%s compiler_head=%s scope=Java_native_checks_and_two_guests\n' \
    "$ORESLANG_DEMO_SHA" "$ORESLANG_COMPILER_SHA"
fi
