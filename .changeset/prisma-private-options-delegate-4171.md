---
"@fluojs/prisma": patch
---

Store the Prisma wrapper's internal transaction option state under a symbol-keyed property instead of the facade's `serviceOptions` name. A generated Prisma delegate named `serviceOptions` now routes through the module-owned facade to the root client outside transaction boundaries and to the active transaction client inside them, matching `current()`, while public wrapper methods keep their existing priority and internal `strictTransactions`/rollback-observer handling is unchanged.
