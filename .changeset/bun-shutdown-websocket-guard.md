---
"@fluojs/platform-bun": patch
---

Reject Bun websocket upgrade attempts with the documented 503 shutdown response once adapter close begins, keeping shutdown ingress behavior consistent across HTTP and realtime paths.
