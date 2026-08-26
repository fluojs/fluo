---
"@fluojs/http": minor
"@fluojs/testing": minor
"@fluojs/platform-fastify": patch
---

Add portable `setCookie` and `clearCookie` response helpers with ordered, non-folded `Set-Cookie` fields and whole-second lifetime semantics across adapters. Add response-cookie portability assertions and preserve repeated fields in the Fastify adapter.
