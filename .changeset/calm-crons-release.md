---
'@fluojs/cron': patch
---

Preserve Redis distributed cron locks during startup rollback until active bootstrap-time ticks can drain and release ownership.
