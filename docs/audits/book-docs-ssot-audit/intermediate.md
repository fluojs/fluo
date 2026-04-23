# book-docs-ssot-audit-intermediate

## Part Metadata
- Part: `intermediate`
- Execution order slot: `2`
- SSOT snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Report path: `docs/audits/book-docs-ssot-audit/intermediate.md`
- Assigned chapter list: `book/intermediate/ch00-introduction.ko.md` through `book/intermediate/ch25-final.ko.md` (`26` chapters)
- Chapter inventory: `book/intermediate/ch00-introduction.ko.md`, `book/intermediate/ch01-microservices-intro.ko.md`, `book/intermediate/ch02-tcp.ko.md`, `book/intermediate/ch03-redis-transport.ko.md`, `book/intermediate/ch04-rabbitmq.ko.md`, `book/intermediate/ch05-kafka.ko.md`, `book/intermediate/ch06-nats.ko.md`, `book/intermediate/ch07-mqtt.ko.md`, `book/intermediate/ch08-grpc.ko.md`, `book/intermediate/ch09-event-bus.ko.md`, `book/intermediate/ch10-cqrs.ko.md`, `book/intermediate/ch11-queue.ko.md`, `book/intermediate/ch12-cron.ko.md`, `book/intermediate/ch13-websockets.ko.md`, `book/intermediate/ch14-socketio.ko.md`, `book/intermediate/ch15-notifications.ko.md`, `book/intermediate/ch16-email.ko.md`, `book/intermediate/ch17-slack-discord.ko.md`, `book/intermediate/ch18-graphql.ko.md`, `book/intermediate/ch19-mongoose.ko.md`, `book/intermediate/ch20-drizzle.ko.md`, `book/intermediate/ch21-express-node.ko.md`, `book/intermediate/ch22-bun.ko.md`, `book/intermediate/ch23-deno.ko.md`, `book/intermediate/ch24-cloudflare.ko.md`, `book/intermediate/ch25-final.ko.md`
- Excluded surfaces: `book/README*`, `book/*/toc*`, English `book/**/ch*.md`, Korean `docs/**` authority inputs, hubs, indexes, navigation aids
- Aggregate chapter status counts: `mixed=0`, `real_issue=0`, `insufficient_ssot=26`, `false_positive=0`, `no_issues=0`
- Mapping source note: `Frozen before reviewer fan-out per chapter.`
- Accepted finding field schema: `Canonical Title:`, `Severity:`, `Book:`, `Docs:`, `Problem:`, `Rationale:`.
- Accepted finding lint status: `0 accepted findings currently remain in this intermediate report; any future accepted finding in this snapshot must expose the explicit field schema above or be downgraded out of Accepted Findings.`

## Chapter Inventory
- `book/intermediate/ch00-introduction.ko.md`
- `book/intermediate/ch01-microservices-intro.ko.md`
- `book/intermediate/ch02-tcp.ko.md`
- `book/intermediate/ch03-redis-transport.ko.md`
- `book/intermediate/ch04-rabbitmq.ko.md`
- `book/intermediate/ch05-kafka.ko.md`
- `book/intermediate/ch06-nats.ko.md`
- `book/intermediate/ch07-mqtt.ko.md`
- `book/intermediate/ch08-grpc.ko.md`
- `book/intermediate/ch09-event-bus.ko.md`
- `book/intermediate/ch10-cqrs.ko.md`
- `book/intermediate/ch11-queue.ko.md`
- `book/intermediate/ch12-cron.ko.md`
- `book/intermediate/ch13-websockets.ko.md`
- `book/intermediate/ch14-socketio.ko.md`
- `book/intermediate/ch15-notifications.ko.md`
- `book/intermediate/ch16-email.ko.md`
- `book/intermediate/ch17-slack-discord.ko.md`
- `book/intermediate/ch18-graphql.ko.md`
- `book/intermediate/ch19-mongoose.ko.md`
- `book/intermediate/ch20-drizzle.ko.md`
- `book/intermediate/ch21-express-node.ko.md`
- `book/intermediate/ch22-bun.ko.md`
- `book/intermediate/ch23-deno.ko.md`
- `book/intermediate/ch24-cloudflare.ko.md`
- `book/intermediate/ch25-final.ko.md`

## Chapter Reports

