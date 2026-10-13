<div align="center">
  <img src="./src/fluo.png" alt="fluo framework logo" width="140" />

  <h1>fluo</h1>

  <p>
    <b>Standard-First TypeScript Backend Framework</b>
  </p>

  <p>
    <a href="./README.md">English</a>
    &nbsp;&middot;&nbsp;
    <a href="./README.ko.md">한국어</a>
  </p>

  <p>
    <a href="https://github.com/fluojs/fluo/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/fluojs/fluo?style=social" /></a>
    <a href="https://github.com/fluojs/fluo/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/fluojs/fluo" /></a>
    <a href="https://github.com/fluojs/fluo/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/fluojs/fluo/ci.yml?branch=main&label=ci" /></a>
    <a href="https://github.com/fluojs/fluo/issues"><img alt="Issues" src="https://img.shields.io/github/issues/fluojs/fluo" /></a>
  </p>
</div>

<br/>

**fluo** is a TypeScript backend framework built on TC39 standard decorators and explicit dependency injection. Build API servers with controllers, services, and modules, or connect React pages to the same HTTP pipeline for a full-stack application. Add database, authentication, and messaging packages as needed.

[Quick Start](#quick-start) · [Choose Your Application](#choose-your-application) · [Book](./book/README.md) · [Documentation](./docs/README.md) · [Examples](./examples/README.md)

## Quick Start

**Prerequisites:** Install Node.js 24.x and pnpm 10. The CLI and Babel 8 compiler toolchain require Node.js `>=24.11.0 <27`; Node.js runtime packages support `>=24.0.0 <27`. The CLI itself runs on Node.js even when generating a project for another runtime.

Start with the CLI published on npm; no repository clone is needed.

```bash
pnpm --allow-build=esbuild dlx @fluojs/cli new my-backend --package-manager pnpm
cd my-backend
pnpm dev
```

`--allow-build=esbuild` is a pnpm option that approves the CLI dependency's install script. If prompted, keep the default `standard` / HTTP application / Node.js / Fastify choices and install dependencies. A global CLI installation is not required.

Once the server starts, send a request from another terminal. The default port is `3000`; change it through `PORT` in the generated `.env` file.

```bash
curl http://localhost:3000/greeting
```

```json
{"message":"Hello from fluo","framework":"fluo","project":"my-backend"}
```

`GET /health` also returns `200` and `{"status":"ok"}`. To change your first response, edit the message in `src/greeting/greeting.repo.ts`, then send the same `curl` request again to confirm the new response. Follow request handling and dependency wiring in `greeting.controller.ts`, `greeting.service.ts`, and `greeting.module.ts` in the same directory.

Run the tests and build from the generated project directory:

```bash
pnpm test
pnpm build
```

The starter includes a Fastify app, `/greeting`, `/health`, `/ready`, tests, and build configuration. Add authentication, persistent storage, and deployment configuration in your application. See the [CLI guide](./packages/cli/README.md) for other starters and runner options, and the [toolchain contract](./docs/reference/toolchain-contract-matrix.md) for supported transforms.

## The Developer Experience

The app from the quick start handles requests through a controller, service, and repository. `@Module(...)` registers the components and `@Inject(...)` makes dependencies explicit. Startup follows `FluoFactory.create(AppModule, { adapter })` → `app.listen()`.

The following explanatory example condenses that structure into one file. It is not a step to replace your generated app; continue editing your first response in `src/greeting/greeting.repo.ts` above.

```ts
import { FluoFactory } from '@fluojs/runtime';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { Inject, Module } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';

class GreetingService {
  greet() {
    return { message: 'Hello from fluo' };
  }
}

@Inject(GreetingService)
@Controller('/greeting')
class GreetingController {
  constructor(private readonly service: GreetingService) { }

  @Get('/')
  getGreeting() {
    return this.service.greet();
  }
}

@Module({
  controllers: [GreetingController],
  providers: [GreetingService],
})
class AppModule { }

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({
    port: 3000,
  }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
```

The generated app separates these roles into files and includes a repository, health checks, tests, and build configuration. Check it against the generated response shown in the quick start, rather than this example's abbreviated response.

## Choose Your Application

| What you want to build | Start here |
| --- | --- |
| HTTP API server | Extend the Node.js + Fastify app from the quick start above. |
| React full-stack app | Use the official `react-vite-ssr` starter in [React first page](./packages/react/README.md#zero-to-first-page-workflow). Compose SSR, hydration, navigation, and forms on the same HTTP routes and DI. |
| Another host or a message-based service | Choose a supported starter in the [CLI guide](./packages/cli/README.md), then check the packages you need in the [runtime support matrix](./docs/reference/package-surface.md). |

## Why fluo?

- **Standard decorators**: No dependency on `experimentalDecorators`, `emitDecoratorMetadata`, or `reflect-metadata`. fluo uses framework-owned metadata stores and standard decorator metadata integration.
- **Explicit dependencies**: Declare constructor tokens with class-level `@Inject(...)` and register providers and controllers with `@Module(...)`.
- **Testable features**: Compose HTTP routing, request validation, and response serialization, then verify DI wiring and request handling with the testing tools.
- **A choice of hosts**: Connect runtime-specific adapters to a shared module and DI model. Host lifecycle and package coverage follow each adapter's contract.
- **Scaffolding through diagnostics**: Use the CLI to generate projects and features and manage development, builds, and startup. `fluo inspect` and Studio provide paths to application structure and diagnostics.

## A Modular Ecosystem

Connect the capabilities you need. These are representative packages; the [package chooser](./docs/reference/package-chooser.md) provides the full catalog and selection guidance.

| Category | Packages |
| :--- | :--- |
| **Foundations** | [Core](./packages/core/README.md), [DI](./packages/di/README.md), [Runtime](./packages/runtime/README.md), [Config](./packages/config/README.md), [I18n](./packages/i18n/README.md) |
| **HTTP/API** | [HTTP](./packages/http/README.md), [Validation](./packages/validation/README.md), [Serialization](./packages/serialization/README.md), [OpenAPI](./packages/openapi/README.md), [GraphQL](./packages/graphql/README.md) |
| **Host adapters** | [Fastify](./packages/platform-fastify/README.md), [Express](./packages/platform-express/README.md), [Node.js](./packages/platform-nodejs/README.md), [Next.js](./packages/platform-nextjs/README.md), [Bun](./packages/platform-bun/README.md), [Workers](./packages/platform-cloudflare-workers/README.md) |
| **Authentication** | [JWT](./packages/jwt/README.md), [Passport](./packages/passport/README.md) |
| **Data and caching** | [Prisma](./packages/prisma/README.md), [Drizzle](./packages/drizzle/README.md), [Mongoose](./packages/mongoose/README.md), [Redis](./packages/redis/README.md), [Cache Manager](./packages/cache-manager/README.md) |
| **Messaging and jobs** | [Microservices](./packages/microservices/README.md), [CQRS](./packages/cqrs/README.md), [Event Bus](./packages/event-bus/README.md), [Queue](./packages/queue/README.md), [Cron](./packages/cron/README.md) |
| **Realtime and notifications** | [WebSockets](./packages/websockets/README.md), [Socket.IO](./packages/socket.io/README.md), [Notifications](./packages/notifications/README.md), [Email](./packages/email/README.md), [Slack](./packages/slack/README.md), [Discord](./packages/discord/README.md) |
| **Operations** | [Health (Terminus)](./packages/terminus/README.md), [Metrics](./packages/metrics/README.md), [Throttler](./packages/throttler/README.md) |
| **React and developer tools** | [React](./packages/react/README.md), [CLI](./packages/cli/README.md), [Testing](./packages/testing/README.md), [Vite](./packages/vite/README.md), [Studio](./packages/studio/README.md) |

**Runtime support is package-specific.** Having an adapter does not make every package portable to that host. Check host support and driver limitations in the [Canonical Runtime Package Matrix](./docs/reference/package-surface.md), and installation, startup, and shutdown requirements in the owning package README.

## Where to Go Next?

| Your goal | Start here |
| --- | --- |
| Learn backend design by building a product | [Three-volume Book](./book/README.md): FluoBlog → FluoShop → Fluo internals. Start with the [volume 1 contents](./book/01-fluoblog/toc.md). |
| Try a short first HTTP feature | [FluoBlog exercise](./apps/docs/content/docs/tutorial/index.mdx): Learn routes, DI, request validation, and tests through repository checkpoints. |
| Add a capability to an existing app | [Task guides](./apps/docs/content/docs/guides/index.mdx) and the [package chooser](./docs/reference/package-chooser.md). |
| Check APIs, defaults, and support | Use the [documentation map](./docs/README.md) to find the owning contract and package README. |
| Implement or review with AI | Read [AI Context](./docs/CONTEXT.md), then the documentation map/package chooser, the owning contract, and implementation, test, and execution evidence. |
| Compare runnable code | Check each app's environment and verification scope in the [examples catalog](./examples/README.md). |

The Book is the primary learning path; the short HTTP exercise is a companion. The exercise starts from separate repository checkpoints rather than continuing directly in a CLI-generated app. It does not provide completed applications for every Book chapter.

## Support and Migration

**Upgrading an existing project?** Follow the Node, packages, then imports order in the [Node 24 migration guide](./docs/getting-started/migrate-node24.md). Upgrading the CLI does not automatically rewrite an existing app's configuration. Also check the [Node.js support policy](./docs/reference/node-support.md) and [HTTP dependency security update](./docs/reference/dependency-security-update.md).

> **Deno: Deprecated.** Not recommended for new projects. No new features, performance work, or new runtime compatibility; critical security/regression fixes are considered case-by-case without a patch/LTS guarantee. Existing Deno paths and examples remain usable; removal is planned for the next major of the respective Deno-related packages ([#3938](https://github.com/fluojs/fluo/issues/3938)). Follow the [Deno migration guide](./docs/getting-started/migrate-from-deno.md).

Existing Deno API usage remains documented in the [Deno adapter README](./packages/platform-deno/README.md).

## Community

- [Discussions](https://github.com/fluojs/fluo/discussions): Questions, ideas, RFCs, and use cases.
- [Issues](https://github.com/fluojs/fluo/issues): Bug reports, documentation gaps, and feature requests.
- [Contributing](./CONTRIBUTING.md): Local setup, verification steps, and the PR process.
- [Support](./SUPPORT.md): Choose the right support channel.
- [Security](./SECURITY.md): Report vulnerabilities privately.
- [MIT license](./LICENSE).

## Our Philosophy

Explicit composition needs explicit boundaries. Package defaults, failure behavior, resource ownership, and support limits follow the [behavioral contracts](./docs/contracts/behavioral-contract-policy.md) and the owning package README. Installing packages does not complete an application's authentication policies, data consistency, or external delivery guarantees.

This README is an entry point. The [documentation authority policy](./docs/contracts/documentation-authority.md) defines ownership of detailed contracts; [release governance](./docs/contracts/release-governance.md) defines how versions and changelogs are managed.
