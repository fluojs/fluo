---
"@fluojs/socket.io": major
---

Require Socket.IO 4.8.3 or newer. Consumers using an older Socket.IO v4 release must upgrade the peer and refresh their lockfile so the patched Engine.IO WebSocket chain is installed; the fluo adapter API is unchanged.

Migration: Node.js 21 support is removed. Node.js 20 before 20.19.3, Node.js 22 before 22.2.0, and Node.js 27+ are also unsupported. Upgrade to Node.js >=20.19.3 <21 or Node.js >=22.2.0 <27.
