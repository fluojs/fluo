---
"@fluojs/queue": minor
---

Add an optional caller-owned `deduplicationKey` to `enqueue(...)`, mapped to a BullMQ-safe job id so repeated producer attempts can use idempotency without inheriting BullMQ custom-id restrictions.