### `book/intermediate/ch00-introduction.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/glossary-and-mental-model.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/platform-consistency-design.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 insufficient_ssot candidate; example-code=no_issues; coverage/edge-case=1 insufficient_ssot candidate; adjudication=1 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Intermediate distributed-systems roadmap exceeds the frozen package/runtime authority`
  - Book: `book/intermediate/ch00-introduction.ko.md:18-21`, `book/intermediate/ch00-introduction.ko.md:25-42`, `book/intermediate/ch00-introduction.ko.md:47-57`
  - Docs: `docs/reference/package-surface.md:12-15`, `docs/reference/package-surface.md:23-28`, `docs/reference/package-surface.md:47-53`; `docs/reference/package-chooser.md:24-38`, `docs/reference/package-chooser.md:64-73`; `docs/reference/glossary-and-mental-model.md:37-40`
  - Rationale: The frozen English docs confirm the existence of the relevant package families, runtime adapters, and adapter-first portability model, but they do not document the manuscript's broader distributed-systems teaching claims strongly enough to adjudicate them as either contradictions or validated no-issue facts, including the specific FluoShop service split, outbox/idempotency guidance, and transport-swap operational promises.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch01-microservices-intro.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/architecture/architecture-overview.md`, `docs/contracts/nestjs-parity-gaps.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=no_issues; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Microservice decorator and module API walkthrough outruns the frozen docs surface`
  - Book: `book/intermediate/ch01-microservices-intro.ko.md:11-12`, `book/intermediate/ch01-microservices-intro.ko.md:58-77`, `book/intermediate/ch01-microservices-intro.ko.md:96-118`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:66-66`; `docs/contracts/nestjs-parity-gaps.md:17-17`
  - Rationale: The mapped English docs prove that `@fluojs/microservices` exists and covers the documented transport family, but they do not document `MicroservicesModule.forRoot(...)`, `@MessagePattern`, `@EventPattern`, or the `MICROSERVICE` token deeply enough to support a dual-citation contradiction or code-error ruling on the chapter's detailed API teaching surface.
- `Transport-portability promise is broader than the frozen microservice starter authority`
  - Book: `book/intermediate/ch01-microservices-intro.ko.md:52-55`, `book/intermediate/ch01-microservices-intro.ko.md:79-83`, `book/intermediate/ch01-microservices-intro.ko.md:120-124`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/fluo-new-support-matrix.md:10-12`, `docs/reference/fluo-new-support-matrix.md:20-27`; `docs/architecture/architecture-overview.md:37-40`
  - Rationale: The frozen docs establish that fluo ships multiple microservice transport variants and preserves explicit package-boundary rules, but they stay too silent on the stronger manuscript claim that transport migration is purely a configuration swap with stable handler interfaces in all cases, so the chapter must remain fail-closed rather than upgraded to `no_issues`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch02-tcp.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/contracts/nestjs-parity-gaps.md`, `docs/architecture/lifecycle-and-shutdown.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 insufficient_ssot candidate; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `TCP client and handler API details exceed the frozen microservice transport docs`
  - Book: `book/intermediate/ch02-tcp.ko.md:9-10`, `book/intermediate/ch02-tcp.ko.md:61-90`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:32-32`, `docs/reference/package-chooser.md:66-66`; `docs/contracts/nestjs-parity-gaps.md:17-17`
  - Rationale: The mapped English docs confirm TCP as a supported `@fluojs/microservices` transport and starter path, but they do not document `TcpMicroserviceTransport`, the `MICROSERVICE` token, `Microservice.send()`, or handler-decorator signatures strongly enough to prove or disprove the chapter's specific example-code and API-shape claims.
- `TCP framing, timeout, and shutdown semantics are underdocumented in the frozen authority set`
  - Book: `book/intermediate/ch02-tcp.ko.md:55-61`, `book/intermediate/ch02-tcp.ko.md:110-147`, `book/intermediate/ch02-tcp.ko.md:167-175`
  - Docs: `docs/reference/fluo-new-support-matrix.md:10-12`, `docs/reference/fluo-new-support-matrix.md:20-28`; `docs/architecture/lifecycle-and-shutdown.md:9-18`, `docs/architecture/lifecycle-and-shutdown.md:28-44`
  - Rationale: The frozen English docs cover the existence of the TCP starter and the generic runtime bootstrap/close lifecycle, but they remain too silent on NDJSON framing, the `1 MiB` frame boundary, `requestTimeoutMs`, TCP-specific readiness claims, and error-frame behavior to support a safe contradiction or no-issue decision.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch03-redis-transport.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/guides/decision-guide.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Redis transport class and delivery-semantics walkthrough outruns the frozen docs`
  - Book: `book/intermediate/ch03-redis-transport.ko.md:9-12`, `book/intermediate/ch03-redis-transport.ko.md:26-48`, `book/intermediate/ch03-redis-transport.ko.md:54-79`, `book/intermediate/ch03-redis-transport.ko.md:120-133`
  - Docs: `docs/reference/package-surface.md:47-48`; `docs/reference/package-chooser.md:33-33`, `docs/reference/package-chooser.md:48-50`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:26-27`; `docs/guides/decision-guide.md:30-36`
  - Rationale: The frozen English docs distinguish the broader `@fluojs/microservices` transport surface, the shipped `redis-streams` starter, and `@fluojs/redis` as a separate Redis integration choice, but they do not document `RedisPubSubMicroserviceTransport`, `RedisStreamsMicroserviceTransport`, Pub/Sub-vs-Streams delivery semantics, or `duplicate()`-style client wiring strongly enough for contradiction-grade adjudication.
- `Streams response-path and retention details exceed the frozen Redis authority`
  - Book: `book/intermediate/ch03-redis-transport.ko.md:82-103`, `book/intermediate/ch03-redis-transport.ko.md:105-113`, `book/intermediate/ch03-redis-transport.ko.md:137-151`
  - Docs: `docs/reference/package-surface.md:47-48`; `docs/reference/package-chooser.md:33-33`, `docs/reference/package-chooser.md:48-50`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:26-27`
  - Rationale: The mapped English docs are strong enough to confirm Redis Streams as a published starter and broader Redis integration choice, but they are too silent on late `xack`, pending-entry recovery, per-consumer response streams, `${namespace}:responses:${consumerId}` naming, `responseRetentionMaxLen`, and `close()` cleanup behavior to accept or reject the chapter's detailed delivery-contract walkthrough.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch04-rabbitmq.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/guides/decision-guide.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `RabbitMQ collaborator and queue-surface walkthrough exceeds the frozen transport docs`
  - Book: `book/intermediate/ch04-rabbitmq.ko.md:38-62`, `book/intermediate/ch04-rabbitmq.ko.md:68-88`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:36-36`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:21-27`; `docs/guides/decision-guide.md:32-35`
  - Rationale: The frozen English docs prove that RabbitMQ is a supported `@fluojs/microservices` transport and runnable starter path, but they do not document `RabbitMqMicroserviceTransport`, caller-supplied `publisher`/`consumer` collaborator contracts, queue-option names, default queue behavior, or the chapter's `MicroservicesModule.forRoot({ transport })` wiring details strongly enough for a contradiction-grade or code-error ruling.
