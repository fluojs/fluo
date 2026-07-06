---
"@fluojs/prisma": patch
---

Reject new outer manual `transaction(...)` and service `@Transaction()` boundaries after Prisma shutdown starts while preserving the existing drain-before-disconnect contract for already-open boundaries.
