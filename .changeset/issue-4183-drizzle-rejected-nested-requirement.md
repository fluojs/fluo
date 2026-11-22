---
"@fluojs/drizzle": patch
---

Fix rejected nested Drizzle boundaries changing the owner's cancellation outcome. A nested `transaction(...)` or `requestTransaction(...)` call inside an active native transaction that passed native options together with `requireAfterCommit: true` was rejected for the unsupported nested options, but still enabled the requirement on the shared owner. A late request cancellation arriving while the outer native transaction committed then returned the callback result instead of rejecting with `AbortError`. The requirement is now applied only after the nested boundary is admitted, so a rejected child never changes the owner's result; validly admitted nested requirements still prioritize confirmed commit success.
