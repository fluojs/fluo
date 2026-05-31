---
"@fluojs/socket.io": patch
---

Defer the Bun engine dependency load until the Bun Socket.IO bootstrap path is actually selected, preventing Node server-backed applications from crashing during package import.
