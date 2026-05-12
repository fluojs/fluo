---
"@fluojs/discord": patch
---

Stop retrying permanent Discord webhook failures, wait for Discord bootstrap verification before created/starting lifecycle sends, and reject lifecycle-racing sends with the public `DiscordLifecycleError` before failed bootstrap or shutdown can reuse transports.
