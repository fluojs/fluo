---
"@fluojs/http": patch
"@fluojs/platform-bun": patch
"@fluojs/platform-express": patch
"@fluojs/platform-fastify": patch
"@fluojs/runtime": patch
---

Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.
