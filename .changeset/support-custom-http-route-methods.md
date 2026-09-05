---
"@fluojs/core": patch
"@fluojs/cli": major
"@fluojs/graphql": major
"@fluojs/http": minor
"@fluojs/platform-bun": minor
"@fluojs/platform-cloudflare-workers": minor
"@fluojs/platform-express": major
"@fluojs/platform-fastify": major
"@fluojs/platform-nodejs": major
"@fluojs/runtime": major
"@fluojs/testing": major
---

Add validated uppercase custom HTTP route authoring with `Route(method, path)` and first-class RFC `Query(path)` support while preserving exact-method precedence, versioning, DTO validation, and default response semantics.

Widen the internal route metadata method declaration so HTTP integrations can carry custom tokens, keep custom methods on Bun fetch fallback, and let Fastify wildcard fallback receive registered custom method names without creating native fluo route handoffs.

Expose shared network and fetch-style portability assertions for body-bearing `QUERY` and extension-method routes across supported adapters.

Require Node.js `>=24.0.0 <27` for published Node listener paths and generated Node HTTP starters so RFC `QUERY` reaches framework dispatch. This final coordinated-release policy supersedes the earlier listener-only Node floor. Bun and Deno fetch-style adapter contracts are unchanged. Cloudflare Workers' documented fetch-style contract includes body-bearing `QUERY` and extension-method dispatch through its Worker fetch handler.

Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Regenerated Node HTTP projects use the same Node support range. Custom-method and portability additions remain part of this one upcoming release per package.
