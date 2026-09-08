---
"@fluojs/prisma": minor
"@fluojs/drizzle": minor
"@fluojs/mongoose": minor
---

Add a typed `shouldRollback(value)` predicate to the existing, separate
`TransactionBoundaryOptions<T>` for Prisma, Drizzle, and Mongoose transactions,
request transactions, and service decorators. Without this explicit opt-in,
arbitrary resolved values and caught nested exceptions keep their existing
behavior.

A root value rejected by its predicate is returned unchanged only after the
native rollback is positively confirmed. Register the paired `rollbackObserver`
from `createPrismaRollbackObserver`, `createDrizzleRollbackObserver`, or
`createMongooseRollbackObserver` in Fluo runtime/module options. These public
driver capabilities observe Prisma adapter-pg SQL rollback plus cleanup,
node-postgres rollback plus pooled release, and correlated Mongo abort command
acknowledgements. Missing capability rejects before callbacks; insufficient
evidence throws `TransactionRollbackUnconfirmedError`, never a normal Result.
Driver-hidden rollback errors, commit errors, and observed cleanup failures are
not converted into normal Results. Opaque preconstructed Prisma clients, other
drivers without verified observation, and monitoring-disabled Mongo clients do
not implicitly acquire this capability. An opted-in nested failure marks
the shared owner rollback-only. If the outer callback ignores it or returns
success, the boundary rejects with the new `TransactionRollbackOnlyError`, whose
`result` identifies the first rejected nested value. An outer predicate that
rejects its own result instead returns that original outer failure after rollback.

Rollback discards all afterCommit hooks, and native callback retries isolate
policy state and hooks by attempt. Unsupported fail-open boundaries and legacy
decorator targets reject with `TransactionRollbackCapabilityError` before user
work. Native transaction options remain separate, and Mongoose gains no native
options overload. External raw transactions, Redis MULTI/EXEC, savepoints, and
distributed atomicity remain outside this API.
