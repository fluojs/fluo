---
"@fluojs/cache-manager": patch
---

Cancel deferred cache eviction when `response.send(...)` rejects so failed response commits do not clear previously cached successful reads.
