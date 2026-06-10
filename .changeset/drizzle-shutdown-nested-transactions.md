---
"@fluojs/drizzle": patch
---

Reject nested Drizzle transaction calls once application shutdown begins so ambient transaction reuse cannot bypass the documented shutdown boundary.
