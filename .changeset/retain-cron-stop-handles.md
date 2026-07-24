---
"@fluojs/cron": patch
---

Retain scheduler handles when stopping a task fails so dynamic removal reports failure and can retry without losing lifecycle ownership.
