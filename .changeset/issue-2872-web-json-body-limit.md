---
"@fluojs/runtime": patch
---

Enforce Web JSON request body limits while streaming even when Content-Length appears safe, settle oversized cloned streams without waiting for cancellation, preserve HTTP 413 when cancellation rejects, and deprecate the compatibility-only `preferNativeJsonBodyReader` option.
