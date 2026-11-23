---
'@fluojs/prisma': patch
---

Correct the ALS-unavailable transaction and readiness documentation: native Prisma transaction runners require ALS, while clients without a native runner can execute callbacks directly in non-strict mode without rollback or after-commit capability requirements. After initialization, that non-transactional path remains ready even when the transaction context is unavailable. Runtime behavior and public APIs are unchanged.
