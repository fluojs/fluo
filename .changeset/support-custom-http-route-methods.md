---
"@fluojs/core": patch
"@fluojs/cli": major
"@fluojs/graphql": major
"@fluojs/http": minor
"@fluojs/platform-bun": minor
"@fluojs/platform-express": major
"@fluojs/platform-fastify": major
"@fluojs/platform-nodejs": major
"@fluojs/runtime": major
"@fluojs/testing": major
---

Add validated uppercase custom HTTP route authoring with `Route(method, path)` and first-class RFC `Query(path)` support while preserving exact-method precedence, versioning, DTO validation, and default response semantics.

Widen the internal route metadata method declaration so HTTP integrations can carry custom tokens, keep custom methods on Bun fetch fallback, and let Fastify wildcard fallback receive registered custom method names without creating native fluo route handoffs.

Expose shared network and fetch-style portability assertions for body-bearing `QUERY` and extension-method routes across supported adapters.

Require Node.js 20.19.3 or newer for published Node listener paths and generated Node HTTP starters so RFC `QUERY` reaches framework dispatch. Upgrade existing Node listener deployments and regenerated Node HTTP projects to Node.js 20.19.3 or newer; Bun, Deno, and Cloudflare Workers fetch-style adapter contracts are unchanged.
