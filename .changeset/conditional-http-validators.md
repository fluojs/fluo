---
"@fluojs/http": minor
"@fluojs/runtime": minor
"@fluojs/testing": minor
"@fluojs/platform-express": patch
"@fluojs/platform-fastify": patch
---

Add opt-in dispatcher-owned conditional request handling with strong or weak ETags, Last-Modified normalization, RFC precondition precedence, and bodyless 304/412 responses. Configure `conditionalRequests` through runtime bootstrap and use the expanded portability harness to verify validator behavior across network and Web-style adapters.
