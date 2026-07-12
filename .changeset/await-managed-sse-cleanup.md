---
"@fluojs/http": patch
---

Await managed SSE iterator cleanup before disposing request-scoped resources, and report cleanup failures without rewriting committed responses.
