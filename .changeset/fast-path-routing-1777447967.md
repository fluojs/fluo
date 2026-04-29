---
"@fluojs/http": patch
"@fluojs/runtime": patch
"@fluojs/platform-fastify": patch
"@fluojs/platform-express": patch
---

Add fast path for HTTP routing when adapter has already matched the route, skipping duplicate matching.
