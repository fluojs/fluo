---
"@fluojs/cron": patch
---

Harden distributed lock readiness and shutdown retry semantics so Redis lock I/O outages no longer report ready/healthy and timed-out task lock releases can be retried after the task settles.
