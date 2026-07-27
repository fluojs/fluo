---
'@fluojs/drizzle': patch
---

Keep aborted fail-open request transaction callbacks in the shutdown drain until their direct execution settles, while continuing to reject the caller immediately on abort.
