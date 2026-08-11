---
"@fluojs/cron": patch
---

Retry retained Cron scheduler handles on the next shutdown lifecycle hook after a stop failure, clearing lifecycle ownership only once scheduler cleanup succeeds.
