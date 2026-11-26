---
"@fluojs/prisma": patch
---

Clean up Prisma adapter transactions acquired but rejected by the rollback observer before application work starts. Preserve the capability inspection failure alongside any native rollback or cleanup failures so callers can diagnose each cause.
