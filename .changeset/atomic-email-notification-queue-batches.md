---
"@fluojs/queue": minor
"@fluojs/email": patch
---

Add atomic ordered `enqueueMany(...)` batches to Queue and use them for built-in email notification batches, preserving each notification identity as its backing-queue deduplication key.
