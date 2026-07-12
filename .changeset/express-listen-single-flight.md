---
'@fluojs/platform-express': patch
---

Reuse one in-flight Express listen lifecycle and reject startup during close so delayed retries cannot outlive shutdown.
