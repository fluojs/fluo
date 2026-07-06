---
"@fluojs/http": major
---

Change the public `ResponseFormatter.format(...)` return contract from Node-specific `Buffer` to runtime-neutral `Uint8Array` bytes, preserving the root HTTP API portability guarantee. Existing Node.js formatters that return `Buffer` still satisfy the interface because `Buffer` implements `Uint8Array`; callers should use `Uint8Array` byte APIs instead of Buffer-specific methods.
