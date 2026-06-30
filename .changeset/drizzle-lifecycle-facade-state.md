---
"@fluojs/drizzle": patch
---

Bind Drizzle facade lifecycle methods to the lifecycle owner so shutdown and status snapshots read the same live state, and align transaction target-resolution docs with the implemented fallback order.
