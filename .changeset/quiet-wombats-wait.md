---
"@fluojs/platform-cloudflare-workers": patch
---

Attach Cloudflare Worker `env` and execution context to framework requests, and keep Worker `waitUntil`/shutdown drains open until SSE (`text/event-stream`) response bodies finish.
