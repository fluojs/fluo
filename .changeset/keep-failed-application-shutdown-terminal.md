---
"@fluojs/runtime": patch
---

Preserve the documented application lifecycle state transitions and terminal operation gate, reject provider and child microservice operations once shutdown starts, and resume incomplete adapter or lifecycle-hook stages without repeating completed runtime phases. Container-managed `onDestroy()` hooks remain terminal best-effort cleanup and individual failed hooks are not retried by a later application close.
