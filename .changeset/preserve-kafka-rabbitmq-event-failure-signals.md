---
"@fluojs/microservices": minor
---

Preserve Kafka and RabbitMQ inbound event handler failure signals. `KafkaMicroserviceTransport` and `RabbitMqMicroserviceTransport` now implement the optional `setLogger()` transport hook and report inbound event handler failures as `Event handler failed.` through the configured microservice logger, matching the NATS, MQTT, gRPC, Redis Pub/Sub, and Redis Streams transports. The documented delivery-safety contract is unchanged: the event failure is still rethrown so the consumer callback rejects and broker adapters can withhold acknowledgement or retry, and a logger that throws no longer masks that failure. No fallback `console.error` is emitted when no logger is configured, and request-handler errors continue to round-trip as error responses without being logged as event failures.
