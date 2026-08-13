---
'@fluojs/microservices': patch
---

Contain malformed NATS request frames and response publication failures at the subscription callback boundary, reporting them through the configured transport logger without closing the caller-owned client.
