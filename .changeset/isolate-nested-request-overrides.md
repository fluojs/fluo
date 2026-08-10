---
'@fluojs/di': patch
---

Keep nested request-scope overrides owned and cached by their nearest request scope instead of leaking request-local instances into root singleton caches.
