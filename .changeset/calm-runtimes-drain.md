---
"@fluojs/runtime": patch
---

Reject oversized Web multipart request bodies immediately without waiting for
another chunk, while preventing late producer work from becoming an unhandled
rejection.
