---
'@fluojs/socket.io': patch
---

Serialize Bun Socket.IO server initialization, publish the server only after realtime binding succeeds, and clean partial resources so failed initialization can be retried safely.
