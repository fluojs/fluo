---
'@fluojs/config': patch
---

Coalesce rapid env-file watch events before reloading so change-then-revert bursts preserve the committed config snapshot and do not notify reload listeners.
