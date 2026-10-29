#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
JAVAC="${JAVAC:-javac}"
JAVA="${JAVA:-java}"
CXX="${CXX:-g++}"
if [[ -z "${JAVA_HOME:-}" ]]; then
  JAVAC_PATH="$(command -v "$JAVAC")"
  JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$JAVAC_PATH")")")"
fi
case "${JAVA_HOME}" in /*) ;; *) echo 'JAVA_HOME must be an absolute JDK path' >&2; exit 2;; esac
for needed in "$JAVA_HOME/include/jni.h" "$JAVA_HOME/include/linux/jni_md.h"; do
  test -f "$needed" || { echo "Missing JNI header: $needed" >&2; exit 2; }
done
command -v timeout >/dev/null || { echo 'GNU timeout required' >&2; exit 2; }
"$JAVAC" -version
mkdir -p .build/jni/classes .build/jni/lib
"$JAVAC" -h .build/jni -d .build/jni/classes \
 bridge/java/dev/oreslang/workflow/NativeWorkflowStore.java \
 tests/java/dev/oreslang/workflow/NativeWorkflowBridgeTest.java
"$CXX" -std=c++17 -O2 -Wall -Wextra -Werror -fPIC -shared \
 -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" -Inative \
 native/workflow_sqlite.cpp bridge/jni/workflow_jni.cpp \
 -lsqlite3 -lpthread -o .build/jni/lib/libores_workflow_jni.so
# The guest compiler is a separate gate: this is a real Java -> JNI -> SQLite test.
timeout --kill-after=3s 35s "$JAVA" -Djava.library.path="$(pwd)/.build/jni/lib" \
 -cp .build/jni/classes dev.oreslang.workflow.NativeWorkflowBridgeTest
