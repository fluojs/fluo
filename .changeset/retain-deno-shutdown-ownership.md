---
'@fluojs/platform-deno': patch
---

Retain the managed Deno server controller after graceful shutdown fails until server termination is confirmed, then rethrow the original shutdown error.
