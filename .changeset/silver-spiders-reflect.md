---
"@fluojs/websockets": patch
---

Ensure Node WebSocket shutdown rejects in-flight async upgrades and waits for bounded disconnect cleanup before clearing connection state.
