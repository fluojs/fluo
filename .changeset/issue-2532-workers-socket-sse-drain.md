---
"@fluojs/platform-cloudflare-workers": patch
---

Keep Cloudflare Workers shutdown and `executionContext.waitUntil(...)` tracking active until upgraded server WebSockets close, and release SSE lifecycle tracking when synchronous reader or stream setup fails.
