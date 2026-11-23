---
"@fluojs/socket.io": patch
---

Include in-progress Bun initialization in the shared `shutdown.timeoutMs` bound. Runtime shutdown hooks now fix one deadline on first entry and give pending initialization, Socket.IO close, and accepted gateway work drain only the remaining budget, so hooks still complete when initialization never settles. Initialization that succeeds after the deadline no longer re-exposes server access or reinstalls gateway state; its managed server, Bun engine, and pre-listen binding are cleaned up, and retained state stays available to `SocketIoLifecycleService.retryShutdown()` when late cleanup fails.
