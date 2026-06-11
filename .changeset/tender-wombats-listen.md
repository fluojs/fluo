---
"@fluojs/microservices": patch
---

Tighten microservice transport lifecycle and abort contracts so Kafka, MQTT, Redis Streams, and gRPC re-check cancellation before deferred dispatch, close/listen races cannot reopen an in-progress shutdown, and caller-supplied gRPC servers remain caller-owned during close.
