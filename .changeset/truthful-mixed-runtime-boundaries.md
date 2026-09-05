---
"@fluojs/runtime": major
"@fluojs/config": major
"@fluojs/platform-nodejs": major
"@fluojs/platform-express": patch
"@fluojs/platform-fastify": patch
"@fluojs/graphql": patch
"@fluojs/openapi": patch
"@fluojs/websockets": patch
---

Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.
