---
'@fluojs/runtime': major
---

Replace uncoordinated PlatformShell lifecycle overlap with strict exclusive transitions. Every overlapping `start()` or `stop()` now rejects immediately with `PlatformLifecycleConflictError` and structured `PLATFORM_LIFECYCLE_CONFLICT` metadata.

In 2.x, overlapping `start()` calls could start the same components more than once, and `stop()` called during an in-flight startup could return before startup settled and leave resources running. Consumers must now give one application boundary ownership of each transition, wait for that owned promise to settle, and retry explicitly when a rejected operation is still required. Lifecycle callbacks receive the same typed conflict after synchronous or arbitrarily awaited reentry.
