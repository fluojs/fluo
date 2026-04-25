<!-- packages: @fluojs/microservices -->
<!-- project-state: FluoShop v1.0.0 -->

# Chapter 1. Microservice Architecture and fluo Strategy

This chapter lays out the FluoShop architecture and fluo's microservices strategy, which form the baseline for the entire intermediate volume. Building on the single-application model from the beginner volume, we now expand the scope to how service boundaries and transport choices affect system quality.

## Learning Objectives
- Understand the core service boundaries and responsibilities that make up FluoShop.
- Learn how fluo provides a transport-independent microservice model.
- See how `@MessagePattern` and `@EventPattern` separate request flows from event flows.
- Confirm how `MicroservicesModule` configures the basic wiring for a distributed application.
- Analyze both the benefits of microservices and the costs of distributed systems.

## Prerequisites
- Completion of the beginner volume, or equivalent hands-on experience with fluo fundamentals.
- Basic understanding of TypeScript, Dependency Injection (DI), and Module structure.
- A basic mental model of the difference between synchronous requests and asynchronous events between services.

## 1.1 The FluoShop Topology

In this book, we build **FluoShop**, an ecommerce project that grows step by step to explain practical microservice patterns. The architecture consists of five core services, each responsible for a specific domain.

1. **API Gateway**: The entry point for all client requests. It handles routing, authentication, and request aggregation.
2. **Catalog Service**: Manages product information, categories, and stock levels, with an emphasis on high read performance.
3. **Order Service**: Acts as the coordination center of the architecture. It handles order creation, state transitions, and cross-service orchestration.
4. **Payment Service**: Manages payment transactions and integrations with external providers. This is a high-risk domain that needs strict failure rules.
5. **Notification Service**: Sends emails and notifications. It represents a downstream consumer that should be separated from the main request path.

This topology is small enough to understand quickly, but complex enough to expose boundaries that matter in real production environments. The gateway handles client-facing protocol concerns, while the order service manages complex business workflows.

### 1.1.1 Architecture Diagram

The system follows a hybrid communication model to balance low latency with high reliability.

- **Requests (Synchronous)**: The API Gateway communicates with the Catalog and Order services through request-response patterns. The Order Service calls the Payment Service for payment authorization.
- **Events (Asynchronous)**: Services publish events to report state changes. For example, when the Payment Service publishes a payment success event, the Notification Service consumes it independently.

```text
Client
  -> API Gateway (request)
      -> Catalog Service (request)
      -> Order Service (request)
          -> Payment Service (request/event)
              -> Notification Service (event)
```

This diagram is a map of domain relationships. Some interactions are direct requests for immediate data, while others are fire-and-forget events for background processing. In later chapters, we will see how these links move into durable broker-based flows when reliability becomes more important than latency.

## 1.2 Unified Programming Model

In fluo, microservice business logic is separated from the underlying network protocol. You don't write transport-specific code inside handlers. Instead, you define message patterns with Decorators and let the transport adapter handle framing, serialization, and delivery mechanics.

This separation matters because transport changes happen often in real projects. Teams often start with direct service-to-service networking, such as TCP or gRPC, then later discover that they need retries, durability, and fan-out, which leads them to introduce a broker such as Kafka or RabbitMQ. If application code is tied to a specific client library, migration becomes close to a rewrite. When the transport is a replaceable adapter, the change stays within configuration and wiring.

### 1.2.1 Pattern-Based Routing

Decorators such as `@MessagePattern` and `@EventPattern` let fluo route incoming packets to the correct handler based on a string or regular expression.

```typescript
import { MessagePattern, EventPattern } from '@fluojs/microservices';

export class OrderHandler {
  @MessagePattern('orders.create')
  async createOrder(data: CreateOrderDto) {
    // fluo handles the underlying socket framing and serialization.
    return { id: 'order-123', status: 'pending' };
  }

  @EventPattern('orders.completed')
  async handleOrderCompleted(data: OrderCompletedEvent) {
    // This is a fire-and-forget event. It does not send a response to the publisher.
  }
}
```

