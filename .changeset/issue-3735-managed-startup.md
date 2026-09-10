---
"@fluojs/platform-fastify": patch
"@fluojs/platform-express": patch
"@fluojs/platform-nodejs": patch
"@fluojs/platform-bun": patch
"@fluojs/platform-deno": patch
"@fluojs/cli": patch
"@fluojs/runtime": patch
"@fluojs/graphql": patch
---

Consolidate managed HTTP startup on concrete adapter static creation and `FluoFactory.create(...)`.
Keep migrated GraphQL test fixtures out of published build artifacts.
