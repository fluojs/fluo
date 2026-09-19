---
"@fluojs/microservices": major
"@fluojs/cli": patch
---

Consolidate microservice registration on `MicroservicesModule.forRoot(...)`, move transport imports to their dedicated subpaths, and use transport class `create(...)` factories in generated starters. Migrate `module.global` to top-level `global` and replace root transport imports and `createMicroservicesProviders(...)` with the documented module and subpath APIs. Separate gRPC `serverCredentials` and `channelCredentials` in `GrpcMicroserviceTransportOptions` to avoid unsafe reuse of server credentials on outbound clients while preserving explicit migration. Preserve failed `@EventPattern` rejections in `MicroserviceLifecycleService` so durable broker transports (Redis Streams, Kafka, RabbitMQ) can withhold acknowledgement. Ensure CLI generated starters for Kafka and RabbitMQ default to instance-scoped random response destinations and that lazy broker wrappers accurately report framework resource ownership, forward `setLogger()`, and propagate close/cleanup errors.