The pattern name is the contract, and the transport is only the delivery mechanism. This keeps routing decisions readable in code, and tests can focus on business logic rather than network procedures.

### 1.2.2 Protocol Independence

This abstraction lets you switch from TCP to Kafka, NATS, or gRPC by changing only the Module's transport configuration. This doesn't mean every transport behaves the same way. TCP is optimized for latency, while Kafka is optimized for durability. It means the *handler interface* remains stable.

fluo's value is that it lets you choose the right transport for each connection while keeping business handlers, DTOs, and the DI structure consistent. You gain the freedom to optimize infrastructure without rebuilding the application.

## 1.3 Strategic Advantages

Using fluo's microservices Module gives you the following strategic advantages. These benefits go beyond API convenience because they help teams design and operate with the same rules as the number of services grows.

- **Developer Velocity**: You can focus on business logic without worrying about socket management or broker-specific APIs.
- **Operational Flexibility**: You can start with simple TCP in development, then upgrade to a durable broker in production without changing handlers.
- **Safety Defaults**: fluo includes defenses for problems common in ad hoc implementations, such as protection against oversized packets, the 1 MiB TCP limit, safe resource cleanup, and delivery confusion prevention.
- **Team Consistency**: Shared conventions reduce coordination costs across teams. When every service uses the same handler style, developers can move across domains smoothly.

## 1.4 Deep Dive into the Microservice Module

`MicroservicesModule` is the core of fluo's distributed capabilities. Registering this Module configures the infrastructure for handling incoming packets and dispatching them to Providers.

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, TcpMicroserviceTransport } from '@fluojs/microservices';

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: new TcpMicroserviceTransport({ port: 4000 })
    })
  ]
})
export class AppModule {}
```

This configuration binds the app to a transport. fluo finds `@MessagePattern` methods on Providers and connects them to the transport listener. There is no hidden "reflection magic." Through explicit Provider composition, microservices sit on the same philosophy as every other part of the fluo ecosystem.

## 1.5 The Philosophy of "No Magic"

Despite its convenience, fluo sticks to a "no magic" philosophy. Every component is an explicit Provider. For example, the `MICROSERVICE` Token is used when injecting a client proxy.

Ambiguity is expensive in distributed systems. If retry behavior or dependency lifecycles are hidden behind framework magic, debugging across processes becomes sharply harder. fluo's explicit configuration narrows where maintainers need to look when pattern resolution stops or client timeouts happen.

## 1.6 Why Microservices with fluo?

Traditional frameworks often expose protocol details to business logic. If you start with REST and later need a broker, you may have to rewrite handlers. fluo reduces this friction by treating transports as replaceable drivers.

Operational tradeoffs such as idempotency, delivery semantics, and observability still need consideration, but an infrastructure change doesn't require redesigning handler signatures. In FluoShop, this keeps the learning path cumulative. Chapter 2 covers TCP, Chapter 3 covers Redis, and each chapter builds on the foundation from the previous one.

## 1.7 Summary

- **Scalability**: Microservices make independent scaling possible, but they require solid communication.
- **FluoShop**: The five-service topology provides a realistic hands-on environment for advanced patterns.
- **Abstraction**: fluo's unified model treats transports as replaceable drivers.
- **Patterns**: Use `@MessagePattern` for requests and `@EventPattern` for events.
- **Progression**: Part 1 turns this abstract architecture into concrete, high-performance transport choices.

We chose boundaries and communication methods first so we could define the service map before optimizing the plumbing. This order is safer in real work too. Which responsibility should be separated has to come before which broker to use, so later transport choices stay grounded.

## 1.8 Next Chapter Preview

In the next chapter, we connect the first two FluoShop services with the TCP transport. We will see how fluo frames data over raw sockets, how callers correlate responses, and which safety boundaries are needed before introducing a real broker. Once this foundation is clear, the move to Redis or Kafka becomes an intentional strategy choice rather than a vague dependency addition.
