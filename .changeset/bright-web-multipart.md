---
'@fluojs/runtime': major
---

Remove the Node.js `Buffer` dependency from Web multipart parsing and expose uploaded file payloads as runtime-neutral `Uint8Array` values.

Node-only consumers that use Buffer-specific methods must convert explicitly at their application boundary with `Buffer.from(file.buffer)`.
