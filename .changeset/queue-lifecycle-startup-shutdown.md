---
"@fluojs/queue": patch
---

Serialize queue shutdown with in-flight startup so queue-owned BullMQ workers, queues, and Redis duplicate connections are closed reliably during overlapping application lifecycle transitions.
