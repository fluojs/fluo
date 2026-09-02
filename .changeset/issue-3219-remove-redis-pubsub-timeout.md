---
"@fluojs/microservices": major
---

Remove the ineffective `requestTimeoutMs` option from `RedisPubSubMicroserviceTransportOptions`.

Migration: Delete `requestTimeoutMs` from Redis Pub/Sub transport construction. Redis Pub/Sub is event-only and `send()` always rejects; use `RedisStreamsMicroserviceTransport` or another request-response transport when a request timeout is required.