- `RabbitMQ response, failure, and dead-letter semantics outrun the frozen authority set`
  - Book: `book/intermediate/ch04-rabbitmq.ko.md:127-182`, `book/intermediate/ch04-rabbitmq.ko.md:210-235`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:36-36`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:21-27`; `docs/guides/decision-guide.md:32-35`
  - Rationale: The mapped English docs confirm transport availability only. They stay too silent on UUID-scoped `responseQueue` defaults, `replyTo` correlation, `requestId` tracking, `listen()`-before-`send()` safety, `RabbitMqTransportMessage` error frames, and caller-owned DLX/redrive policy to support an accepted factual contradiction or a cleared no-issue decision.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch05-kafka.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/guides/decision-guide.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Kafka collaborator, topic, and request-reply API walkthrough exceeds the frozen docs`
  - Book: `book/intermediate/ch05-kafka.ko.md:38-60`, `book/intermediate/ch05-kafka.ko.md:66-118`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:35-35`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:21-27`; `docs/guides/decision-guide.md:32-35`
  - Rationale: The frozen English docs establish Kafka as a published `@fluojs/microservices` transport and starter choice, but they do not publish `KafkaMicroserviceTransport`, caller-owned producer/consumer collaborator shapes, `eventTopic`/`messageTopic`/`responseTopic` options, UUID-based response-topic defaults, abort-mode distinctions, or `requestId` correlation behavior strongly enough to adjudicate the chapter's detailed API and workflow claims.
- `Kafka timeline, consumer-group, partition, and replay semantics exceed the frozen docs`
  - Book: `book/intermediate/ch05-kafka.ko.md:122-175`, `book/intermediate/ch05-kafka.ko.md:181-220`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:35-35`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:21-27`; `docs/guides/decision-guide.md:32-35`
  - Rationale: The mapped English docs are strong enough to confirm Kafka starter coverage, but they remain too thin on consumer-group isolation, offset-based replay, partition-ordering guarantees, retention expectations, and the manuscript's `orderId` keying guidance to support either a contradiction-grade finding or a safe `no_issues` outcome.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch06-nats.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/guides/decision-guide.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `NATS client, codec, and request-timeout walkthrough exceeds the frozen docs`
  - Book: `book/intermediate/ch06-nats.ko.md:31-45`, `book/intermediate/ch06-nats.ko.md:58-87`, `book/intermediate/ch06-nats.ko.md:97-123`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:34-34`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:21-27`; `docs/guides/decision-guide.md:32-33`
  - Rationale: The frozen English docs prove only that NATS is a supported `@fluojs/microservices` starter path. They do not document `NatsMicroserviceTransport`, caller-owned `client`/`codec` contracts, default subject names, `client.request(...)` mapping, Inbox correlation behavior, or the claimed default-vs-overridden timeout semantics strongly enough for dual-citation acceptance.
- `NATS logger-driven failure and control-plane role claims outrun the frozen authority`
  - Book: `book/intermediate/ch06-nats.ko.md:127-166`, `book/intermediate/ch06-nats.ko.md:170-185`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:34-34`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:21-27`; `docs/guides/decision-guide.md:32-33`
  - Rationale: The mapped English docs confirm that NATS is an available transport choice, but they stay silent on logger-only event-failure handling, the absence of raw `console.error` fallback, cache-invalidation fan-out behavior, and the chapter's stronger control-plane role split between NATS, Kafka, RabbitMQ, and Redis Streams, so the batch must remain fail-closed.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch07-mqtt.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/guides/decision-guide.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `MQTT transport class, option surface, and request-reply walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch07-mqtt.ko.md:43-67`, `book/intermediate/ch07-mqtt.ko.md:71-91`, `book/intermediate/ch07-mqtt.ko.md:101-119`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:37-37`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:21-21`, `docs/reference/fluo-new-support-matrix.md:26-26`; `docs/guides/decision-guide.md:35-35`
  - Rationale: The frozen English docs confirm only that MQTT is a supported `@fluojs/microservices` transport and runnable starter choice. They do not document `MqttMicroserviceTransport`, caller-provided-versus-URL-owned client setup, `namespace`/`eventTopic`/`messageTopic`/`replyTopic` derivation, `requestTimeoutMs`, QoS/retain option names, or `requestId`/reply-topic correlation strongly enough for contradiction-grade adjudication.
- `MQTT retained-state, QoS, and edge-operations semantics outrun the frozen authority set`
  - Book: `book/intermediate/ch07-mqtt.ko.md:22-24`, `book/intermediate/ch07-mqtt.ko.md:37-39`, `book/intermediate/ch07-mqtt.ko.md:122-176`, `book/intermediate/ch07-mqtt.ko.md:184-188`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:37-37`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:21-21`, `docs/reference/fluo-new-support-matrix.md:26-26`; `docs/guides/decision-guide.md:35-35`
  - Rationale: The mapped English docs are sufficient to prove transport availability and starter coverage, but they stay silent on retained snapshot behavior, QoS 0/1/2 trade-offs, duplicate-delivery expectations, broker-auth and namespace guidance, timeout-rate observability, and the chapter's last-known-value versus replay teaching claims. Under the runbook's fail-closed rule, those stronger MQTT delivery and operations semantics must remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch08-grpc.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/reference/toolchain-contract-matrix.md`, `docs/guides/decision-guide.md`, `docs/contracts/nestjs-parity-gaps.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `gRPC proto-first transport API and unary metadata walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch08-grpc.ko.md:31-52`, `book/intermediate/ch08-grpc.ko.md:56-75`, `book/intermediate/ch08-grpc.ko.md:79-105`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:38-38`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:21-21`, `docs/reference/fluo-new-support-matrix.md:26-26`; `docs/reference/toolchain-contract-matrix.md:21-21`; `docs/guides/decision-guide.md:36-36`; `docs/contracts/nestjs-parity-gaps.md:17-17`
  - Rationale: The frozen English docs prove that gRPC is a supported `@fluojs/microservices` transport, a runnable starter choice, and part of the shipped starter matrix with transport-specific proto wiring, but they do not document `GrpcMicroserviceTransport`, `protoPath`/`packageName`/`services`/`requestTimeoutMs`/`kindMetadataKey` option names or defaults, `<Service>.<Method>` pattern mapping, `x-fluo-kind` behavior, or pre-handler payload-shape guarantees strongly enough for a contradiction or code-error ruling.
- `gRPC streaming, deadline, cancellation, and logger semantics outrun the frozen authority`
  - Book: `book/intermediate/ch08-grpc.ko.md:107-157`, `book/intermediate/ch08-grpc.ko.md:161-179`
  - Docs: `docs/reference/package-surface.md:47-47`; `docs/reference/package-chooser.md:38-38`, `docs/reference/package-chooser.md:66-66`; `docs/reference/fluo-new-support-matrix.md:10-10`, `docs/reference/fluo-new-support-matrix.md:21-21`, `docs/reference/fluo-new-support-matrix.md:26-26`; `docs/reference/toolchain-contract-matrix.md:21-21`; `docs/contracts/nestjs-parity-gaps.md:17-17`
  - Rationale: The mapped English docs are strong enough to confirm that gRPC support includes streaming decorators at a high level, but they remain too silent on `@ServerStreamPattern`, `@ClientStreamPattern`, `@BidiStreamPattern`, `ServerStreamWriter`, cancellation and backpressure guarantees, the claimed default `3,000ms` timeout and `DEADLINE_EXCEEDED` mapping, or the manuscript's logger-only failure-observability statements. Those runtime-semantics claims therefore stay fail-closed as `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch09-event-bus.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/architecture/cqrs.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs prove package presence and in-process CQRS event handling only, not the chapter's detailed event-bus API, Redis fan-out wiring, or domain-event operational semantics.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Event-bus API, stable key, and Redis fan-out walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch09-event-bus.ko.md:48-94`, `book/intermediate/ch09-event-bus.ko.md:103-121`, `book/intermediate/ch09-event-bus.ko.md:141-178`
  - Docs: `docs/reference/package-surface.md:15-15`; `docs/architecture/cqrs.md:5-5`, `docs/architecture/cqrs.md:13-14`, `docs/architecture/cqrs.md:33-40`
  - Rationale: The frozen English docs confirm that `@fluojs/event-bus` exists within the published patterns family and that CQRS publishes one event type to zero or more singleton handlers, locally first and in-process by default, before delegating a final publication step through `@fluojs/event-bus`. They do not publish `EventBusModule.forRoot(...)`, `RedisEventBusTransport`, `EventBusLifecycleService`, `@OnEvent(...)`, or stable `eventKey` guidance strongly enough for a dual-citation contradiction or code-error ruling.
- `Write-boundary publication timing and domain-event operating rules outrun the frozen authority`
  - Book: `book/intermediate/ch09-event-bus.ko.md:95-127`, `book/intermediate/ch09-event-bus.ko.md:184-223`
  - Docs: `docs/reference/package-surface.md:15-15`; `docs/architecture/cqrs.md:13-14`, `docs/architecture/cqrs.md:33-40`
  - Rationale: The mapped English docs are strong enough to establish one-to-many event handling and the in-process-first CQRS publication path, but they stay too silent on the manuscript's stronger rules about publishing only after successful write completion, versioned routing-key contracts, idempotent handler discipline under duplicate distributed delivery, and the broader event-bus progression narrative. Under the runbook's fail-closed rule, those claims remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch10-cqrs.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/architecture/cqrs.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English CQRS contract is explicit on message routing, handler discovery, and saga re-entry limits, but too thin for the chapter's broader CQRS teaching surface and end-to-end FluoShop orchestration narrative.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `CQRS handler, bus, and module walkthrough exceed the frozen contract surface`
  - Book: `book/intermediate/ch10-cqrs.ko.md:23-27`, `book/intermediate/ch10-cqrs.ko.md:35-56`, `book/intermediate/ch10-cqrs.ko.md:72-119`, `book/intermediate/ch10-cqrs.ko.md:139-156`
  - Docs: `docs/reference/package-surface.md:15-15`; `docs/architecture/cqrs.md:5-5`, `docs/architecture/cqrs.md:11-25`, `docs/architecture/cqrs.md:31-35`
  - Rationale: The frozen English docs explicitly cover constructor-based point-to-point command and query routing, zero-or-more event handlers, `@Saga(...)` triggers, handler-shape requirements, and `CqrsModule.forRoot(...)` as the module entrypoint. They do not, however, publish the manuscript's fuller API-teaching surface around `ICommandHandler`, `IQuery`, `IQueryHandler`, `ISaga`, `CommandBusLifecycleService` injection, `QueryBusLifecycleService` usage, or the exact example-code wiring strongly enough to accept or reject it with contradiction-grade confidence.
