---
"@fluojs/prisma": patch
---

Harden default `@Transaction()` target resolution so it selects only branded Prisma service/facade handles, treats unavailable or throwing AsyncLocalStorage host lookups as a graceful unavailable transaction context, and documents the Node.js 20+ runtime boundary.
