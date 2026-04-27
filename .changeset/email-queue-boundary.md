---
"@fluojs/email": patch
---

Restore the email package's optional queue boundary by keeping queue workers behind the `@fluojs/email/queue` subpath and make queued email notification workers fail incomplete provider deliveries so retry/dead-letter handling can run.
