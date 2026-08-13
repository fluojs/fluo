---
"@fluojs/runtime": patch
---

Preserve the documented application lifecycle state transitions while rejecting provider lookups after asynchronous resolution when shutdown has started, rejecting child microservice startup from shutdown start, and retrying failed teardown stages without repeating completed phases.
