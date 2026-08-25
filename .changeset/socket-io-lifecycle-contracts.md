---
'@fluojs/http': minor
'@fluojs/platform-bun': minor
'@fluojs/socket.io': major
'@fluojs/testing': minor
'@fluojs/websockets': minor
---

Add a versioned fetch-style realtime binding installation capability and expose the shared internal gateway discovery seam for protocol adapters.

Make Socket.IO shutdown drain accepted gateway work before clearing managed state, reject unsupported `serverBacked` gateways consistently, dispatch through canonical handler indexes, and align runtime, migration, and bilingual option documentation.

Existing Socket.IO gateways configured with `@WebSocketGateway({ serverBacked })` must remove that option and use the shared application listener. Consumers that require a dedicated listener must migrate that gateway to `@fluojs/websockets/node` or own a separate Socket.IO server outside this adapter.
