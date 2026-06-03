---
"@fluojs/queue": major
---

Fix queue readiness snapshots so workers are only reported ready after BullMQ processors start, and expose worker start failures through lifecycle/status diagnostics.

Migration note: consumers that exhaustively switch on `QueueLifecycleState` must handle the new `failed` state. Readiness integrations should also expect `started` queue resources to report degraded readiness until every discovered BullMQ worker processor has actually started.
