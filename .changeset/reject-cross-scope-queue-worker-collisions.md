---
"@fluojs/queue": patch
---

Reject queue bootstrap when workers in different registration scopes would consume the same Redis-backed BullMQ `jobName`.
