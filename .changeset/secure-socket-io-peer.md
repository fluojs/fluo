---
"@fluojs/socket.io": major
---

Require Socket.IO 4.8.3 or newer. Consumers using an older Socket.IO v4 release must upgrade the peer and refresh their lockfile so the patched Engine.IO WebSocket chain is installed; the fluo adapter API is unchanged.

Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.
