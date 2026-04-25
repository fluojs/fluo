# fluo Book Series

[English](./README.md) &nbsp;&middot;&nbsp; [한국어](./README.ko.md)

This three-volume series is the official learning path for learning fluo step by step. Start with the volume that matches your current experience level, then continue naturally from a single HTTP app to distributed systems, framework internals, and extension points.

## Overview

- **Beginner** builds **FluoBlog** while covering fluo's mental model, Standard Decorators, and the path from CLI setup to a working HTTP application.
- **Intermediate** expands that foundation into **FluoShop**, covering distributed architecture, transports, events, realtime systems, notifications, GraphQL, ORM choices, and cross-runtime portability.
- **Advanced** explains fluo's internals, from DI and runtime architecture to adapter design, portability testing, Studio, custom packages, and contribution paths.

## How to Choose a Volume

- If you are new to fluo or need the clearest end-to-end learning path, start with **[fluo for Beginners](./beginner/toc.md)**.
- If you already understand the basics and want to expand into multi-service, event-driven, or realtime system design, start with **[fluo for Intermediate Users](./intermediate/toc.md)**.
- If you need implementation internals, platform boundaries, extension points, or contributor-level understanding, go directly to **[fluo for Advanced Users](./advanced/toc.md)**.

## What Each Volume Covers

### [fluo for Beginners](./beginner/toc.md)

This book teaches the core fluo model while building **FluoBlog**. It covers Modules, Providers, Controllers, TC39 Standard Decorators, routing, DTO validation, serialization, exception handling, Guards, Interceptors, OpenAPI, configuration management, Prisma, transactions, authentication, throttling, caching, health checks, metrics, and testing.

### [fluo for Intermediate Users](./intermediate/toc.md)

This book develops **FluoShop** into a distributed application. It covers microservice architecture, TCP, Redis, RabbitMQ, Kafka, NATS, MQTT, gRPC, domain events, CQRS, sagas, queues, scheduling, distributed locks, WebSockets, Socket.IO, notifications, email, Slack and Discord integrations, GraphQL, Mongoose, Drizzle, and runtime portability across adapters.

### [fluo for Advanced Users](./advanced/toc.md)

This book focuses on framework internals and extension. It covers decorator history and metadata, custom decorators, Provider resolution, Scopes, Circular Dependency handling, Dynamic Modules, Module Graph compilation, application context and adapter contracts, runtime branching, HTTP pipeline internals, custom adapters, portability testing, Studio, custom package authoring, and contributing to fluo.

## Reading Order

The default recommended order is:

1. [fluo for Beginners](./beginner/toc.md)
2. [fluo for Intermediate Users](./intermediate/toc.md)
3. [fluo for Advanced Users](./advanced/toc.md)

You can also use this hub as a chooser. Finish one volume's Table of Contents, then return here to choose the next volume.

## Navigation

- If you are starting the series for the first time, go to the **[Beginner Table of Contents](./beginner/toc.md)**.
- If you want orientation before the full chapter list, you can start with **[Beginner Chapter 0](./beginner/ch00-introduction.md)**, **[Intermediate Chapter 0](./intermediate/ch00-introduction.md)**, or **[Advanced Chapter 0](./advanced/ch00-introduction.md)**.
- If you have finished the Beginner volume, continue with the **[Intermediate Table of Contents](./intermediate/toc.md)**.
- If you need internals or contribution context, move to the **[Advanced Table of Contents](./advanced/toc.md)**.
- If you need broader framework documentation beyond the book path, see the **[Documentation Hub](../docs/CONTEXT.md)**.
