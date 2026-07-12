---
'@fluojs/platform-express': patch
---

Reuse one in-flight Express listen lifecycle so concurrent startup callers cannot leave a delayed retry alive after shutdown.
