---
"@fluojs/queue": patch
---

Bound BullMQ worker force-close attempts to `workerShutdownTimeoutMs` so Queue shutdown continues closing owned queues and Redis connections when force-close never settles.
