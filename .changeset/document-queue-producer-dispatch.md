---
"@fluojs/queue": major
---

Clarify that Queue producers must enqueue an instance of the exact `JobClass` constructor registered by `@QueueWorker`; name-and-payload producer dispatch is not supported.

Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Replace NestJS Bull/BullMQ `queue.add(name, plainPayload)` calls with `queue.enqueue(new JobClass(...))`, importing the same exported job class used by the registered worker. Plain payload objects and duplicate class declarations type-check but are rejected at runtime.
