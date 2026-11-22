---
"@fluojs/persistence": patch
---

Document the existing Mongoose cleanup error identity split in both language READMEs: without registered hooks or a `requireAfterCommit` opt-in, a manual-session `endSession()` failure after a confirmed commit still propagates with its original identity, while hook registration or `requireAfterCommit: true` reports it as the already-committed `AfterCommitCleanupError` with `committed === true` and `cause === cleanupFailure`, and overlapping Result rollback failures stay preserved in `AggregateError.errors` with the earlier failure as `cause`. Documentation clarification of existing behavior only; no runtime change.
