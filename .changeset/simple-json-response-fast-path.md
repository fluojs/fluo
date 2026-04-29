---
"@fluojs/http": patch
"@fluojs/runtime": patch
"@fluojs/platform-bun": patch
"@fluojs/platform-express": patch
"@fluojs/platform-fastify": patch
---

Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.
