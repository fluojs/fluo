---
'@fluojs/cron': patch
---

Ignore inactive task lock TTL overrides when distributed locking is disabled and call `unref()` on lock renewal timers so bounded shutdown can allow the Node.js process to exit.
