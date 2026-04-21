<!-- packages: @fluojs/microservices -->
<!-- project-state: FluoShop v1.0.0 -->

# 1. Microservice Architecture and fluo Strategy

Microservices break down large, complex applications into small, independent services that communicate over a network. While the benefits of scalability and independent deployment are well-known, the cost of managing the resulting network complexity is often underestimated.

fluo provides a unified programming model that lets you write business logic once and deploy it across various transport protocols. This chapter introduces the core philosophy of fluo's microservice strategy and establishes the **FluoShop** project—an evolving e-commerce backend that we will build throughout this book.

The goal of this opening chapter is not to romanticize microservices. It is to define where they help, where they hurt, and how fluo reduces the "distributed systems tax" when moving from a modular monolith to a network of services. By the end of this chapter, you will understand the FluoShop topology and why transport independence is a strategic requirement for long-term evolution.

## 1.1 The FluoShop Topology

Throughout this book, we will build **FluoShop**, a cumulative e-commerce project designed to demonstrate real-world microservice patterns. Our architecture consists of five core services, each responsible for a specific domain.

1. **API Gateway**: The entry point for all client requests. It performs routing, authentication, and request aggregation.
2. **Catalog Service**: Manages product information, categories, and inventory levels. It emphasizes high-read performance.
3. **Order Service**: The orchestration center. It handles order placement, state transitions, and service coordination.
4. **Payment Service**: Manages transactions and external provider integrations. This is a high-risk domain with strict failure rules.
5. **Notification Service**: Sends emails and alerts. It represents a downstream consumer that should remain decoupled from the main request path.

This topology is intentionally small enough to understand quickly but rich enough to expose the boundaries that matter in production. The gateway owns client-facing protocol concerns, while the order service manages the complex dance of business workflows.

### 1.1.1 Architecture Diagram

The system follows a hybrid communication model to balance low latency and high reliability.

- **Requests (Synchronous)**: The API Gateway communicates with the Catalog and Order services using request-response patterns. The Order Service calls the Payment Service to authorize transactions.
- **Events (Asynchronous)**: Services emit events to notify others of state changes. For example, the Payment Service emits a success event that the Notification Service consumes independently.

```text
Client
  -> API Gateway (Request)
      -> Catalog Service (Request)
      -> Order Service (Request)
          -> Payment Service (Request/Event)
              -> Notification Service (Event)
```

This is a map of domain relationships. Some interactions are direct requests for immediate data, while others are fire-and-forget events for background processing. Later, we will see how these links evolve into durable broker-backed flows when reliability outweighs raw latency.

## 1.2 Unified Programming Model

In fluo, the business logic of a microservice is decoupled from the underlying network protocol. You do not write transport-specific code inside your handlers. Instead, you use decorators to define message patterns and let the transport adapter handle framing, serialization, and delivery.

That separation matters because transport churn is common. Teams often start with direct service-to-service networking (TCP/gRPC) and later discover they need the retries, durability, or fan-out behavior of a broker (Kafka/RabbitMQ). If your application code is tied to a specific client library, migration is a rewrite. If the transport is a swappable adapter, migration is a configuration change.

### 1.2.1 Pattern-Based Routing

Decorators like `@MessagePattern` and `@EventPattern` allow fluo to route incoming packets to the correct handler based on a string or regular expression.

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
    // Fire-and-forget event. No response is sent to the emitter.
  }
}
```

The pattern name is the contract; the transport is merely the delivery vehicle. This keeps your routing decisions readable and allows your tests to focus on business logic rather than network choreography.

### 1.2.2 Protocol Independence

This abstraction allows you to switch from TCP to Kafka, NATS, or gRPC by changing the transport configuration in your module. This doesn't mean all transports behave identically—TCP is optimized for latency, while Kafka is optimized for durability—but it means the *handler interface* stays stable.

fluo's value lies in keeping your handlers, DTOs, and dependency injection structure consistent while you choose the appropriate transport per link. You gain the freedom to optimize your infrastructure without rebuilding your application.

## 1.3 Strategic Advantages

By using fluo's microservice module, you gain several strategic benefits:

- **Developer Velocity**: Focus on business logic without worrying about socket management or broker-specific APIs.
- **Operational Flexibility**: Start with simple TCP for development and upgrade to durable brokers in production without rewriting handlers.
- **Safety Defaults**: fluo includes protection against oversized packets (1MiB TCP limits), unsafe cleanup, and delivery confusion that plague ad-hoc implementations.
- **Team Consistency**: Shared conventions reduce coordination costs. When every service uses the same handler style, developers can move between domains seamlessly.

## 1.4 Deep Dive into the Microservice Module

The `MicroservicesModule` is the heart of fluo's distributed capabilities. When registered, it sets up the infrastructure to handle incoming packets and dispatch them to your providers.

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

This configuration binds the app to a transport. fluo then scans your providers for `@MessagePattern` methods and wires them to the transport listener. There is no hidden "reflection magic" here; it is an explicit composition of providers into a runtime graph, keeping your microservices aligned with the rest of the fluo ecosystem.

## 1.5 The Philosophy of "No Magic"

Despite the convenience, fluo adheres to a "no magic" philosophy. Every component is an explicit provider. For instance, the `MICROSERVICE` token is used to inject the client proxy.

In distributed systems, ambiguity is expensive. If retry behavior or dependency lifecycles are hidden behind framework magic, debugging across processes becomes a nightmare. fluo's explicit configuration ensures maintainers know exactly where to look when a pattern stops resolving or a client begins timing out.

## 1.6 Why Microservices with fluo?

Traditional frameworks often leak protocol details into business logic. If you start with a REST-based approach and later need a message broker, you often end up rewriting handlers. fluo treats the transport as a swappable driver, reducing this friction significantly.

You still need to consider operational trade-offs—idempotency, delivery semantics, and observability—but you aren't forced to redesign your handler signatures just because the infrastructure changed. In FluoShop, this makes the learning path cumulative: Chapter 2 handles TCP, Chapter 3 handles Redis, and so on, with each chapter building on the last.

## 1.7 Summary

- **Scalability**: Microservices enable independent scaling but demand robust communication.
- **FluoShop**: Our five-service topology provides a realistic playground for advanced patterns.
- **Abstraction**: fluo's unified model treats transports as swappable drivers.
- **Patterns**: Use `@MessagePattern` for requests and `@EventPattern` for events.
- **Progression**: Part 1 turns this abstract architecture into concrete, high-performance transport choices.

We have chosen our boundaries and communication styles to evaluate infrastructure optimizations in later chapters. This is the correct order: define the service map first, then optimize the plumbing.

## 1.8 Next Chapter Preview

In the next chapter, we will build the first two services of FluoShop using the TCP transport. We will answer the practical questions: How does fluo frame data over raw sockets? How does a caller correlate responses? What safety boundaries exist before a real broker is introduced? Once the foundations are clear, upgrading to Redis or Kafka becomes an intentional strategic choice rather than a mysterious dependency.
