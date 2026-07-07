---
"@fluojs/platform-cloudflare-workers": patch
---

Align the Cloudflare Workers adapter public seam and lifecycle contract by keeping public Worker declarations on supported package barrels, freezing websocket binding ownership after the first listen boundary, and documenting shutdown/SSE/WebSocket drain behavior with regression coverage.