- `Saga orchestration boundaries and read/write evolution guidance outrun the frozen docs`
  - Book: `book/intermediate/ch10-cqrs.ko.md:125-127`, `book/intermediate/ch10-cqrs.ko.md:160-204`
  - Docs: `docs/reference/package-surface.md:15-15`; `docs/architecture/cqrs.md:13-14`, `docs/architecture/cqrs.md:33-41`
  - Rationale: The mapped English authority confirms that CQRS event publication runs local handlers first, then saga dispatch, then delegated publication through `@fluojs/event-bus`, and that unsafe saga re-entry or depth beyond `32` fails with `SagaTopologyError`. It stays too silent on the chapter's broader process-manager framing, queue-or-scheduler boundary recommendations for long-running loops, read-model evolution guidance, and full FluoShop fulfillment storyline to support a safe `real_issue` or `no_issues` outcome.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch11-queue.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm only package presence, Redis dependency, and optional named-client routing for queue usage, not the chapter's detailed queue API or delivery-policy semantics.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Queue module, worker discovery, and enqueue API walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch11-queue.ko.md:35-59`, `book/intermediate/ch11-queue.ko.md:72-110`
  - Docs: `docs/reference/package-surface.md:15-15`; `docs/reference/package-chooser.md:67-67`, `docs/reference/package-chooser.md:83-83`
  - Rationale: The frozen English docs prove only that `@fluojs/queue` is part of the published patterns family, that background jobs use `@fluojs/queue` with `@fluojs/redis`, and that `clientName` can redirect the Redis dependency edge. They do not document `QueueModule.forRoot()`, `QueueWorker(...)`, `QueueLifecycleService`, worker discovery, or the example enqueue surface strongly enough for contradiction-grade adjudication.
- `Retry, backoff, and dead-letter operational semantics outrun the frozen authority`
  - Book: `book/intermediate/ch11-queue.ko.md:114-172`
  - Docs: `docs/reference/package-surface.md:15-15`; `docs/reference/package-chooser.md:67-67`, `docs/reference/package-chooser.md:83-83`
  - Rationale: The mapped English docs are too thin to validate or refute the manuscript's stronger queue-contract claims, including per-worker `attempts` and `backoff` configuration, the `fluo:queue:dead-letter:<jobName>` key shape, the default retention of `1_000` dead-letter entries, or the chapter's operational guidance on when queues should replace synchronous follow-up work. Those claims therefore remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch12-cron.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/architecture/lifecycle-and-shutdown.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm only that cron scheduling exists, can share the default Redis path or switch via clientName, and that fluo has generic runtime shutdown guarantees, not the chapter's cron-specific distributed-lock and scheduler-runtime semantics.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Cron module, decorator, and runtime-registry walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch12-cron.ko.md:35-82`, `book/intermediate/ch12-cron.ko.md:126-148`
  - Docs: `docs/reference/package-surface.md:15-15`; `docs/reference/package-chooser.md:68-68`, `docs/reference/package-chooser.md:83-83`
  - Rationale: The frozen English docs confirm only that `@fluojs/cron` is a published patterns package, that it is the scheduled-jobs package choice, and that named Redis registration can take over the package's default Redis dependency edge. They do not publish `CronModule.forRoot(...)`, `@Cron`, `@Interval`, `@Timeout`, `CronExpression`, or `SCHEDULING_REGISTRY` strongly enough to support a dual-citation contradiction or code-error ruling on the chapter's API walkthrough.
- `Distributed locking, lock TTL, and bounded scheduler shutdown semantics outrun the frozen authority`
  - Book: `book/intermediate/ch12-cron.ko.md:83-125`, `book/intermediate/ch12-cron.ko.md:150-187`
  - Docs: `docs/reference/package-surface.md:15-15`; `docs/reference/package-chooser.md:68-68`, `docs/reference/package-chooser.md:83-83`; `docs/architecture/lifecycle-and-shutdown.md:32-44`
  - Rationale: The mapped English docs provide generic runtime shutdown ordering and the general note that `@fluojs/cron` can follow the default or named Redis path, but they do not document the chapter's stronger scheduler-specific claims about Redis-backed distributed locks, `distributed.lockTtlMs >= 1_000`, lock renewal while work is active, dynamic schedule replacement behavior, or a cron-module-specific `10_000ms` bounded drain/warning contract. Those semantics must stay fail-closed as `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch13-websockets.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/architecture/architecture-overview.md`, `docs/reference/glossary-and-mental-model.md`, `docs/contracts/manifest-decision.md`, `docs/contracts/platform-conformance-authoring-checklist.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm only that `@fluojs/websockets` is the transport-neutral realtime gateway package with published subpaths and websocket-conformance obligations, not the chapter's detailed gateway decorators, guard hooks, or runtime-mode semantics.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `WebSocket module, gateway decorator, and guard walkthrough exceed the frozen realtime docs`
  - Book: `book/intermediate/ch13-websockets.ko.md:8-14`, `book/intermediate/ch13-websockets.ko.md:37-55`, `book/intermediate/ch13-websockets.ko.md:56-125`, `book/intermediate/ch13-websockets.ko.md:253-258`
  - Docs: `docs/reference/package-surface.md:13-15`, `docs/reference/package-surface.md:53-53`; `docs/reference/package-chooser.md:64-65`; `docs/architecture/architecture-overview.md:11-11`, `docs/architecture/architecture-overview.md:29-29`, `docs/architecture/architecture-overview.md:37-40`; `docs/reference/glossary-and-mental-model.md:24-24`
  - Rationale: The frozen English docs prove only that `@fluojs/websockets` is the transport-neutral realtime package and that configurable packages may expose `forRoot(...)`-style entrypoints. They do not publish `WebSocketModule.forRoot(...)`, `@WebSocketGateway`, `@OnConnect`, `@OnMessage`, `@OnDisconnect`, `limits`, or `upgrade.guard` strongly enough to support a contradiction-grade or code-error ruling on the chapter's API walkthrough.
