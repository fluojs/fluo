---
"@fluojs/prisma": minor
"@fluojs/drizzle": minor
"@fluojs/mongoose": minor
---

Add `afterCommit(callback)` to the Prisma, Drizzle, and Mongoose wrappers for
cache invalidation and other in-process work after a successful native commit.
Export `AfterCommitCallback`, `TransactionBoundaryOptions`,
`AfterCommitCapabilityError`, and `AfterCommitError`. Transaction and request
boundaries and their decorators accept Fluo boundary options after their existing
arguments. Opt into `{ requireAfterCommit: true }` to reject unsupported native
commit capability before the user callback without changing legacy native options,
transaction defaults, or fail-open fallback.

Callback registration scopes close before native commit begins. Hooks drain
sequentially in registration order outside the ended transaction
context, with nested boundaries sharing the owning queue and Mongoose callback
retries retaining only the final successful attempt's queue. Shutdown awaits
drain. Registration without an open supported native scope is rejected.
All hooks settle even after failures; `AfterCommitError` reports
`committed: true`, every FIFO result, and all failure reasons. Do not retry the
already-committed database write after this error.

Mongoose also exports `AfterCommitCleanupError`, a separate direct subclass of
`AggregateError`, for manual `endSession()` failure after confirmed commit when
hooks are registered or `requireAfterCommit: true` is required by a root or nested
boundary. It still attempts all hooks outside the ended context, reports `committed: true`
and the cleanup failure as `cause`, keeps `results` limited to FIFO hook outcomes,
and orders `errors` as the cleanup failure followed by rejected hook reasons.
Handle it separately from `AfterCommitError` without retrying the database write.
Legacy boundaries with no hooks and no opt-in preserve raw cleanup error identity
and the existing request cancellation `AbortError`.

Document bilingual consumer examples and the shared transaction contract.
This does not track external raw-client transactions or Redis commits, provide
DB+Redis atomicity, or guarantee durable outbox delivery or crash/network
exactly-once execution.
