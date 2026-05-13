---
"@fluojs/runtime": major
---

Keep Web runtime multipart uploads portable across Web-standard hosts by returning `Uint8Array` file buffers, and make Node adapter listen retries cancellable during shutdown.

This is a breaking change for consumers that typed `UploadedFile.buffer` as Node.js `Buffer` or called Buffer-only methods on multipart uploads. Update multipart handlers to treat `UploadedFile.buffer` as `Uint8Array`, and wrap it with `Buffer.from(file.buffer)` only when Node-specific Buffer APIs are required.
