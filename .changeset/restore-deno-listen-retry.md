---
'@fluojs/platform-deno': patch
---

Restore the adapter's pre-listen state when `Deno.serve(...)` throws so requests remain gated and a later listen attempt can retry.
