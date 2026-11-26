---
"@fluojs/mongoose": patch
---

Keep nested request transactions tracked until their owning session settles. Manual and delegated transactions now wait for started nested request work before rolling back and cleaning up the session when the outer callback fails. Running nested request callbacks can still use the ambient session while the outer transaction waits for them.
