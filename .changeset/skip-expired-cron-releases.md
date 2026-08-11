---
"@fluojs/cron": patch
---

Skip Redis lock release I/O after the Cron shutdown deadline expires while retaining unresolved local ownership for status reporting.
