---
"@fluojs/http": patch
---

Cancel managed SSE backpressure waits on request abort or stream close so an unsettled adapter drain cannot delay iterator cleanup or request-scope disposal.
