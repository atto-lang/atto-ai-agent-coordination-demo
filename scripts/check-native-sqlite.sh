#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v g++ >/dev/null || { echo 'NATIVE_SQLITE_UNVERIFIED missing C++ compiler' >&2; exit 2; }
command -v pkg-config >/dev/null || { echo 'NATIVE_SQLITE_UNVERIFIED missing pkg-config' >&2; exit 2; }
command -v timeout >/dev/null || { echo 'NATIVE_SQLITE_UNVERIFIED GNU timeout unavailable' >&2; exit 2; }
pkg-config --exists sqlite3 || { echo 'NATIVE_SQLITE_UNVERIFIED sqlite3 development library missing' >&2; exit 2; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
g++ -std=c++17 -Wall -Wextra -Werror -O2 -g -fno-omit-frame-pointer \
  -I native native/workflow_sqlite.cpp tests/native_sqlite_test.cpp \
  $(pkg-config --cflags --libs sqlite3) -pthread -o "$tmp/native-workflow-test"
timeout --kill-after=5s 30s "$tmp/native-workflow-test"
