---
"@fluojs/http": patch
---

Finalize managed SSE source iterators on write, frame encoding, drain, and source read failures. Await iterator cleanup before request observers finish and request-scoped resources dispose, preserving the original operation error if cleanup also fails.
