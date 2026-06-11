---
"@fluojs/socket.io": patch
"@fluojs/runtime": patch
---

Align Socket.IO lifecycle internals and documentation with the audited runtime contracts: defer Node async-context loading until gateway invocation, route provider-scope metadata through the runtime integration seam, document explicit ACK/raw-server migration paths, and add deterministic Bun CORS/test coverage.
