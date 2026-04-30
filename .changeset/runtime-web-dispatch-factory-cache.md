---
"@fluojs/runtime": patch
"@fluojs/platform-bun": patch
"@fluojs/platform-cloudflare-workers": patch
"@fluojs/platform-deno": patch
---

Reuse shared Web request-response factories across adapter requests while preserving per-request body materialization and error/fallback response semantics.
