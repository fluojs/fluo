---
"@fluojs/graphql": patch
---

Align the documented GraphQL runtime boundary with the effective mandatory dependency floor by requiring Node.js 20.16.0 or newer and treating Bun, Deno, and Cloudflare Workers as unsupported until native runtime verification exists.
