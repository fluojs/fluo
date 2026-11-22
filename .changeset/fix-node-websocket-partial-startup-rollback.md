---
"@fluojs/websockets": patch
---

Close accepted Node WebSocket connections with code 1001 and await disconnect handlers when a later dedicated listener fails during bootstrap.
