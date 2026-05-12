---
"@fluojs/prisma": patch
---

Reject new request-scoped Prisma transactions after shutdown starts and keep nested request transaction cleanup visible until the outer manual transaction settles.
