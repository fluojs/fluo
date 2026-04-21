<!-- packages: @fluojs/microservices, @grpc/grpc-js, @grpc/proto-loader -->
<!-- project-state: FluoShop v1.7.0 -->

# 8. gRPC

gRPC is not a message broker.

It still belongs at the end of Part 1 because this part is really about transport choices, not only broker brands. In the `fluo` ecosystem, `GrpcMicroserviceTransport` acts as a first-class peer to the TCP or NATS adapters, using the same pattern-matching logic while introducing schema-driven safety.

By v1.7.0, FluoShop has durable queues, replayable streams, fast control-plane subjects, and edge telemetry topics. What it still needs is a strongly typed RPC boundary for service contracts that benefit from explicit schemas and low-latency streaming.

That is where gRPC enters. In fluo, gRPC sits beside the other microservice transports rather than above them. You still get the same dependency injection model and you still use patterns, but you simply move from broker-oriented framing to proto-defined RPC contracts.

## 8.1 Why gRPC in FluoShop

FluoShop uses gRPC where strict contracts and streaming semantics are more valuable than broker decoupling. While brokers are great for asynchronous elasticity, gRPC excels at point-to-point precision.

Typical examples include:

- internal pricing and quote APIs between Gateway and Checkout (unary)
- server-streamed order tracking updates (one request, many updates)
- client-streamed warehouse scan batches (many items, one result)
- bidirectional courier sessions (independent two-way talk)

These links benefit from protobuf schemas, generated client expectations, and well-defined streaming modes. They do not need to be expressed as queue work items; they need to be expressed as precise RPC contracts where `GrpcMicroserviceTransport` manages the lifecycle of the underlying HTTP/2 channels.

## 8.2 Proto-first transport setup

`GrpcMicroserviceTransport` is the richest transport in the package. It handles the complexity of loading `.proto` files at runtime, generating service constructors via `@grpc/proto-loader`, and mapping fluo's pattern-based routing onto gRPC method definitions.

The transport supports unary calls plus all three streaming modes. Publicly, the streaming decorators are exported directly from the `@fluojs/microservices` root barrel, signaling that they are first-class citizen features rather than edge-case extensions.

### 8.2.1 Core options

The transport requires several configuration values to bridge the gap between runtime patterns and static schemas.

- `protoPath`: Path to the `.proto` file.
- `packageName`: The proto package name (e.g., `fluoshop.checkout`).
- `url`: The binding address (e.g., `0.0.0.0:50051`).
- `services`: Optional list to limit which services are registered.
- `requestTimeoutMs`: Defaults to 3,000ms.
- `loaderOptions`: Options for `@grpc/proto-loader`.
- `channelOptions`: Options for `@grpc/grpc-js` channels.
- `kindMetadataKey`: Defaults to `x-fluo-kind` to distinguish messages from events.

That list is longer than other transports because gRPC is schema-first. The extra explicitness is part of the value—you are trading some setup brevity for runtime contract safety.

### 8.2.2 Module wiring

```typescript
import { Module } from '@fluojs/core';
import { GrpcMicroserviceTransport, MicroservicesModule } from '@fluojs/microservices';

const transport = new GrpcMicroserviceTransport({
  protoPath: new URL('./proto/fluoshop.proto', import.meta.url).pathname,
  packageName: 'fluoshop.checkout',
  url: '0.0.0.0:50051',
  services: ['CheckoutService', 'TrackingService'],
  requestTimeoutMs: 2_500,
});

@Module({
  imports: [MicroservicesModule.forRoot({ transport })],
  providers: [CheckoutRpcHandler, TrackingRpcHandler],
})
export class CheckoutRpcModule {}
```

This still looks like the same fluo story. The transport implementation details are encapsulated, but the module and provider structure stay familiar. You are essentially swapping the "wire protocol" while keeping the "application architecture" intact.

## 8.3 Unary RPC with typed contracts

Unary gRPC calls are the closest equivalent to earlier request-response transports. The core difference is that protobuf defines the contract shape explicitly. The transport expects patterns in `<Service>.<Method>` form (e.g., `CheckoutService.GetQuote`) for unary and event-style unary calls.

### 8.3.1 Pricing and checkout quote requests

Suppose Checkout needs a strongly typed pricing quote before final confirmation. This is a good gRPC boundary because the call is synchronous, the schema matters, and the team may have multiple clients implemented in different languages later.

```proto
service CheckoutService {
  rpc GetQuote (QuoteRequest) returns (QuoteReply);
}
```

```typescript
@MessagePattern('CheckoutService.GetQuote')
async getQuote(input: { orderId: string; loyaltyTier: string }) {
  // input is automatically mapped from the proto request object
  return await this.quoteService.calculate(input);
}
```

