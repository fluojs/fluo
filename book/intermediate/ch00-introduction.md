<!-- packages: @fluojs/microservices, @fluojs/cqrs, @fluojs/websockets, @fluojs/notifications -->

<!-- project-state: FluoShop v0.0 -->

# Introduction: Scaling Beyond the Monolith

The intermediate volume of the fluo series begins at the boundary where a single application starts becoming a distributed system.

The beginner volume focused on building a solid single-instance application. Using the Standard-First Decorator model, Dependency Injection (DI), and the basic HTTP layer, we clarified service boundaries and built the first version of FluoShop as a modular monolith while preserving strict type safety.

The intermediate volume moves beyond web server basics and focuses on the cost and responsibility of system design. Data Locality, network partitions, and Service Discovery are no longer side topics. In a monolith, a single database and local transactions provide much of the consistency story. In a distributed system, local function calls must be treated as network messages, and Eventual Consistency must become an explicit design condition.

## The Intermediate Journey

This book shows, in concrete terms, how to use fluo to move from a modular monolith to a scalable, resilient microservices architecture. It does not stop at theory. Step by step, we refactor FluoShop into a distributed system that spans multiple services, protocols, and runtimes.

We focus on four main themes.

1. **Microservices infrastructure**: Understand transport protocols, message patterns, and how fluo abstracts network complexity (TCP, Redis, Kafka, NATS, gRPC).

2. **Event-driven architecture**: Move away from direct request flows toward decoupled event flows built with CQRS and message brokers.

3. **Realtime communication**: Extend beyond the request-response model with WebSocket gateways and specialized notification systems.

4. **Platform portability**: Use fluo's unified Facade to run logic on Node.js, Bun, Deno, and edge environments such as Cloudflare Workers.

## The Evolution of FluoShop

In this book, FluoShop grows from a simple shop application into a distributed system. The system is split into services by responsibility.

- **API Gateway**: The entry point that handles data aggregation and cross-cutting concerns.
- **Catalog Service**: Manages products and inventory on high-performance read paths.
- **Order Service**: Coordinates complex business workflows and state transitions.
- **Payment Service**: Owns a high-risk domain that requires strict failure handling and external integrations.
- **Notification Service**: Consumes and sends notifications across channels such as Email, Slack, and Discord.

Using this topology, we compare several transport protocols, from simple TCP to brokers such as Kafka and NATS. The key idea is a unified programming model. Even when the infrastructure changes, the intent and structure of the business handlers should remain recognizable.

## Philosophy: Explicit Over Implicit

Throughout this book, we keep fluo's core philosophy in view: **Explicit Over Implicit**.

Distributed systems are complex by nature. When you trace failures across multiple services and message brokers, hidden reflection, automatic discovery, and opaque metadata hide the real flow of data and dependencies. Maintainers need observable boundaries more than convenience features.

In fluo, everything is an explicit Provider. The dependency graph is auditable, and transport settings can be inspected directly in code. Choosing explicitness adds some boilerplate, but it greatly improves predictability and maintainability. This book also covers the Outbox pattern for publishing events safely and idempotency keys for absorbing duplicate messages caused by network retries.

## How to Navigate This Book

This book is organized in the order you typically encounter concerns when introducing distributed systems. Each part adds the next operational problem on top of the previous decision, so readers can follow why FluoShop adopts a new transport or pattern at that point in the journey.

- **Part 0. Preparing for microservices**: Define the strategy and learn TCP as the first transport.
- **Part 1. Message brokers**: Integrate Redis, RabbitMQ, Kafka, NATS, and gRPC, then evaluate the tradeoffs of each one.
- **Part 2. Event-driven architecture**: Implement an event bus, CQRS, the Saga pattern, and distributed locks.
- **Part 3. Realtime communication**: Scale WebSocket gateways and Socket.IO in a multi-service environment.
- **Part 4. Notification system**: Orchestrate notifications across email, Slack, and Discord.
- **Part 5. API expansion**: Explore GraphQL and modern ORMs such as Drizzle and Mongoose.
- **Part 6. Platform portability**: Deploy the same business logic to Bun, Deno, and Cloudflare Workers.

## Setting Expectations

Microservices are not a cure-all. They introduce new costs, including network latency, partial failure, data consistency, and operational overhead. This book does not hide those costs. It also explains when you should *not* use microservices, the trap of the Distributed Monolith, and the fact that architecture is a series of intentional tradeoffs.

## Community and Support

