---
"@fluojs/cron": patch
---

Retain scheduler handles when stopping a task fails so dynamic disable and removal report failure and can retry without losing lifecycle ownership.
