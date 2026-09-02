---
"@fluojs/queue": patch
---

Bound Queue-owned BullMQ queue and Redis connection shutdown to `workerShutdownTimeoutMs`, continuing cleanup and force-disconnecting a timed-out owned Redis connection.
