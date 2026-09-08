# Volume 2 - FluoShop: A Successful Blog Opens a Store

[Series introduction](../README.md) | [Full contents](./toc.md)

Readers of the FluoBlog newsletter ask to buy logo T-shirts and stickers. The operator opens a small store using the same accounts and website. Adding a product page is straightforward, but money and inventory change what success means. Pressing the buy button twice must still create one order, and losing a payment response must not charge the customer again.

## Carrying forward the application from volume 1

This volume does not begin another login example from scratch. We preserve accounts, content, user IDs, authentication, configuration, and observability while adding catalog, inventory, cart, orders, payments, and fulfillment. An existing reader becomes a customer through the same account. Regression tests also check that new schemas and deployments do not break existing post retrieval.

We start with a modular monolith. We use transactions that one database can guarantee before extracting fulfillment when independent deployment and failure isolation become necessary. Microservices are a choice whose costs must be explained, not a qualification for being an intermediate developer.

## Failure is the center of this volume

A price sent by the cart is not payment authority. We recalculate prices on the server and save an order-time snapshot. When requests compete for the last unit, we use atomic database updates and constraints. A Redis lock alone does not make every store and payment provider consistent.

Payment providers, email services, and brokers live outside the application's transaction. A timeout does not prove that an operation was never executed. Webhooks may be duplicated or reordered. We design idempotency, state transitions, reconciliation, Outbox and Inbox, and compensating work under those conditions.

We also separate the actual guarantees when introducing CQRS and Saga. Fluo's dispatch and lifecycle support is distinct from progress the application must persist. A memory event handler cannot own recovery after the process dies.

## The main path and comparison labs

The main relational store is PostgreSQL with Prisma. Background work starts with a Redis-backed queue, and we introduce messaging contracts when service extraction becomes necessary. Chapter 24 compares transports, chapter 25 compares Drizzle, and chapter 26 compares Mongoose against the same requirements and tests. They are not instructions to install every broker and ORM into the running application.

Real payments and email, Slack, or Discord deliveries are external effects. The examples distinguish test environments, contract doubles, and operational connections. A passing double is not presented as verification of a real payment or fulfillment provider.

## Completion criteria

We do not finish with product retrieval and a successful purchase alone. We reproduce duplicate webhooks, queue redelivery, lost payment responses, stopped workers, expired reservations, and failed refunds, and explain how the state converges. We also record which metrics and evidence an operator needs to intervene.

By the end, we are ready to trace the same order request into the framework. Volume 3 examines how the modules and requests used in the first two volumes are compiled and resolved, and how their boundaries can be extended.

Previous volume: [FluoBlog's first release](../01-fluoblog/ch24-first-release.md). Start with [chapter 1: Adding a store to the existing blog](./ch01-grow-the-blog.md).
