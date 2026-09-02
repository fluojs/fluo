---
"@fluojs/microservices": major
---

Redis Streams now enables pending-entry reclaim by default with `pendingReclaimIdleMs: 60_000`. Requests abandoned in the shared request consumer group can be redelivered after a consumer crash, and failed events can be redelivered to the same listener from its instance-scoped event group; handlers must therefore be idempotent. To preserve the prior disabled behavior, set `pendingReclaimIdleMs: 0` (or a negative value). Replacement listeners do not reclaim a crashed listener's event PEL because UUID-scoped event groups preserve broadcast delivery.
