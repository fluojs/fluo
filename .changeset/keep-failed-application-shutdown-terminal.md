---
"@fluojs/runtime": patch
---

Preserve the documented application lifecycle state transitions while rejecting provider resolution and child microservice startup from shutdown start, and retry failed teardown stages without repeating completed phases.
