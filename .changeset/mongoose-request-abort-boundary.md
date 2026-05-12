---
"@fluojs/mongoose": patch
---

Preserve request abort and shutdown guarantees for Mongoose transaction boundaries by racing request cancellation against session acquisition and delegated `connection.transaction(...)` startup, and by rejecting new manual or request-scoped transactions once shutdown begins.
