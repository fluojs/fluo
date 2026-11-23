---
"@fluojs/i18n": patch
---

Prevent in-flight remote catalog loads from refilling or overwriting the cache after `invalidate()` or `clear()`. These calls still let existing loads complete for their original callers.
