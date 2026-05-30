---
"@fluojs/socket.io": patch
---

Reject invalid explicit Socket.IO numeric configuration and make shutdown timeout cleanup deterministic by force-disconnecting managed clients before lifecycle state is cleared.
