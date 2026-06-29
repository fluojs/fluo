---
"@fluojs/drizzle": patch
---

Track fail-open manual transaction callbacks during shutdown so `dispose(database)` waits for direct-execution fallbacks to settle before closing application-owned Drizzle resources.
