# Konekti

<p align="center">
  <strong>Standard-First TypeScript Backend Framework</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.ko.md">한국어</a>
</p>

Konekti is a modern TypeScript backend framework built from the ground up on **TC39 standard decorators**. It provides a high-performance, explicit, and metadata-free alternative to legacy decorator-based frameworks. 

## Why Konekti?

Most TypeScript frameworks (like NestJS) are stuck in the past, relying on `experimentalDecorators` and `emitDecoratorMetadata` flags that deviate from the JavaScript language path. Konekti moves the industry forward.

- **🚀 Performance Without Magic**: No heavy reflection libraries or hidden metadata emit. Konekti is lean, fast, and stays close to the metal.
- **🛡️ Explicit Over Implicit**: Dependency injection is clear and auditable. You see your dependency graph in your code, not in compiler-generated blobs.
- **🌍 Run Anywhere**: Built on a unified runtime facade. Move from Fastify on Node.js to Bun, Deno, or Cloudflare Workers with zero logic changes.
- **✨ Future-Proof**: Designed for the modern TypeScript era. Use the strongest type-safety features without fighting legacy compiler behaviors.

## The Developer Experience

Imagine a framework that feels like NestJS in its organizational power, but like Go in its explicitness.

```ts
import { Module, Inject } from '@konekti/core';
import { UsersRepository } from './users.repository';

@Inject(UsersRepository)
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}
}

@Module({
  providers: [UsersService, UsersRepository],
})
export class UsersModule {}
```

*No legacy flags required. Just standard TypeScript.*

## Quick Start

The fastest way to experience Konekti is through the official CLI.

```bash
# Get the CLI
pnpm add -g @konekti/cli

# Spin up a project
konekti new my-backend
cd my-backend

# Start the engine
pnpm dev
```

The starter template gives you a production-ready setup with Fastify, built-in health checks, and an organized directory structure designed to scale.

## A Modular Ecosystem

Konekti isn't a monolith. It's a collection of precision-engineered modules:

| Category | Packages |
| :--- | :--- |
| **Runtimes** | [Fastify](./packages/platform-fastify), [Node.js](./packages/platform-nodejs), [Bun](./packages/platform-bun), [Deno](./packages/platform-deno), [Workers](./packages/platform-cloudflare-workers) |
| **Database** | [Prisma](./packages/prisma), [Drizzle](./packages/drizzle), [Mongoose](./packages/mongoose) |
| **API/Comm** | [HTTP](./packages/http), [GraphQL](./packages/graphql), [OpenAPI](./packages/openapi), [WebSockets](./packages/websockets), [Socket.IO](./packages/socket.io) |
| **Logic** | [DI](./packages/di), [CQRS](./packages/cqrs), [Validation](./packages/validation), [Serialization](./packages/serialization), [Config](./packages/config) |
| **Messaging** | [Notifications](./packages/notifications), [Email](./packages/email), [Slack](./packages/slack), [Discord](./packages/discord) |
| **Ops** | [Metrics](./packages/metrics), [Health (Terminus)](./packages/terminus), [Redis](./packages/redis), [Queue](./packages/queue) |

## Where to Go Next?

- 📖 **[Documentation Hub](./docs/README.md)**: Deep dives into architecture, DI, and patterns.
- 🚀 **[Getting Started](./docs/getting-started/quick-start.md)**: Your first 15 minutes with Konekti.
- 🧭 **[Canonical Runtime Package Matrix](./docs/reference/package-surface.md)**: The source of truth for official runtime/package coverage.
- 💡 **[Example Apps](./examples/README.md)**: From minimal setups to complex RealWorld APIs.
- 🛠️ **[CLI Guide](./packages/cli/README.md)**: Master the `konekti` command for rapid development.

## Our Philosophy

We believe in **Behavioral Contracts**. Every package in this repo follows strict reliability rules, ensuring that your backend behaves exactly how you expect it to, regardless of the runtime.

- [Release Governance](./docs/operations/release-governance.md)
- [Behavioral Contract Policy](./docs/operations/behavioral-contract-policy.md)
- [Contributing](./CONTRIBUTING.md)

---
<p align="center">
  Built with ❤️ for the TypeScript Community.
</p>
