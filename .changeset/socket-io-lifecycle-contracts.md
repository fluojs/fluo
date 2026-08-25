---
'@fluojs/http': minor
'@fluojs/platform-bun': patch
'@fluojs/socket.io': patch
'@fluojs/testing': minor
'@fluojs/websockets': patch
---

Add a versioned fetch-style realtime binding installation capability and expose the shared internal gateway discovery seam for protocol adapters.

Make Socket.IO shutdown drain accepted gateway work before clearing managed state, reject unsupported `serverBacked` gateways consistently, dispatch through canonical handler indexes, and align runtime, migration, and bilingual option documentation.
