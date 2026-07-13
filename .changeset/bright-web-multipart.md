---
'@fluojs/runtime': major
'@fluojs/platform-express': patch
---

Remove the Node.js `Buffer` dependency from Web multipart parsing and expose uploaded file payloads as runtime-neutral `Uint8Array` values.

Preserve Buffer-backed multipart file payloads at the Express Node adapter boundary.

Node-only consumers that use Buffer-specific methods must convert explicitly at their application boundary with `Buffer.from(file.buffer)`.
