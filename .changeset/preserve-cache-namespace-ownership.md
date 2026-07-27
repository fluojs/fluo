---
'@fluojs/cache-manager': patch
---

Preserve literal Redis reset namespaces and cache-key metadata while ensuring deferred eviction fallback timers do not keep Node.js shutdown alive.
