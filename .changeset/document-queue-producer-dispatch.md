---
"@fluojs/queue": major
---

Clarify that Queue producers must enqueue an instance of the exact `JobClass` constructor registered by `@QueueWorker`; name-and-payload producer dispatch is not supported.

Migration: Node.js 21 support is removed. Node.js 20 before 20.19.3, Node.js 22 before 22.2.0, and Node.js 27+ are also unsupported. Upgrade to Node.js >=20.19.3 <21 or Node.js >=22.2.0 <27. Replace NestJS Bull/BullMQ `queue.add(name, plainPayload)` calls with `queue.enqueue(new JobClass(...))`, importing the same exported job class used by the registered worker. Plain payload objects and duplicate class declarations type-check but are rejected at runtime.
