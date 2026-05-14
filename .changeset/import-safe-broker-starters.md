---
"@fluojs/cli": patch
---

Keep generated NATS, Kafka, and RabbitMQ starters import-safe by lazily creating broker clients inside the Fluo-owned transport lifecycle instead of during module import.
