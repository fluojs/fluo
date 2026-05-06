---
"@fluojs/websockets": patch
---

Normalize WebSocket binary payload limits across supported runtimes (Deno, Bun, Cloudflare Workers, Node). Size calculations for array buffers and typed arrays now correctly count bytes instead of falling through to `undefined` or `0`, fixing an issue where standard binary frames could prematurely trigger "Payload too large" disconnects or bypass limits.
