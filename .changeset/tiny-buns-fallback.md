---
"@fluojs/platform-bun": patch
---

Harden Bun adapter startup so websocket upgrade requests fall back to HTTP dispatch unless the realtime binding actually upgrades the request, and omit the native `routes` option unless safe Bun routes are concretely enabled.
