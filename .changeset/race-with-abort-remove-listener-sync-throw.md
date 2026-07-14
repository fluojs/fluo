---
'@fluojs/runtime': patch
---

Remove the abort listener registered by `raceWithAbort(fn, signal)` even when `fn` throws synchronously before returning a promise. The synchronous throw is now converted into a settled rejection so the cleanup-dependent `finally` flow still runs and the listener is not leaked across repeated failed operations.