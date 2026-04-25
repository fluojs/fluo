<!-- packages: @fluojs/microservices, @grpc/grpc-js, @grpc/proto-loader -->
<!-- project-state: FluoShop v1.7.0 -->

# Chapter 8. gRPC

This chapter extends the transport choices from Part 1 to gRPC and sets the criteria for introducing schema-first RPC and streaming contracts into FluoShop. Chapter 7 covered physical edge input. Here, we shift the focus to service boundaries that need explicit proto contracts and low-latency streaming.

## Learning Objectives
- Understand why gRPC provides point-to-point contracts that differ from broker-based transports.
- Learn how to configure the gRPC transport with core options such as protoPath, packageName, and services.
- Explain how unary RPC and event-style unary calls connect to the fluo pattern model.
- Analyze how server, client, and bidirectional streaming patterns apply to FluoShop scenarios.
- Define gRPC operational boundaries from the perspectives of timeout, cancellation, and observability.

## Prerequisites
- Completion of Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, and Chapter 7.
- Basic understanding of request-response and streaming contracts.
- Basic concepts for protobuf-based schemas and service boundary design.

## 8.1 Why gRPC in FluoShop

FluoShop uses gRPC at boundaries where strict contracts and streaming semantics matter more than decoupling through a broker. Brokers are strong at asynchronous resilience, while gRPC is strong at point-to-point precision. Representative examples include the following.

- Internal pricing and quote APIs between Gateway and Checkout (Unary)
- Server-streaming order tracking updates (one request, many updates)
- Client-streaming warehouse scan batch uploads (many items, one result)
- Bidirectional courier sessions (independent two-way communication)

These links benefit from protobuf schemas, generated client expectations, and well-defined streaming modes. They don't need to be expressed as queue work items. They fit better as precise RPC contracts where `GrpcMicroserviceTransport` manages the lifecycle of the underlying HTTP/2 channel.

## 8.2 Proto-first transport setup

`GrpcMicroserviceTransport` is the transport with the broadest capability set in the package. It loads `.proto` files at runtime, builds service constructors through `@grpc/proto-loader`, and maps fluo's pattern-based routing to gRPC method definitions.

This transport supports unary calls and all three streaming modes. The fact that the streaming decorators are exported directly from the `@fluojs/microservices` root barrel shows that streaming isn't an add-on, but a first-class capability.

### 8.2.1 Core options

This transport requires several settings to bridge runtime patterns and static schemas.

- `protoPath`: Path to the `.proto` file.
- `packageName`: Proto package name, such as `fluoshop.checkout`.
- `url`: Binding address, such as `0.0.0.0:50051`.
- `services`: Optional list used when you want to limit the registration scope.
- `requestTimeoutMs`: Defaults to 3,000ms.
- `loaderOptions`: Options for `@grpc/proto-loader`.
- `channelOptions`: Options for the `@grpc/grpc-js` channel.
- `kindMetadataKey`: Metadata key used to distinguish messages from events, defaulting to `x-fluo-kind`.

The configuration list is longer than other transports because gRPC is schema-first. High configuration explicitness is the cost of runtime contract safety.

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

This still sits on the same fluo model. The transport implementation details are encapsulated, but the Module and Provider structure stays familiar. The wire protocol changes without shaking the application architecture.

## 8.3 Unary RPC with typed contracts

Unary gRPC calls are the closest counterpart to the earlier request-response transports. The biggest difference is that protobuf explicitly defines the shape of the contract. For both unary and event-style unary calls, the transport expects patterns in the `<Service>.<Method>` format, such as `CheckoutService.GetQuote`.

### 8.3.1 Pricing and checkout quote requests

Assume the Checkout service needs a strongly typed price quote before final confirmation. If the call is synchronous, the schema matters, and clients implemented in several languages may be added later, it is a good fit for a gRPC boundary.

```proto
service CheckoutService {
  rpc GetQuote (QuoteRequest) returns (QuoteReply);
}
```

```typescript
@MessagePattern('CheckoutService.GetQuote')
async getQuote(input: { orderId: string; loyaltyTier: string }) {
  // input is mapped automatically from the proto request object.
  return await this.quoteService.calculate(input);
}
```

The handler stays concise. The contract precision lives in the `.proto` file, and `GrpcMicroserviceTransport` verifies that inbound objects match the expected shape before invoking the handler.

### 8.3.2 Event-style unary with metadata kind

