---
"@fluojs/platform-express": patch
"@fluojs/http": patch
---

Route semantically safe Express native matches through the shared dispatcher native fast path when eligible while preserving full dispatcher fallback, body materialization, error handling, and documented route fallback semantics. Synthetic dispatch requests also preserve request extension data so testing helpers can continue injecting principals into `RequestContext`.
