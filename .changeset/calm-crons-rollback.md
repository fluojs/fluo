---
"@fluojs/cron": patch
---

Make dynamic cron expression and interval cadence replacements roll back when the previous scheduler handle cannot be stopped, cleaning up the provisional replacement before restoring the prior descriptor and handle.
