---
"@fluojs/cron": patch
---

Bound post-task distributed lock release and its immediate shutdown retry to one `shutdown.timeoutMs` deadline while preserving unresolved local ownership visibility.
