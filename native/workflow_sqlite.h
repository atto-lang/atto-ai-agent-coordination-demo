#ifndef ORES_WORKFLOW_SQLITE_H
#define ORES_WORKFLOW_SQLITE_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct wf_store wf_store;
enum { WF_OK=0, WF_FENCED=1, WF_DUPLICATE=2, WF_UNAUTHORIZED=3,
       WF_INVALID=4, WF_STORAGE_ERROR=5, WF_UNKNOWN=6 };

// These callbacks MUST come from a trusted host control plane, not the agent.
// Return 1 only on independently verified authorization/remote outcome.
// Never invoke callbacks while holding SQLite write locks.
typedef int (*wf_authorize_fn)(void *context, const char *action,
  const char *tenant, const char *run, const char *revision,
  int64_t epoch, int64_t version, const char *step,
  const char *effect_key, const char *digest, const char *message_id,
  const char *outcome, const char *receipt);
typedef int (*wf_verify_receipt_fn)(void *context,
  const char *tenant, const char *run, const char *revision,
  const char *step, const char *effect_key, const char *digest,
  const char *outcome, const char *receipt);

// Open only owner-private local filesystem directory (mode 0700, no symlink).
// Caller owns callback context until wf_close returns. Does not own callbacks.
int wf_open(const char *directory, wf_authorize_fn authorize,
            wf_verify_receipt_fn verify, void *context, wf_store **out);
void wf_close(wf_store *store);
int wf_create_run(wf_store *, const char *tenant, const char *run, const char *revision);
int wf_activate(wf_store *, const char *tenant, const char *run,
  const char *revision, int64_t expected_epoch,
  int64_t *new_epoch, int64_t *new_version);
int wf_accept_step(wf_store *, const char *tenant, const char *run,
  const char *revision, int64_t epoch, int64_t version,
  const char *step, const char *message_id, const char *effect_key,
  const char *digest, int64_t *new_version);
int wf_claim_dispatch(wf_store *, const char *tenant, const char *run,
  const char *revision, int64_t epoch, int64_t version,
  const char *step, const char *effect_key, const char *digest,
  int64_t *new_version);
// outcome is "committed" or "not_applied". Never accept caller-supplied
// bool as verification. Remote verification occurs OUTSIDE the write lock.
int wf_reconcile(wf_store *, const char *tenant, const char *run,
  const char *revision, int64_t epoch, int64_t version,
  const char *step, const char *outcome, const char *receipt,
  int64_t *new_version);
int wf_finish(wf_store *, const char *tenant, const char *run,
  const char *revision, int64_t epoch, int64_t version,
  int64_t *new_version);
// Diagnostic-only authenticated snapshot (not a dispatch capability).
int wf_inspect(wf_store *, const char *tenant, const char *run,
  const char *revision, int64_t *epoch, int64_t *version,
  int64_t *prepared, int64_t *in_doubt, int64_t *committed,
  int64_t *not_applied, int64_t *inbox_count);
#ifdef __cplusplus
}
#endif
#endif
