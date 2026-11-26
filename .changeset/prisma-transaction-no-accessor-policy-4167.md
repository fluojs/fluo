---
"@fluojs/prisma": patch
---

Reject a third `Transaction` argument without an accessor function in strict TypeScript and at decorator creation, before the method body runs. Put boundary policy in the second argument for compatibility calls, or use `Transaction(accessor, nativeOptions, boundary)`.

This is a patch defect fix: all documented working call forms keep their behavior; the rejected form previously discarded policy silently.
