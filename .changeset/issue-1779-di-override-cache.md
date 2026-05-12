---
"@fluojs/di": patch
---

Fix container override logic to correctly invalidate child request-scope caches, and make `register` and `override` atomically commit multi-provider changes to prevent partial graph corruption on provider initialization failures.
