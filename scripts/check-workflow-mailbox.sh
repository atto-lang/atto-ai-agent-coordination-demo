#!/usr/bin/env bash
# Real JVM -> host mailbox -> JNI -> native SQLite proof, NOT a .ores guest.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v timeout >/dev/null || { echo 'GNU timeout is required' >&2; exit 2; }
# Rebuild the exact JNI library and run the previous native host proof.
bash scripts/check-jni-workflow.sh
JAVAC="${JAVAC:-javac}"
JAVA="${JAVA:-java}"
"$JAVAC" -cp .build/jni/classes -d .build/jni/classes \
  bridge/java/dev/oreslang/workflow/WorkflowStorageMailbox.java \
  tests/java/dev/oreslang/workflow/WorkflowStorageMailboxTest.java
# Subprocess SIGKILL, backpressure and trusted-policy denial exercises.
timeout --kill-after=3s 35s "$JAVA" \
  -Djava.library.path="$(pwd)/.build/jni/lib" \
  -cp .build/jni/classes dev.oreslang.workflow.WorkflowStorageMailboxTest
