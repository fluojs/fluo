---
"@fluojs/mongoose": patch
---

Track fail-open manual `transaction(...)` callbacks during shutdown so `dispose(connection)` waits for direct execution to settle before closing application-owned resources.
