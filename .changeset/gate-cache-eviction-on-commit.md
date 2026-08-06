---
'@fluojs/cache-manager': patch
---

Gate deferred HTTP cache eviction on a confirmed successful response commit and cancel it when sending fails or the request aborts.
