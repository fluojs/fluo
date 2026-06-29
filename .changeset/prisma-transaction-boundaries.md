---
"@fluojs/prisma": patch
---

Preserve Prisma transaction boundaries during shutdown by draining active service/manual transactions before disconnect, and avoid binding `@Transaction()` to non-Prisma transaction-like host properties.
