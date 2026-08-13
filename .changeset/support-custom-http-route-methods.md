---
"@fluojs/core": patch
"@fluojs/http": minor
"@fluojs/platform-bun": minor
"@fluojs/platform-fastify": minor
"@fluojs/testing": minor
---

Add validated uppercase custom HTTP route authoring with `Route(method, path)` and first-class RFC `Query(path)` support while preserving exact-method precedence, versioning, DTO validation, and default response semantics.

Widen the internal route metadata method declaration so HTTP integrations can carry custom tokens, keep custom methods on Bun fetch fallback, and let Fastify wildcard fallback receive registered custom method names without creating native fluo route handoffs.

Expose shared network and fetch-style portability assertions for body-bearing `QUERY` and extension-method routes across supported adapters.
