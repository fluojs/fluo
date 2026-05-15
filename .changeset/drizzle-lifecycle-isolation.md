---
"@fluojs/drizzle": patch
---

Isolate async Drizzle module factory results per application container and drain open manual transaction boundaries before disposal during shutdown.
