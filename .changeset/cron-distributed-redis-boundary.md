---
"@fluojs/cron": patch
---

Make Redis a distributed-lock-only dependency for `@fluojs/cron`. Non-distributed scheduling no longer loads the Redis peer during import, registration, bootstrap, or status snapshot creation.
