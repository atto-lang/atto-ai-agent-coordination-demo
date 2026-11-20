#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: bash ci/verify-java.sh /path/to/oreslang-compiler" >&2
  exit 64
fi

cli="$1"
source_file="src/plan_review.ores"
expected_file="ci/expected-output.txt"

"$cli" --check "$source_file"

actual_file="$(mktemp)"
trap 'rm -f "$actual_file"' EXIT
"$cli" "$source_file" >"$actual_file"

if ! cmp -s "$expected_file" "$actual_file"; then
  echo "coordination stdout mismatch" >&2
  echo "expected:" >&2
  cat "$expected_file" >&2
  echo >&2
  echo "actual:" >&2
  cat "$actual_file" >&2
  echo >&2
  exit 1
fi

if [[ -f "$cli" ]]; then
  sha256sum "$cli"
fi

echo "coordination guest verification passed"
