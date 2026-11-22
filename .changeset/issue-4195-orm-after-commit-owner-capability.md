---
"@fluojs/prisma": patch
"@fluojs/drizzle": patch
"@fluojs/mongoose": patch
---

Apply the package owner capability check to `@Transaction` decorators invoked with only `requireAfterCommit: true`. A target that supplies `transaction` and a callable `afterCommit` but is not a compatible same-realm package owner (missing owner/version marker or incomplete consumed surface) is now rejected with `AfterCommitCapabilityError` before the target runner, the decorated method, or any hook executes, restoring the documented capability preflight. Omitting the requirement or passing `requireAfterCommit: false` keeps the legacy allowed path, native option positions, and fail-open behavior unchanged, and `shouldRollback` keeps its existing `TransactionRollbackCapabilityError` priority.
