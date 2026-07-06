---
"@fluojs/passport": patch
---

Preserve the documented `AuthHandledResult` contract so every `handled:true` result remains terminal after the strategy commits a response, including results that also include a principal.
