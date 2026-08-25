---
"@fluojs/http": patch
---

Defer request success observers until application and module middleware have fully settled, so middleware failures after `next()` emit only the request error observation.
