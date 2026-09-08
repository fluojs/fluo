# Volume 3 - Inside Fluo: The Engine Room of Our Services

[Series introduction](../README.md) | [Full contents](./toc.md)

We already have code that handles posts and orders. Now we want to know when PostsService is created, which instances are shared inside a request, and what is cleaned up when initialization fails. This volume explains the execution of the services built in the first two volumes through real Fluo source and tests.

## Starting with questions, not a list of implementations

Whenever we move from a public API to an internal function, we ask why the boundary exists. We do not read files in alphabetical order. Starting with one order request, we connect decorator metadata, provider normalization, dependency resolution, the module graph, bootstrap, and the request pipeline.

Line numbers change over time. We connect explanations to stable files, symbols, and behavioral contracts, then check them with small executable experiments and regression tests. Reading source and verifying behavior on a particular runtime are different kinds of evidence.

## What you need before reading

You should understand TypeScript, Promises, the basic HTTP request flow, and Fluo module/DI usage. You do not have to run every broker or complete every comparison lab in volume 2. A reproducible post or order module is enough as input.

Analyze public exports, implementation, and tests from the same repository checkout. Before changing a documented usage example, consult the package README and docs/contracts. The existence of a symbol on an internal path does not mean external applications may import it.

## Keeping runtime differences visible

Fastify, raw Node, and Express on Node.js are not one implementation with identical server ownership. Bun, Deno, and Cloudflare Workers use Fetch requests but have different startup, shutdown, and environmental-resource boundaries. Inside Next.js, the host owns the server and bundles; do not assume that Fluo should open a separate listener.

Find shared contracts without generalizing that every platform offers every feature. When building an adapter, declare its intended support and verify it with conformance and portability tests. State unsupported boundaries instead of hiding them behind silent fallbacks.

## What this volume produces

We begin by reading source and explaining behavior. We then design the boundaries of custom decorators, provider configurations, adapters, and extension packages. Finally, we follow a real framework change through a failing test, implementation, documentation, and migration guidance.

We approach performance through measurement rather than claims. We distinguish a microbenchmark result from application request throughput and examine the lifetime and invalidation conditions of caches. Studio and inspection output provide diagnostic evidence for these decisions; they do not automatically prove the complete state of the running system.

Previous volume: [FluoShop failure drills](../02-fluoshop/ch28-failure-drills.md). Start with [chapter 1: Tracing one order request through the source](./ch01-trace-an-order.md).
