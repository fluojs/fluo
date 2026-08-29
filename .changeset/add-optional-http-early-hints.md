---
"@fluojs/http": minor
"@fluojs/runtime": minor
"@fluojs/platform-nodejs": minor
"@fluojs/platform-express": minor
"@fluojs/platform-fastify": minor
"@fluojs/platform-bun": minor
"@fluojs/platform-deno": minor
"@fluojs/platform-cloudflare-workers": patch
---

Add an optional request-scoped Early Hints capability with deterministic write, error, and disconnect behavior.

Emit observable HTTP `103` responses from Node.js, Express, and Fastify without mutating or committing the independently configured final response. Keep Fetch-style Web, Bun, Deno, and Cloudflare Workers responses detectably unsupported through capability absence instead of a silent no-op.