- `Cross-runtime subpath, heartbeat, server-backed, and shared-path semantics outrun the frozen websocket authority`
  - Book: `book/intermediate/ch13-websockets.ko.md:166-183`, `book/intermediate/ch13-websockets.ko.md:185-237`, `book/intermediate/ch13-websockets.ko.md:241-258`
  - Docs: `docs/reference/package-surface.md:13-13`, `docs/reference/package-surface.md:53-53`; `docs/reference/package-chooser.md:64-64`; `docs/contracts/manifest-decision.md:36-45`; `docs/contracts/platform-conformance-authoring-checklist.md:35-36`
  - Rationale: The mapped English docs are strong enough to confirm transport-neutral WebSocket authoring, published subpaths for `@fluojs/websockets`, and fetch-style websocket conformance fields at the adapter layer. They stay too silent on the manuscript's stronger claims about Node/Bun/Deno/Workers subpath names, default heartbeat behavior, `serverBacked` listeners, shared-path gateway routing, and the specific production guarantees attached to those modes, so the chapter must remain fail-closed as `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch14-socketio.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/architecture/architecture-overview.md`, `docs/reference/glossary-and-mental-model.md`, `docs/contracts/third-party-extension-contract.md`, `docs/contracts/testing-guide.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm only that `@fluojs/socket.io` is the Socket.IO-compatible realtime adapter package and that module-style integrations should keep explicit entrypoints and typed tokens, not the chapter's concrete room, auth, Bun-engine, or test-helper surface.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Socket.IO module, room-service, auth-guard, and raw-server walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch14-socketio.ko.md:34-64`, `book/intermediate/ch14-socketio.ko.md:66-165`, `book/intermediate/ch14-socketio.ko.md:242-247`
  - Docs: `docs/reference/package-surface.md:13-13`, `docs/reference/package-surface.md:40-40`; `docs/reference/package-chooser.md:65-65`; `docs/architecture/architecture-overview.md:11-11`, `docs/architecture/architecture-overview.md:29-29`, `docs/architecture/architecture-overview.md:37-40`; `docs/reference/glossary-and-mental-model.md:24-24`; `docs/contracts/third-party-extension-contract.md:17-18`, `docs/contracts/third-party-extension-contract.md:43-48`
  - Rationale: The frozen English docs prove only that `@fluojs/socket.io` is the package for Socket.IO semantics and that reusable integrations should publish explicit module entrypoints and typed tokens. They do not document `SocketIoModule.forRoot(...)`, `SOCKETIO_ROOM_SERVICE`, `SocketIoRoomService`, `auth.connection`, `auth.message`, `SOCKETIO_SERVER`, or `broadcastToRoom(...)` strongly enough to accept or reject the chapter's detailed API and wiring claims.
- `Bun engine, volatile delivery, and gateway-testing claims outrun the frozen Socket.IO authority`
  - Book: `book/intermediate/ch14-socketio.ko.md:166-247`
  - Docs: `docs/reference/package-surface.md:13-13`, `docs/reference/package-surface.md:40-40`; `docs/reference/package-chooser.md:65-65`; `docs/contracts/testing-guide.md:7-12`, `docs/contracts/testing-guide.md:29-34`
  - Rationale: The mapped English docs confirm only the existence of the Socket.IO-compatible integration and the repository's generic testing taxonomy. They stay too silent on automatic Bun-engine switching, room-array broadcast behavior, volatile-message delivery semantics, and the chapter's specific gateway-mocking/testing surface, so those stronger runtime and testing claims remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch15-notifications.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/glossary-and-mental-model.md`, `docs/contracts/third-party-extension-contract.md`, `docs/architecture/architecture-overview.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm only that `@fluojs/notifications` is the shared orchestration layer for provider-specific channels and that configurable integrations should use explicit module entrypoints and tokens, not the chapter's richer dispatch, queue, and lifecycle-event contract.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Notification channel, service, and module API walkthrough exceed the frozen orchestration docs`
  - Book: `book/intermediate/ch15-notifications.ko.md:21-31`, `book/intermediate/ch15-notifications.ko.md:35-105`, `book/intermediate/ch15-notifications.ko.md:189-198`
  - Docs: `docs/reference/package-surface.md:15-15`, `docs/reference/package-surface.md:48-48`; `docs/reference/package-chooser.md:69-69`; `docs/reference/glossary-and-mental-model.md:24-24`; `docs/contracts/third-party-extension-contract.md:17-18`, `docs/contracts/third-party-extension-contract.md:43-48`; `docs/architecture/architecture-overview.md:37-40`
  - Rationale: The frozen English docs establish only that `@fluojs/notifications` owns a shared notification orchestration layer and that configurable integrations should publish explicit module entrypoints and typed tokens. They do not publish `NotificationChannel`, `NotificationsService`, `dispatch(...)`, `NotificationsModule.forRoot(...)`, `NOTIFICATIONS`, or the exact request/receipt shapes strongly enough for contradiction-grade adjudication.
- `Queue-backed delivery and lifecycle-event semantics outrun the frozen notifications authority`
  - Book: `book/intermediate/ch15-notifications.ko.md:107-177`
  - Docs: `docs/reference/package-surface.md:15-15`, `docs/reference/package-surface.md:48-49`; `docs/reference/package-chooser.md:67-70`
  - Rationale: The mapped English docs confirm that notifications orchestration exists, that queueing is a separate Redis-backed package choice, and that email provides its own first-party queue worker integration. They do not document `queue.adapter`, `bulkThreshold`, `publishLifecycleEvents`, the `notification.dispatch.*` event names, or the manuscript's stronger delivery-completion semantics, so these claims must remain fail-closed as `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch16-email.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/glossary-and-mental-model.md`, `docs/contracts/manifest-decision.md`, `docs/contracts/third-party-extension-contract.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm that `@fluojs/email` is a transport-agnostic email core with a Node-only SMTP subpath, published subpath exports, and first-party notifications/queue integration, but not the chapter's concrete module APIs, token names, renderer hooks, or status helpers.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Email module, service, and notifications-channel walkthrough exceed the frozen email docs`
  - Book: `book/intermediate/ch16-email.ko.md:21-24`, `book/intermediate/ch16-email.ko.md:25-55`, `book/intermediate/ch16-email.ko.md:56-123`
  - Docs: `docs/reference/package-surface.md:49-50`; `docs/reference/package-chooser.md:70-71`; `docs/reference/glossary-and-mental-model.md:24-24`; `docs/contracts/third-party-extension-contract.md:17-18`, `docs/contracts/third-party-extension-contract.md:43-48`
  - Rationale: The frozen English docs prove that `@fluojs/email` is a transport-agnostic email core, that `@fluojs/email/node` is the Node.js SMTP subpath, and that module-style integrations should keep explicit entrypoints and typed tokens. They do not publish `EmailModule.forRoot(...)`, `EmailService.send(...)`, `verifyOnModuleInit`, `EMAIL_CHANNEL`, `createNodemailerEmailTransportFactory(...)`, or the exact async notifications wiring strongly enough to support a contradiction or code-error verdict.
- `Email queue, templating, and platform-status semantics outrun the frozen authority`
  - Book: `book/intermediate/ch16-email.ko.md:125-199`
  - Docs: `docs/reference/package-surface.md:49-50`; `docs/reference/package-chooser.md:70-71`; `docs/contracts/manifest-decision.md:33-45`
  - Rationale: The mapped English docs are strong enough to confirm first-party email queue integration, the Node-only SMTP subpath, and that `@fluojs/email` intentionally publishes extra subpaths such as `./queue` and `./node` while keeping runtime-specific surfaces out of the portable root contract. They stay too silent on `createEmailNotificationsQueueAdapter(...)`, bulk-threshold behavior, template-renderer option shapes, `createEmailPlatformStatusSnapshot(...)`, and the chapter's Terminus/readiness guidance, so those details remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch17-slack-discord.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/glossary-and-mental-model.md`, `docs/contracts/third-party-extension-contract.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm only that `@fluojs/slack` and `@fluojs/discord` are webhook-first delivery cores that can also register first-party notifications channels, not the chapter's concrete transport helpers, token names, formatting APIs, retry behavior, or status snapshots.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Slack and Discord module, webhook transport, standalone service, and notifications-channel walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch17-slack-discord.ko.md:21-25`, `book/intermediate/ch17-slack-discord.ko.md:27-124`
  - Docs: `docs/reference/package-surface.md:51-52`; `docs/reference/package-chooser.md:72-73`; `docs/reference/glossary-and-mental-model.md:24-24`; `docs/contracts/third-party-extension-contract.md:17-18`, `docs/contracts/third-party-extension-contract.md:43-48`
  - Rationale: The frozen English docs prove only that `@fluojs/slack` and `@fluojs/discord` are webhook-first delivery cores that can register first-party notifications channels, and that configurable integrations should keep explicit module entrypoints and typed tokens. They do not document `createSlackWebhookTransport(...)`, `createDiscordWebhookTransport(...)`, `SlackModule.forRoot(...)`, `DiscordModule.forRoot(...)`, `SLACK_CHANNEL`, `DISCORD_CHANNEL`, `SlackService`, or `DiscordService` strongly enough for contradiction-grade adjudication.
