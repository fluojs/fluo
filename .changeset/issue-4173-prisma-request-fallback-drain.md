---
"@fluojs/prisma": patch
---

Keep non-strict `requestTransaction(...)` fallback tracking tied to the real callback settlement during shutdown. When the registered client has no native `$transaction` runner, cancellation still rejects the caller immediately, but the request stays tracked until the actual callback completes or rejects, so `details.activeRequestTransactions` holds above zero and `$disconnect()` no longer races an in-flight fallback callback.
