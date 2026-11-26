---
"@fluojs/mongoose": patch
---

Keep nested request transactions tracked until their owning session settles. Manual and delegated transactions now wait for started nested request work before rolling back and cleaning up the session when the outer callback fails. Work in the nested request's context can still use the ambient session while the outer callback is open. Once the outer callback settles, only still-running nested request callbacks can use that session, and they cannot open a new transaction boundary during the wait.
