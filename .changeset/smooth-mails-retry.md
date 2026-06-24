---
"@fluojs/email": patch
---

Normalize lazy email transport factory failures so send-triggered initialization rejects with `EmailLifecycleError` and clears rejected transport state before shutdown.
