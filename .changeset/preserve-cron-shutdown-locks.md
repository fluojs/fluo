---
"@fluojs/cron": patch
---

Preserve active distributed cron locks when bounded shutdown times out so another node cannot start the same job while the original task is still running.