The handler remains compact. The contract precision lives in the `.proto` file, and `GrpcMicroserviceTransport` ensures the inbound object matches the expected shape before invoking the handler.

### 8.3.2 Event-style unary with metadata kind

gRPC in fluo can also emit event-style unary calls. The transport uses `x-fluo-kind` metadata by default to distinguish `message` (request-response) versus `event` (one-way) behavior.

This is useful when you want an RPC call that semantically behaves like an event acknowledgment rather than a data request. For example, a Compliance Service might emit a `TrackingService.RecordCheckpoint` event-style call that only needs gRPC-level acknowledgment (delivery success) rather than a business-logic response payload. This keeps the interaction strongly typed without forcing everything into a request-reply mindset.

## 8.4 Streaming patterns

Streaming is where gRPC becomes clearly distinct from the other transports in this part. The root barrel exports three decorators that signal the full surface:

- `@ServerStreamPattern`
- `@ClientStreamPattern`
- `@BidiStreamPattern`

The fluo repository tests spend substantial effort covering all three modes, ensuring that stream error propagation, cancellation, and backpressure are handled correctly.

### 8.4.1 Server-streaming order tracking

Server streaming works well when one request should open a stream of updates. In FluoShop, customer support may subscribe to live order checkpoints after an escalation begins.

```typescript
@ServerStreamPattern('TrackingService.StreamOrder')
async streamOrder(
  input: { orderId: string },
  writer: ServerStreamWriter<{ stage: string; occurredAt: string }>,
) {
  // GrpcMicroserviceTransport wraps the gRPC writable stream in a ServerStreamWriter
  for await (const checkpoint of this.trackingService.stream(input.orderId)) {
    writer.write(checkpoint);
  }

  writer.end();
}
```

This model is more natural than repeatedly polling through HTTP or encoding a pseudo-stream over a queue. It provides a direct, low-latency conduit for updates.

### 8.4.2 Client-streaming warehouse batch scans

Client streaming works well when many small messages should produce one summary reply. Warehouse handheld devices are a good example: they may upload a batch of scan results collected during a pick wave. The server receives the stream, validates the items as they arrive, and returns one aggregate response once the stream ends. This reduces the overhead of individual network round-trips while keeping the entire process typed.

### 8.4.3 Bidirectional courier sessions

Bidirectional streaming is the richest pattern, allowing both sides to send messages independently on one logical session. FluoShop can use this for courier dispatch consoles. The courier app sends location pings and delivery state changes, while the backend can simultaneously respond with reroute hints or escalation instructions. gRPC makes this complex interaction an explicit, typed session contract rather than a loose collection of broker topics.

## 8.5 Timeouts, cancellation, and observability

The transport supports `requestTimeoutMs` (defaulting to 3,000ms) for unary-style requests. If a request exceeds this limit, the transport rejects the promise with a `DEADLINE_EXCEEDED` equivalent error.

These details matter because typed contracts do not remove distributed failure; they only make it easier to define what a healthy call looks like. In FluoShop, teams should still decide:

- which unary calls are latency-sensitive and need short timeouts
- which streams may stay open for minutes and require manual heartbeat logic
- how client cancellation (closing the HTTP/2 stream) should map into backend cleanup
- how logger-driven event failures should be observed (since `GrpcMicroserviceTransport` does not use `console.error` fallbacks)

gRPC improves contract precision, but it does not eliminate the need for operational judgment.

## 8.6 FluoShop v1.7.0 architecture

By the end of Part 1, FluoShop has become a transport-diverse system with clear intent per link.

- **TCP** serves simple, direct, low-overhead reads.
- **Redis Streams** protects durable business workflows with PEL/Ack safety.
- **RabbitMQ** owns distributed warehouse queues and routing.
- **Kafka** stores replayable history and massive event logs.
- **NATS** handles fast control-plane coordination without persistence.
- **MQTT** ingests telemetry from edge devices and IoT sensors.
- **gRPC** provides typed RPC and streaming contracts for inter-service logic.

This is the real lesson of the part: transport diversity is manageable when the handler structure stays stable. gRPC completes the picture because some boundaries are best expressed as schemas and sessions rather than anonymous topics or queues.

## 8.7 Summary

- gRPC belongs in the transport toolbox because it offers point-to-point contract safety and native streaming.
- fluo supports unary plus server, client, and bidirectional streaming through first-class decorators.
- Protobuf contracts make inter-service boundaries explicit and easy to share across different languages.
- Metadata-driven event-style unary calls allow for one-way strongly typed interactions.
- FluoShop now uses gRPC for typed checkout quotes, order tracking streams, and courier sessions.

Part 1 started with direct transport thinking. It ends with a broader principle: choose the transport that matches the business boundary, then keep the handler model stable enough that the system can evolve without a total rewrite.
