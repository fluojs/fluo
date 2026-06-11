---
"@fluojs/queue": patch
---

Fix non-global queue worker discovery so scoped registrations only start workers visible to the importing module graph, and roll back queue-owned BullMQ resources immediately when worker startup fails after bootstrap readiness.