fluo's gRPC support can also emit event-style unary calls. By default, the transport uses `x-fluo-kind` metadata to distinguish `message` (request-response) behavior from `event` (one-way) behavior.

This is useful when an RPC call should behave more like an event notification that only needs remote acknowledgement than a traditional request for data. For example, the Compliance service can send a `TrackingService.RecordCheckpoint` call that only needs confirmation that transmission succeeded, without a business logic response. This pattern keeps strong type safety without forcing every interaction into a request-response shape.

## 8.4 Streaming patterns

Streaming is where gRPC clearly differs from the other transports in this part. The root barrel exports three decorators that represent this capability range.

- `@ServerStreamPattern`
- `@ClientStreamPattern`
- `@BidiStreamPattern`

The fluo repository tests cover all three modes and verify correct handling of stream error propagation, cancellation, and backpressure.

### 8.4.1 Server-streaming order tracking

Server streaming fits when one request needs to open a stream of updates. In FluoShop, the customer support team can subscribe to realtime order checkpoints after an escalation begins.

```typescript
@ServerStreamPattern('TrackingService.StreamOrder')
async streamOrder(
  input: { orderId: string },
  writer: ServerStreamWriter<{ stage: string; occurredAt: string }>,
) {
  // GrpcMicroserviceTransport wraps the gRPC writable stream with ServerStreamWriter.
  for await (const checkpoint of this.trackingService.stream(input.orderId)) {
    writer.write(checkpoint);
  }

  writer.end();
}
```

This model is more natural and lower latency than repeated HTTP polling or imitating a stream on top of a queue.

### 8.4.2 Client-streaming warehouse batch scans

Client streaming is useful when many small messages should produce one summary response. Warehouse handheld devices are a good example. When they upload a batch of collected scan results, the server validates data in realtime as it receives the stream, then returns a final aggregate response when the stream ends. This reduces network overhead while keeping the whole process type-safe.

### 8.4.3 Bidirectional courier sessions

Bidirectional streaming is the most expressive pattern. Both sides can send messages independently over one logical session. FluoShop can use this for a dispatch console for delivery couriers. The courier app sends location pings and delivery status changes, while the backend can simultaneously send rerouting hints or special instructions. gRPC turns this complex interaction into an explicit, type-safe session contract instead of a vague set of broker topics.

## 8.5 Timeouts, cancellation, and observability

The transport supports `requestTimeoutMs` for unary-style requests, defaulting to 3,000ms. If a request exceeds that duration, the transport rejects the promise with an error corresponding to `DEADLINE_EXCEEDED`. These details matter because type-safe contracts don't remove distributed failure. Teams still need to decide the following.

- Which unary calls are latency-sensitive and need short timeouts
- Which streams may stay open for several minutes, and whether they need manual heartbeat logic
- How to map client-side cancellation, meaning HTTP/2 stream close, to backend cleanup logic
- How to observe logger-based event failures, since `GrpcMicroserviceTransport` doesn't use a `console.error` fallback

gRPC increases contract precision, but it doesn't replace operational judgment.

## 8.6 FluoShop v1.7.0 architecture

By the end of Part 1, FluoShop becomes a transport-diverse system where each link has a clear intent.

- **TCP** provides simple, low-overhead direct reads.
- **Redis Streams** protects durable business workflows through PEL/Ack safety.
- **RabbitMQ** owns distributed warehouse queues and complex routing.
- **Kafka** stores replayable history and large-scale event logs.
- **NATS** handles fast control-plane coordination without persistence.
- **MQTT** collects telemetry from edge devices and IoT sensors.
- **gRPC** provides type-safe RPC and streaming contracts for inter-service logic.

This is the core lesson of this part. Transport diversity becomes a manageable choice when the handler structure stays stable. gRPC completes the picture by showing that some boundaries are better expressed as schemas and sessions than anonymous topics or queues.

## 8.7 Summary

- gRPC belongs in the transport toolbox because it provides point-to-point contract safety and native streaming.
- fluo supports unary, server, client, and bidirectional streaming through first-class decorators.
- Protobuf contracts make service-to-service boundaries explicit and easy to share across languages.
- Metadata-based event-style unary calls enable one-way interactions while preserving strong type safety.
- FluoShop now uses gRPC for price quotes, order tracking streams, courier session contracts, and similar boundaries.

Part 1 began with direct transport thinking. It ends with a broader principle. Choose the transport that fits the business boundary, and keep the handler model stable so the system can evolve without being rebuilt from scratch.