- `Rich formatting, retry/error, and status-snapshot semantics outrun the frozen chat-delivery authority`
  - Book: `book/intermediate/ch17-slack-discord.ko.md:126-209`
  - Docs: `docs/reference/package-surface.md:51-52`; `docs/reference/package-chooser.md:72-73`
  - Rationale: The mapped English docs are sufficient to confirm webhook-first Slack and Discord delivery at a high level, but they stay silent on Block Kit and Embed payload support, automatic retry rules for `408`/`429`/`5xx`, `SlackTransportError` and `DiscordTransportError`, and `createSlackPlatformStatusSnapshot(...)`. Under the runbook's fail-closed rule, those richer formatting and runtime-behavior claims must remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch18-graphql.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/architecture/architecture-overview.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm only that `@fluojs/graphql` extends the HTTP stack with GraphQL schema exposure, resolver execution, and subscriptions, not the chapter's detailed module API, decorator surface, DataLoader helper contract, or operational defaults.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `GraphQL module, resolver decorator, and DataLoader walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch18-graphql.ko.md:23-28`, `book/intermediate/ch18-graphql.ko.md:38-39`, `book/intermediate/ch18-graphql.ko.md:42-121`
  - Docs: `docs/reference/package-surface.md:10-10`, `docs/reference/package-surface.md:44-44`; `docs/reference/package-chooser.md:11-18`; `docs/architecture/architecture-overview.md:11-11`, `docs/architecture/architecture-overview.md:23-23`, `docs/architecture/architecture-overview.md:37-40`
  - Rationale: The frozen English docs prove only that `@fluojs/graphql` is an HTTP-stack feature package responsible for GraphQL schema exposure and resolver execution. They do not publish `GraphqlModule.forRoot(...)`, `@Resolver`, `@Query`, `@Mutation`, `@Arg`, `createDataLoader(...)`, or the request-scoped loader contract strongly enough to support a contradiction-grade or code-error ruling on the chapter's detailed API and example-code walkthrough.
- `Subscription transport defaults, runtime-portability promise, and operational guardrails outrun the frozen GraphQL authority`
  - Book: `book/intermediate/ch18-graphql.ko.md:25-29`, `book/intermediate/ch18-graphql.ko.md:123-192`
  - Docs: `docs/reference/package-surface.md:44-44`; `docs/reference/package-chooser.md:13-13`; `docs/architecture/architecture-overview.md:11-11`, `docs/architecture/architecture-overview.md:23-23`, `docs/architecture/architecture-overview.md:49-49`
  - Rationale: The mapped English docs are strong enough to confirm subscription support at a high level and that feature packages must extend documented framework seams rather than inventing alternate lifecycles. They stay too silent on the manuscript's stronger claims about SSE-as-default subscriptions, optional WebSocket enablement, `maxDepth`/`maxComplexity`/`maxCost` guardrails, production introspection defaults, and no-code-change portability across Node.js, Bun, Deno, and edge runtimes, so those semantics must remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch19-mongoose.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/guides/decision-guide.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/transactions.md`, `docs/architecture/observability.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm that `@fluojs/mongoose` is the document-database adapter and that the shared transaction contract exposes `current()` and `currentSession()` plus `MongooseTransactionInterceptor`, but not the chapter's broader module lifecycle, repository/model, discriminator, or health-snapshot teaching surface.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Mongoose module, connection lifecycle, and repository walkthrough exceed the frozen persistence docs`
  - Book: `book/intermediate/ch19-mongoose.ko.md:23-28`, `book/intermediate/ch19-mongoose.ko.md:37-83`
  - Docs: `docs/reference/package-surface.md:14-14`; `docs/reference/package-chooser.md:40-48`; `docs/guides/decision-guide.md:16-24`; `docs/architecture/architecture-overview.md:11-11`, `docs/architecture/architecture-overview.md:27-27`; `docs/architecture/transactions.md:13-13`, `docs/architecture/transactions.md:20-20`, `docs/architecture/transactions.md:31-34`, `docs/architecture/transactions.md:41-42`
  - Rationale: The frozen English docs confirm only that `@fluojs/mongoose` is the package for document-database integration and that its transaction contract keeps the root connection on `current()`, exposes the ambient session on `currentSession()`, and performs session-backed cleanup during request and shutdown paths. They do not publish `MongooseModule.forRoot(...)`, caller-supplied `connection` and `dispose` options, automatic `onApplicationBootstrap` / `beforeApplicationShutdown` lifecycle wiring, or repository-level `model(...)` usage strongly enough for contradiction-grade adjudication.
- `Request-scoped transaction, discriminator-model, and status-snapshot claims outrun the frozen Mongoose authority`
  - Book: `book/intermediate/ch19-mongoose.ko.md:83-147`
  - Docs: `docs/reference/package-surface.md:14-14`; `docs/reference/package-chooser.md:46-46`; `docs/guides/decision-guide.md:22-22`; `docs/architecture/transactions.md:13-13`, `docs/architecture/transactions.md:20-23`, `docs/architecture/transactions.md:31-42`; `docs/architecture/observability.md:18-29`
  - Rationale: The mapped English docs are explicit on the shared Mongoose transaction-context contract, including `MongooseConnection.transaction(fn)`, `MongooseTransactionInterceptor`, request-abort handling, and explicit session passing to model operations. They remain too silent on the chapter's stronger end-to-end claims about controller-wide automatic commit behavior, discriminator-based catalog modeling, `createMongoosePlatformStatusSnapshot(...)`, and Mongoose-specific health/observability helper surfaces, so the batch must stay fail-closed as `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch20-drizzle.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/guides/decision-guide.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/transactions.md`, `docs/architecture/observability.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm that `@fluojs/drizzle` is the relational adapter with ALS-backed transaction context, `current()`, and `DrizzleTransactionInterceptor`, but not the chapter's concrete module factory, driver portability, schema/migration, or status-helper walkthrough.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Drizzle module, async factory, and repository current()-seam walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch20-drizzle.ko.md:23-29`, `book/intermediate/ch20-drizzle.ko.md:41-94`
  - Docs: `docs/reference/package-surface.md:14-14`, `docs/reference/package-surface.md:55-55`; `docs/reference/package-chooser.md:40-48`; `docs/guides/decision-guide.md:16-24`; `docs/architecture/architecture-overview.md:11-11`, `docs/architecture/architecture-overview.md:27-27`; `docs/architecture/transactions.md:12-12`, `docs/architecture/transactions.md:19-23`, `docs/architecture/transactions.md:30-30`, `docs/architecture/transactions.md:38-40`
  - Rationale: The frozen English docs prove that `@fluojs/drizzle` owns relational access with ALS-backed transaction context, that `DrizzleDatabase.current()` resolves the active transaction handle or root database, and that cleanup can run through an optional `dispose` hook. They do not publish `DrizzleModule.forRootAsync(...)`, the `database`/`dispose` option shape, `ConfigService`-driven pool construction, or the repository example surface strongly enough to support a contradiction or code-error ruling on the chapter's concrete setup walkthrough.
