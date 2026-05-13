---
"@fluojs/socket.io": patch
---

Honor explicit namespace paths for Socket.IO room helper joins and leaves even when the same socket id is already registered in another namespace, and configure Bun raw-server bindings before listen when no gateways are discovered.
