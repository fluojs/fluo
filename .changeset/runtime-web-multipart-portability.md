---
"@fluojs/runtime": patch
---

Keep Web runtime multipart uploads portable across Web-standard hosts by returning `Uint8Array` file buffers, and make Node adapter listen retries cancellable during shutdown.
