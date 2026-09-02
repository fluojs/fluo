---
"@fluojs/microservices": major
---

Complete the NestJS microservices migration guide with explicit handler discovery, transport selection, streaming, shutdown, completion, and broker-resource ownership rules.

Migration: register decorated public handler classes in a compiled module, configure a concrete adapter through `MicroservicesModule.forRoot(...)`, and inject `MICROSERVICE` as the lifecycle facade. Replace NestJS `Transport.REDIS` request/reply use with a request/reply-capable transport or `emit(...)`, because `RedisPubSubMicroserviceTransport.send(...)` always rejects. Use the explicit transport subpaths where available, keep Redis Streams on the root barrel, and migrate gRPC streaming handlers to the corresponding streaming pattern decorator.
