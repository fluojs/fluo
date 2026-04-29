---
'@fluojs/websockets': patch
---

Close active Bun, Deno, and Cloudflare Workers websocket clients during application shutdown and wait up to `shutdown.timeoutMs` for `@OnDisconnect()` cleanup to drain before teardown completes.
