---
'@fluojs/drizzle': patch
---

Keep aborted fail-open request transaction callbacks in the shutdown drain until their direct execution settles, and preserve the root-handle ALS context so nested request work inherits ambient cancellation and drain ownership without becoming atomic.
