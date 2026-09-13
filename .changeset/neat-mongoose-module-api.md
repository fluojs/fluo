---
"@fluojs/mongoose": patch
---

Remove `createMongooseProviders()` and `MongooseTransactionInterceptor`.
Register application-owned connections with `MongooseModule.forRoot()` or
`MongooseModule.forRootAsync()`, inject `MongooseConnection`, and keep
request-wide transaction interceptors application-owned by forwarding the
request `AbortSignal` to `requestTransaction(...)`. Connection/session/model
facade behavior and shutdown/disposal ordering are unchanged.
