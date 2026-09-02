---
"@fluojs/queue": major
---

Clarify that Queue producers must enqueue an instance of the exact `JobClass` constructor registered by `@QueueWorker`; name-and-payload producer dispatch is not supported.

Migration: replace NestJS Bull/BullMQ `queue.add(name, plainPayload)` calls with `queue.enqueue(new JobClass(...))`, importing the same exported job class used by the registered worker. Plain payload objects and duplicate class declarations type-check but are rejected at runtime.
