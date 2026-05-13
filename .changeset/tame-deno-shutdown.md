---
"@fluojs/platform-deno": patch
---

Preserve Deno adapter graceful shutdown by draining active requests before aborting the serve signal, and document the required Deno websocket binding setup with regression coverage for shutdown and global Deno seams.
