---
"@fluojs/http": patch
"@fluojs/platform-fastify": patch
---

Improve `@fluojs/platform-fastify` request dispatch by registering Fastify-native per-route handlers when fluo route metadata can be translated safely, while keeping wildcard fallback behavior for unmatched requests.

Preserve fluo route semantics for params, versioning, middleware/guard/interceptor/observer lifecycle, error handling, SSE, multipart, raw body, and streaming with regression coverage for native route selection.
