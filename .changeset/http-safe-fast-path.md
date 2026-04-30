---
"@fluojs/http": patch
"@fluojs/runtime": patch
"@fluojs/platform-fastify": patch
"@fluojs/platform-bun": patch
---

Add conservative HTTP fast-path execution and native route handoff optimizations for singleton-safe routes while preserving middleware, guards, pipes, interceptors, error handling, adapter fallback, raw-body, multipart, streaming, abort, and request-scope behavior.
