---
'@fluojs/http': minor
'@fluojs/platform-bun': minor
'@fluojs/socket.io': major
'@fluojs/testing': minor
'@fluojs/websockets': minor
---

Add an optional, independently versioned fetch-style realtime binding installation extension while preserving the public capability version 1 contract, and expose the shared internal gateway discovery seam for protocol adapters.

Make Socket.IO attach connection lifecycle buffering before asynchronous gateway resolution, drain accepted gateway work before clearing managed state, share one bounded attempt across runtime shutdown hooks with explicit `retryShutdown()` recovery, clean pre-listen Bun bindings after bootstrap failure, reject unsupported `serverBacked` gateways consistently, dispatch through canonical handler indexes, and align runtime manifests, migration, and bilingual option documentation.

Existing Socket.IO gateways configured with `@WebSocketGateway({ serverBacked })` must remove that option and use the shared application listener. Consumers that require a dedicated listener must migrate that gateway to `@fluojs/websockets/node` or own a separate Socket.IO server outside this adapter.
