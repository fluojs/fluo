---
'@fluojs/platform-fastify': patch
---

Make Fastify adapter startup single-flight and keep repeated `listen()` calls idempotent without replacing the live dispatcher or rebinding the listener.
