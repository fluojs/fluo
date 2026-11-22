---
"@fluojs/prisma": patch
---

Reject `@Transaction()` accessors that return `null` or `undefined` before any transaction runner or decorated method body starts. The decorator no longer falls back to automatic single-target discovery when an explicit accessor is empty, so another registered Prisma client is never selected implicitly. That fallback was undocumented; consumers that relied on it must update their accessor to return the intended registered Prisma service.