- `Request-scoped transaction, driver-portability, relational-schema, and status-helper claims outrun the frozen Drizzle authority`
  - Book: `book/intermediate/ch20-drizzle.ko.md:27-28`, `book/intermediate/ch20-drizzle.ko.md:96-159`
  - Docs: `docs/reference/package-surface.md:14-14`, `docs/reference/package-surface.md:55-55`; `docs/guides/decision-guide.md:21-21`; `docs/architecture/transactions.md:12-12`, `docs/architecture/transactions.md:19-23`, `docs/architecture/transactions.md:30-40`; `docs/architecture/observability.md:29-29`
  - Rationale: The mapped English docs are explicit on the shared Drizzle transaction contract, including `DrizzleDatabase.transaction(fn, options?)`, `DrizzleTransactionInterceptor`, nested-boundary rules, and the existence of built-in Drizzle observability indicators. They stay too silent on the manuscript's stronger claims about controller-wide request-scoped atomicity examples, Node-Postgres/Bun SQL/Cloudflare D1 portability guidance, schema-and-migration authoring flow, and `createDrizzlePlatformStatusSnapshot(...)`, so these details must remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch21-express-node.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/guides/decision-guide.md`, `docs/reference/glossary-and-mental-model.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/platform-consistency-design.md`, `docs/getting-started/bootstrap-paths.md`, `docs/contracts/platform-conformance-authoring-checklist.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm Express and raw Node.js as first-party runtime adapters with adapter-first portability constraints, but they do not publish the chapter's concrete helper APIs, instance-access surface, or SSE/raw-stream walkthrough strongly enough for contradiction-grade adjudication.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Express and raw Node bootstrap helper walkthrough exceeds the frozen adapter docs`
  - Book: `book/intermediate/ch21-express-node.ko.md:23-31`, `book/intermediate/ch21-express-node.ko.md:35-67`, `book/intermediate/ch21-express-node.ko.md:163-213`
  - Docs: `docs/reference/package-surface.md:21-28`, `docs/reference/package-surface.md:38-40`; `docs/reference/package-chooser.md:7-18`; `docs/guides/decision-guide.md:7-14`; `docs/architecture/architecture-overview.md:7-11`, `docs/architecture/architecture-overview.md:31-40`; `docs/architecture/platform-consistency-design.md:9-25`; `docs/getting-started/bootstrap-paths.md:7-15`, `docs/getting-started/bootstrap-paths.md:26-33`
  - Rationale: The frozen English docs prove only that `@fluojs/platform-express` and `@fluojs/platform-nodejs` are first-party adapter choices, that adapters bind ingress through the runtime seam, and that bootstrap begins from `FluoFactory.create(...)` with an explicit adapter. They do not publish `createExpressAdapter(...)`, `createNodejsAdapter(...)`, `adapter.getInstance()`, `runExpressApplication(...)`, `runNodejsApplication(...)`, option names such as `rawBody` or `maxBodySize`, or the manuscript's detailed `main.ts` walkthrough strongly enough to support a dual-citation contradiction or code-error ruling.
- `Platform-specific response, portability, and shutdown-helper narrative outruns the frozen authority`
  - Book: `book/intermediate/ch21-express-node.ko.md:69-70`, `book/intermediate/ch21-express-node.ko.md:106-148`, `book/intermediate/ch21-express-node.ko.md:194-232`
  - Docs: `docs/reference/glossary-and-mental-model.md:23-27`, `docs/reference/glossary-and-mental-model.md:35-40`; `docs/architecture/platform-consistency-design.md:21-29`, `docs/architecture/platform-consistency-design.md:33-39`; `docs/getting-started/bootstrap-paths.md:35-42`; `docs/contracts/platform-conformance-authoring-checklist.md:27-37`
  - Rationale: The mapped English docs are strong enough to confirm the adapter-first portability model, required `listen(...)` and `close(...)` behavior, and the existence of SSE and transport-resource conformance obligations at the adapter layer. They stay too silent on `SseResponse`, `ctx.response.stream.write()/waitForDrain()/close()`, unrestricted access to native Express/Node instances, binder behavior claims across adapter swaps, and the manuscript's stronger shutdown-helper guarantees, so those detailed runtime semantics must remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch22-bun.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/reference/toolchain-contract-matrix.md`, `docs/guides/decision-guide.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/dev-reload-architecture.md`, `docs/architecture/platform-consistency-design.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm Bun as a first-class application starter and Bun-native fetch-style adapter target, but they do not publish the chapter's concrete Bun adapter APIs, native websocket upgrade behavior, or Bun-specific performance and persistence claims strongly enough for contradiction-grade adjudication.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Bun adapter, native websocket, and manual fetch-handler walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch22-bun.ko.md:21-27`, `book/intermediate/ch22-bun.ko.md:31-43`, `book/intermediate/ch22-bun.ko.md:68-109`
  - Docs: `docs/reference/package-surface.md:21-28`, `docs/reference/package-surface.md:38-40`; `docs/reference/package-chooser.md:20-26`; `docs/reference/fluo-new-support-matrix.md:7-12`, `docs/reference/fluo-new-support-matrix.md:18-26`; `docs/reference/toolchain-contract-matrix.md:13-13`; `docs/guides/decision-guide.md:7-14`; `docs/architecture/platform-consistency-design.md:21-25`, `docs/architecture/platform-consistency-design.md:33-39`
  - Rationale: The frozen English docs prove only that `@fluojs/platform-bun` is a first-class application starter and the official Bun-native fetch-style runtime path within the adapter contract. They do not publish `createBunAdapter(...)`, `createBunFetchHandler(...)`, Bun-specific option names, automatic native websocket upgrade behavior, or the chapter's detailed `Bun.serve(...)` integration surface strongly enough to support a contradiction-grade or code-error ruling.
