---
"@fluojs/http": minor
"@fluojs/testing": minor
"@fluojs/platform-express": patch
"@fluojs/platform-fastify": patch
"@fluojs/runtime": patch
---

Add portable `setCookie` and `clearCookie` response helpers with ordered, non-folded `Set-Cookie` fields and whole-second lifetime semantics across adapters. Add response-cookie portability assertions for Node, Express, Fastify, Web, Bun, Deno, and Workers.
