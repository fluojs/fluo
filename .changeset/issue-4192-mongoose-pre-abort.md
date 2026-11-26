---
"@fluojs/mongoose": patch
---

Reject a top-level delegated `MongooseConnection.requestTransaction()` with an `AbortError` when its signal is already aborted, without starting the native transaction or calling application code. Cancellation after native startup retains the existing cleanup and drain behavior.
