---
"@fluojs/http": patch
---

Recheck request cancellation and response commitment after an integration response value finalizer settles. When the request aborts or another path commits the response while the finalizer is pending, the ordinary success path no longer selects a response writer, formats, or sends a late response; uninterrupted finalizers keep their existing writer selection, ordering, HEAD, conditional, and byte-range behavior.
