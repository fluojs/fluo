---
"@fluojs/platform-fastify": patch
"@fluojs/testing": patch
---

Add Fastify coverage for the shared HTTP adapter portability harness and extend the harness to verify stream drain waiters settle when a response stream closes before a drain event.
