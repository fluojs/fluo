---
'@fluojs/platform-express': patch
---

Cancel and join in-flight Express adapter listen retry loops during `close()` so a busy-port startup cannot bind after shutdown has already resolved.
