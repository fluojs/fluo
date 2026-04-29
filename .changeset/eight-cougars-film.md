---
'@fluojs/websockets': patch
---

Close active Bun, Deno, and Cloudflare Workers websocket clients during application shutdown so `@OnDisconnect()` cleanup runs consistently before teardown completes.