- `Bun performance, compatibility, and Bun-specific persistence guidance outrun the frozen authority`
  - Book: `book/intermediate/ch22-bun.ko.md:23-27`, `book/intermediate/ch22-bun.ko.md:111-125`, `book/intermediate/ch22-bun.ko.md:137-212`
  - Docs: `docs/reference/package-surface.md:26-26`; `docs/reference/fluo-new-support-matrix.md:9-12`, `docs/reference/fluo-new-support-matrix.md:20-25`; `docs/reference/toolchain-contract-matrix.md:13-13`; `docs/architecture/dev-reload-architecture.md:7-15`; `docs/architecture/architecture-overview.md:7-11`, `docs/architecture/architecture-overview.md:31-40`
  - Rationale: The mapped English docs are sufficient to confirm Bun as an official runtime target, that generated Bun starters use `bun --watch src/main.ts`, and that platform adapters preserve the same core contracts. They stay too silent on claims that Bun is faster than Node, that it eliminates `ts-node`/build complexity as a framework contract, that fluo internally prefers `Bun.file()`, that Bun-native SQLite/driver guidance is part of the published portability story, or that existing tests migrate unchanged to Bun's runner, so those runtime and tooling claims must remain fail-closed as `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch23-deno.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/reference/toolchain-contract-matrix.md`, `docs/guides/decision-guide.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/dev-reload-architecture.md`, `docs/architecture/platform-consistency-design.md`, `docs/architecture/config-and-environments.md`, `docs/contracts/deployment.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm Deno as a first-class `serve()` runtime target with explicit config-boundary rules, but they do not publish the chapter's helper APIs, permission contract, websocket details, or Deno-native persistence/testing guidance strongly enough for contradiction-grade adjudication.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Deno adapter, helper, and manual request-dispatch walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch23-deno.ko.md:30-40`, `book/intermediate/ch23-deno.ko.md:44-104`
  - Docs: `docs/reference/package-surface.md:21-28`, `docs/reference/package-surface.md:38-40`; `docs/reference/package-chooser.md:20-26`; `docs/reference/fluo-new-support-matrix.md:7-12`, `docs/reference/fluo-new-support-matrix.md:18-26`; `docs/reference/toolchain-contract-matrix.md:13-13`; `docs/guides/decision-guide.md:12-14`; `docs/architecture/platform-consistency-design.md:21-25`, `docs/architecture/platform-consistency-design.md:33-39`
  - Rationale: The frozen English docs prove only that `@fluojs/platform-deno` is the official `Deno.serve()` adapter target and that platform adapters must normalize host-native requests into framework contracts. They do not publish `runDenoApplication(...)`, `createDenoAdapter(...)`, `adapter.handle(...)`, native Deno websocket upgrade details, or the manuscript's detailed code surface strongly enough to support a contradiction-grade or code-error decision.
- `Deno permissions, import rules, KV/database, and testing guidance outrun the frozen authority`
  - Book: `book/intermediate/ch23-deno.ko.md:58-64`, `book/intermediate/ch23-deno.ko.md:106-122`, `book/intermediate/ch23-deno.ko.md:139-217`
  - Docs: `docs/reference/package-surface.md:27-27`; `docs/reference/fluo-new-support-matrix.md:9-12`, `docs/reference/fluo-new-support-matrix.md:20-25`; `docs/reference/toolchain-contract-matrix.md:13-13`; `docs/architecture/dev-reload-architecture.md:9-12`; `docs/architecture/config-and-environments.md:5-15`, `docs/architecture/config-and-environments.md:61-69`; `docs/contracts/deployment.md:13-24`
  - Rationale: The mapped English docs are strong enough to confirm Deno as a supported runtime target, that generated Deno starters currently use `deno run --allow-env --allow-net --watch src/main.ts`, and that configuration must flow through explicit bootstrap options rather than ambient package-level environment reads. They stay too silent on the chapter's stronger claims about a stable `runDenoApplication(...)` permission model, required `--allow-read` semantics, extension-suffixed imports as framework guidance, Deno KV integration, Deno-native database drivers, or `Deno.test` support as part of the published fluo contract, so those details must remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch24-cloudflare.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/guides/decision-guide.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/platform-consistency-design.md`, `docs/getting-started/bootstrap-paths.md`, `docs/contracts/platform-conformance-authoring-checklist.md`, `docs/contracts/deployment.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm Cloudflare Workers as a first-class fetch-style isolate adapter with documented worker entrypoint factories and shutdown-drain obligations, but they do not publish the chapter's detailed env/KV/D1/WebSocketPair/waitUntil API walkthrough or edge-operations claims strongly enough for contradiction-grade adjudication.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Cloudflare Worker bootstrap, fetch-entrypoint, and edge websocket walkthrough exceed the frozen docs`
  - Book: `book/intermediate/ch24-cloudflare.ko.md:29-80`, `book/intermediate/ch24-cloudflare.ko.md:108-118`
  - Docs: `docs/reference/package-surface.md:21-28`, `docs/reference/package-surface.md:38-40`; `docs/reference/package-chooser.md:20-26`; `docs/reference/fluo-new-support-matrix.md:7-12`, `docs/reference/fluo-new-support-matrix.md:18-26`; `docs/guides/decision-guide.md:12-14`; `docs/architecture/platform-consistency-design.md:21-25`, `docs/architecture/platform-consistency-design.md:33-39`; `docs/getting-started/bootstrap-paths.md:18-25`, `docs/getting-started/bootstrap-paths.md:26-33`, `docs/getting-started/bootstrap-paths.md:35-42`; `docs/contracts/platform-conformance-authoring-checklist.md:27-37`
  - Rationale: The frozen English docs prove that `@fluojs/platform-cloudflare-workers` is the first-class Workers adapter, that `bootstrap-paths.md` exposes `createCloudflareWorkerAdapter(...)`, `bootstrapCloudflareWorkerApplication(...)`, and `createCloudflareWorkerEntrypoint(...)`, and that fetch-style websocket capabilities plus shutdown-drain behavior are governed at the adapter seam. They do not publish the chapter's concrete `adapter.fetch(req, env, ctx)` usage, lazy bootstrap surface, `WebSocketPair` gateway wiring, `ctx.waitUntil()` behavior, or the broader per-request code examples strongly enough to support a contradiction-grade or code-error ruling.
- `Cloudflare env/KV/D1/Durable Objects, Wrangler, and edge-performance claims outrun the frozen authority`
  - Book: `book/intermediate/ch24-cloudflare.ko.md:82-137`, `book/intermediate/ch24-cloudflare.ko.md:149-212`
  - Docs: `docs/reference/package-surface.md:28-28`; `docs/reference/fluo-new-support-matrix.md:9-12`, `docs/reference/fluo-new-support-matrix.md:20-25`; `docs/architecture/architecture-overview.md:7-11`, `docs/architecture/architecture-overview.md:31-40`; `docs/contracts/deployment.md:13-24`; `docs/contracts/platform-conformance-authoring-checklist.md:40-45`
  - Rationale: The mapped English docs are strong enough to confirm the stateless isolate lifecycle, explicit adapter bootstrap, config-boundary rules, and platform resource-ownership obligations. They stay too silent on claims that Worker `env` is automatically mapped into `ConfigService`, that KV/R2/D1/Durable Objects or `wrangler.toml` are part of the published fluo runtime contract, that `ctx.waitUntil()` is handled automatically, or that sub-millisecond response and specific Cloudflare performance/security features are framework-backed guarantees, so those details must remain fail-closed as `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/intermediate/ch25-final.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/reference/glossary-and-mental-model.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/platform-consistency-design.md`, `docs/architecture/observability.md`, `docs/contracts/behavioral-contract-policy.md`, `docs/contracts/deployment.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`
- Adjudicator outcome: `Accepted no contradiction-grade findings; preserved 2 fail-closed insufficient_ssot findings because the frozen English docs confirm the published runtime-adapter matrix, adapter-first portability model, and built-in health/metrics contracts, but they do not publish the chapter's final FluoShop topology, service-mesh integration, OpenTelemetry storyline, or broader future-architecture guidance strongly enough for contradiction-grade adjudication.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Final multi-runtime FluoShop topology and service-mesh strategy exceed the frozen authority`
  - Book: `book/intermediate/ch25-final.ko.md:21-73`, `book/intermediate/ch25-final.ko.md:118-154`
  - Docs: `docs/reference/package-surface.md:19-28`, `docs/reference/package-surface.md:47-55`; `docs/reference/package-chooser.md:7-26`, `docs/reference/package-chooser.md:60-73`; `docs/reference/fluo-new-support-matrix.md:7-12`, `docs/reference/fluo-new-support-matrix.md:18-28`; `docs/reference/glossary-and-mental-model.md:23-27`, `docs/reference/glossary-and-mental-model.md:35-40`; `docs/architecture/architecture-overview.md:7-11`, `docs/architecture/architecture-overview.md:31-40`
  - Rationale: The frozen English docs prove only the existence of the relevant package families, the official runtime-adapter matrix, and the adapter-first portability model that keeps application logic separate from environment-specific transport behavior. They do not publish the manuscript's concrete final FluoShop service allocation across Workers/Bun/Express, the `MicroservicesModule.forRoot(...)` plus service-mesh sidecar narrative, repository-structure recommendations, or the stronger claims about near-frictionless transport/runtime replacement strongly enough for contradiction-grade adjudication.
- `OpenTelemetry-led operations and future-architecture guidance outrun the frozen docs`
  - Book: `book/intermediate/ch25-final.ko.md:74-117`, `book/intermediate/ch25-final.ko.md:126-217`
  - Docs: `docs/architecture/observability.md:5-16`, `docs/architecture/observability.md:18-29`, `docs/architecture/observability.md:31-51`; `docs/contracts/deployment.md:5-15`, `docs/contracts/deployment.md:26-37`; `docs/contracts/behavioral-contract-policy.md:5-13`, `docs/contracts/behavioral-contract-policy.md:34-40`
  - Rationale: The mapped English docs are explicit on the repository's built-in observability and deployment contracts: Prometheus `/metrics`, runtime `/health` and `/ready`, Terminus aggregation, explicit adapter bootstrap, and config isolation. They stay too silent on OpenTelemetry as a documented built-in surface, on service-mesh-specific tracing/security behavior, on the manuscript's CI/CD and failover checklist, and on the broader forward-looking advice about global data replication, AI integration, and advanced architecture evolution, so those finale claims must remain `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`
