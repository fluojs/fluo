---
'@fluojs/di': patch
---

Retain failed container-managed `onDestroy()` hooks for a later explicit disposal retry while never repeating hooks that already completed successfully.
