---
'@fluojs/cli': patch
---

Settle Studio sidecar ingestion when a local client closes the socket after sending only a partial request body. The sidecar now binds request `close`/`error` events to body-reader cancellation and sends a bounded error completion instead of hanging indefinitely on a malformed local client.