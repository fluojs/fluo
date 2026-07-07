---
"@fluojs/queue": major
---

Harden scoped queue module discovery so non-global registrations stay isolated to the module tree that imported their `QueueModule.forRoot(...)` call, and require the Redis client provider to be reachable from that same graph.
