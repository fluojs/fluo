---
"@fluojs/microservices": patch
---

Close NATS, RabbitMQ, and Redis Streams microservice transports consistently when listen and close race, preserving shutdown guards and Redis Streams cleanup before surfacing startup failures.
