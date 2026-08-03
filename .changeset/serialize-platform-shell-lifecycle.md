---
'@fluojs/runtime': major
---

Replace shared and queued PlatformShell lifecycle overlap with strict exclusive transitions. Every overlapping `start()` or `stop()` now rejects immediately with `PlatformLifecycleConflictError` and structured `PLATFORM_LIFECYCLE_CONFLICT` metadata.

Consumers upgrading from 2.x must stop relying on same-operation promise sharing or opposite-operation queueing. Give one application boundary ownership of each transition, wait for that owned promise to settle, and retry explicitly when a rejected operation is still required. Lifecycle callbacks must handle the same typed conflict after synchronous or arbitrarily awaited reentry instead of awaiting a queued shell operation.
