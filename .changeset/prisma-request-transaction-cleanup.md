---
"@fluojs/prisma": patch
---

Ensure request-scoped transaction bookkeeping is released when Prisma transaction validation fails before the request transaction starts.
