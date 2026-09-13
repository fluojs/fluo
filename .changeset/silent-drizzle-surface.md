---
'@fluojs/drizzle': patch
---

BREAKING: Register Drizzle through `DrizzleModule.forRoot(...)` or `DrizzleModule.forRootAsync(...)` and inject `DrizzleDatabase` or `DrizzleDatabaseFacade<TDatabase>` instead of calling `DrizzleDatabase.createFacade(...)`. Replace `DrizzleTransactionInterceptor` with an explicit `DrizzleDatabase.requestTransaction(() => work, request.signal)` boundary so request cancellation remains part of the transaction contract.
