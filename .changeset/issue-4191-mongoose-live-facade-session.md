---
"@fluojs/mongoose": patch
---

Resolve the active session when invoking a supported operation on a retained model facade or method. Reusing it in a later transaction on the same wrapper uses that transaction's session; calls without an active session forward arguments unchanged.
