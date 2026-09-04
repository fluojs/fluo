---
'@fluojs/cron': patch
---

Prevent delayed distributed lock acquisition from starting a cron task after shutdown closes tick admission.