Questions, design discussions, and feedback can continue in [GitHub Discussions](https://github.com/fluojs/fluo/discussions) and the Discord community. Problems and suggestions from real users make fluo's direction more accurate.

fluo was designed to make this transition explicit. Chapter 1 starts by clarifying the criteria for splitting a monolith.

---

## Glossary

- **Transport**: The underlying protocol used for communication, such as TCP or Kafka.
- **Message Pattern**: A unique identifier for request-response interactions.
- **Event Pattern**: A unique identifier for fire-and-forget broadcasts.
- **Client Proxy**: A fluo component used to send messages or events to a remote service.
- **Facade**: An abstraction layer that hides the complexity of different runtimes, such as Node, Bun, and Edge.

These terms form the shared language for describing the fluo microservices ecosystem. Now we will start with architectural boundaries.

FluoShop will evolve naturally from a single application into a distributed system. We will keep the strengths of the modular monolith while drawing clearer service boundaries. The intermediate volume does not force microservices from the start. It first explains why separation becomes necessary. Each chapter connects architectural decisions to real changes in FluoShop. Service decomposition starts with responsibility boundaries, not with moving code. Catalog, order, payment, and notification are domains with different failure models. We will learn not to mistake network calls for function calls.

Data Locality and service ownership are central to distributed system design. Eventual Consistency is closer to a design choice than a surrender. FluoShop's evolution is a journey from v0.0 toward larger operational realities. The API Gateway is the entry point, but it does not own every business rule. The Catalog Service will show a model suited to read-heavy workloads. The Order Service will own most long-running flows and state transitions. The Payment Service exposes the tension between external system integration and failure recovery. The Notification Service shows the value of a reactive consumer model.

TCP is the simplest starting point, and it reveals the core nature of service-to-service messaging. Redis lets us compare fast event delivery with stream-based durability. RabbitMQ makes queue topology and routing strategy explicit. Kafka introduces operational concepts such as replay, partitioning, and consumer groups. NATS shows where low latency and a simple operational model matter most. MQTT lets us cover telemetry and device-friendly messaging scenarios. gRPC gives us a good opportunity to examine explicit contracts and streaming models. We will compare how the same business flow looks on top of different transports.

One of fluo's important promises is that application intent remains intact even when the transport changes. Explicit configuration reduces debugging time in distributed environments. Visible Provider configuration is more trustworthy than hidden metadata. Service Discovery is not just a convenience feature. It is part of system reliability. Network partitions are not edge cases. They are realities every distributed system eventually meets. We will build the habit of thinking about retries, timeouts, and idempotency together.

The Outbox pattern connects event publishing and state changes more safely. Domain events are not simple notifications. They are records of business facts. The power of domain events becomes clear when a single order creation opens several follow-up flows. Event-driven design lowers coupling, but it raises observability requirements. CQRS helps us avoid forcing read models and write models to look the same. Separating commands from queries makes service responsibilities clearer. Read models can evolve around user screens and search experiences.

Write models center integrity and business rules. Saga helps us understand long flows that span multiple services as one coherent process. Compensating actions are a practical alternative to distributed transactions. In long-running order processing, Saga treats failure as part of the design. An event bus is not just a propagation tool. It carries meaning across boundaries. Background jobs and queues play a major role in protecting user response time. Scheduling and distributed locks introduce the safety mechanisms behind operational automation.

When we move into realtime systems, it becomes clear that request-response alone is not enough. WebSocket gateways deliver cart changes, order status, and operational alerts more immediately. Socket.IO lets us explore richer interactions and room-based scenarios. Realtime connections also require us to design connection lifecycles and heartbeats. The FluoShop support channel shows how realtime messaging changes the service experience. A notification system gathers channels such as email, Slack, and Discord into one flow. User notifications and operational notifications may look similar, but they have different priorities and failure costs. Email reveals the importance of asynchronous processing, templates, and status tracking.

Slack integration helps operations teams understand events immediately. Discord integration connects community and support flows more closely. Notification orchestration gathers channel-specific implementations under a shared intent. GraphQL helps design a more flexible aggregated read experience. It is important to treat REST and GraphQL as situational tools rather than competitors. Mongoose will show cases where document-oriented modeling fits well. Drizzle lets us examine SQL-centered thinking together with type safety. Choosing an ORM is less about preference and more about data access patterns and team operations.

Even within the same FluoShop system, read strategies can change depending on the storage technology. Runtime portability makes it possible to design without binding everything to one server. You will experience the differences between Node.js, Bun, Deno, and Cloudflare Workers directly. Knowing the differences between Platform Adapters does not mean rewriting business logic. The unified Facade turns runtime differences into manageable boundaries instead of hiding them completely. The intermediate volume is not only about adding features. It is also about building operational judgment. We will treat logs, metrics, and failure paths as part of the architecture story.

In distributed systems, documentation that describes only the happy path is the most dangerous kind. This book aims to show success paths and failure paths together. You will see how the reason for splitting services also connects to team structure and deployment strategy. Because we start from a small monolith, the later decomposition process will feel more convincing. Distributed architecture is not only a choice for scale. It can also separate team responsibilities. Still, we will speak honestly about when a monolith should remain a monolith. Learning the trap of the Distributed Monolith helps us avoid premature separation.

Every service boundary has benefits and costs at the same time. The Standard-First philosophy remains a central principle in distributed environments. Explicit DI becomes more valuable as the number of services grows. An auditable dependency graph also helps analyze operational incidents. The goal of the intermediate volume is to make more complex systems feel approachable. Complexity is not something to hide. It is something to split into understandable pieces. Before each chapter introduces new infrastructure, we will make the reason clear.

Technology choices should follow problem fit rather than trends. Using Kafka does not automatically make a system more mature. There are clear moments when NATS or Redis is the better fit. A simple starting point such as TCP helps reveal the real costs underneath abstractions. gRPC's contract-centered approach can also help collaboration across teams. MQTT makes us think beyond web backends and into the world of connected devices. Realtime updates improve user satisfaction, but they also bring operational complexity. As notification channels increase, shared orchestration becomes more important than duplicated logic.

CQRS and event models make search, analytics, and dashboard experiences more flexible. Understanding Saga helps us design payment failure and inventory recovery flows more calmly. Well-defined domain events make conversations between teams more precise. A GraphQL layer is useful for gathering data from several services and refining the read experience. Comparing Mongoose and Drizzle also reveals differences in data modeling philosophy. Runtime portability is insurance against future changes in deployment strategy. Running the same core logic on multiple adapters builds confidence. By the end of the intermediate volume, you will be comfortable with the language of distributed applications.

You will read transports, events, queues, and realtime connections as parts of one system. You will be able to explain why FluoShop's next change is necessary. It is fine if difficult concepts do not become clear all at once. What matters is widening your systems thinking a little in each chapter. When questions come up, there is a community, code to experiment with, and examples to reread. You already built the foundation in the beginner volume. Now you are entering a wider design space. Distributed systems are hard, but they can be learned, and fluo is designed to support that learning.

Now it is time to move to the next step with FluoShop.
