---
'@fluojs/platform-fastify': patch
---

Make Fastify adapter startup single-flight, keep repeated `listen()` calls idempotent, and wait for an in-flight `close()` before relistening.
