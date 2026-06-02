---
"@fluojs/http": patch
---

Reduce dispatcher fast-path overhead by keeping cached singleton handler execution on the synchronous path when controller resolution, handler return, and response writing do not require awaiting.
