---
'@fluojs/di': patch
---

Retry only failed container-managed `onDestroy()` hooks when disposal is called again, without repeating hooks that already completed successfully. Release a directly disposed request child from its parent after the active attempt settles, including failed attempts, while allowing a caller with the retained child reference to retry its remaining failed hooks.
