---
"@fluojs/drizzle": patch
---

Track nested request transactions opened inside manual Drizzle transaction boundaries during shutdown so they abort and drain before disposal.
