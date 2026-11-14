---
"@fluojs/http": patch
---

Acquire managed SSE source iterators before committing the SSE response. When `[Symbol.asyncIterator]()` throws, no SSE transport or abort/close listener is left open and the failure follows the standard dispatch error path; a failure while committing the SSE response releases the acquired iterator through `return()`.
