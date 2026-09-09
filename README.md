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

**fluo** is a TypeScript backend framework built on TC39 standard decorators and explicit dependency injection. Organize applications into controllers, services, and modules, then connect the database, authentication, and messaging packages you need.

[Quick Start](#quick-start) · [Book](./book/README.md) · [Documentation](./docs/README.md) · [Examples](./examples/README.md)

## Why fluo?

- **Standard decorators**: No dependency on `experimentalDecorators`, `emitDecoratorMetadata`, or `reflect-metadata`. fluo uses framework-owned metadata stores and standard decorator metadata integration.
- **Explicit dependencies**: Declare constructor tokens with class-level `@Inject(...)` and register providers and controllers with `@Module(...)`.
- **Testable features**: Compose HTTP routing, request validation, and response serialization, then verify DI wiring and request handling with the testing tools.
- **A choice of hosts**: Connect runtime-specific adapters to a shared module and DI model. Host lifecycle and package coverage follow each adapter's contract.
- **Scaffolding through diagnostics**: Use the CLI to generate projects and features and manage development, builds, and startup. `fluo inspect` and Studio provide paths to application structure and diagnostics.

## The Developer Experience

This minimal example puts an HTTP route, service injection, module registration, and Fastify startup in one file. The CLI starter below supplies the decorator transform and build configuration.

```ts
import { Inject, Module } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { runFastifyApplication } from '@fluojs/platform-fastify';

class GreetingService {
  greet() {
    return { message: 'Hello from fluo' };
  }
}

@Inject(GreetingService)
@Controller('/greeting')
class GreetingController {
  constructor(private readonly service: GreetingService) {}

  @Get('/')
  getGreeting() {
    return this.service.greet();
  }
}

@Module({
  controllers: [GreetingController],
  providers: [GreetingService],
})
class AppModule {}

await runFastifyApplication(AppModule, { port: 3000 });
```

Here, `GET /greeting` returns `{"message":"Hello from fluo"}`. Generated projects split this structure into separate files and add a repository, health checks, and tests. To run this example separately, replace the generated project's `src/main.ts` with the code above. The quick start below uses the unmodified starter.

## Quick Start

**Prerequisites:** Install Node.js 24.x and pnpm 10. The CLI and Node.js path support `>=24.0.0 <27`. The CLI itself runs on Node.js even when generating a project for another runtime.

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

`GET /health` also returns `200` and `{"status":"ok"}`. To change your first response, edit `src/greeting/greeting.repo.ts`. Follow request handling and dependency wiring in `greeting.controller.ts`, `greeting.service.ts`, and `greeting.module.ts` in the same directory.

Run the tests and build from the generated project directory:

```bash
pnpm test
pnpm build
```

The starter includes a Fastify app, `/greeting`, `/health`, `/ready`, tests, and build configuration. Add authentication, persistent storage, and deployment configuration in your application. See the [CLI guide](./packages/cli/README.md) for other starters and runner options, and the [toolchain contract](./docs/reference/toolchain-contract-matrix.md) for supported transforms.

**Upgrading an existing project?** Follow the Node, packages, then imports order in the [Node 24 migration guide](./docs/getting-started/migrate-node24.md). Upgrading the CLI does not automatically rewrite an existing app's configuration. Also check the [Node.js support policy](./docs/reference/node-support.md) and [HTTP dependency security update](./docs/reference/dependency-security-update.md).

## A Modular Ecosystem

Connect the capabilities you need. These are representative packages; the [package chooser](./docs/reference/package-chooser.md) provides the full catalog and selection guidance.

| Category | Packages |
| :--- | :--- |
| **Foundations** | [Core](./packages/core/README.md), [DI](./packages/di/README.md), [Runtime](./packages/runtime/README.md), [Config](./packages/config/README.md), [I18n](./packages/i18n/README.md) |
| **HTTP/API** | [HTTP](./packages/http/README.md), [Validation](./packages/validation/README.md), [Serialization](./packages/serialization/README.md), [OpenAPI](./packages/openapi/README.md), [GraphQL](./packages/graphql/README.md) |
| **Host adapters** | [Fastify](./packages/platform-fastify/README.md), [Express](./packages/platform-express/README.md), [Node.js](./packages/platform-nodejs/README.md), [Next.js](./packages/platform-nextjs/README.md), [Bun](./packages/platform-bun/README.md), [Deno](./packages/platform-deno/README.md), [Workers](./packages/platform-cloudflare-workers/README.md) |
| **Authentication** | [JWT](./packages/jwt/README.md), [Passport](./packages/passport/README.md) |
| **Data and caching** | [Prisma](./packages/prisma/README.md), [Drizzle](./packages/drizzle/README.md), [Mongoose](./packages/mongoose/README.md), [Redis](./packages/redis/README.md), [Cache Manager](./packages/cache-manager/README.md) |
| **Messaging and jobs** | [Microservices](./packages/microservices/README.md), [CQRS](./packages/cqrs/README.md), [Event Bus](./packages/event-bus/README.md), [Queue](./packages/queue/README.md), [Cron](./packages/cron/README.md) |
| **Realtime and notifications** | [WebSockets](./packages/websockets/README.md), [Socket.IO](./packages/socket.io/README.md), [Notifications](./packages/notifications/README.md), [Email](./packages/email/README.md), [Slack](./packages/slack/README.md), [Discord](./packages/discord/README.md) |
| **Operations** | [Health (Terminus)](./packages/terminus/README.md), [Metrics](./packages/metrics/README.md), [Throttler](./packages/throttler/README.md) |
| **React and developer tools** | [React](./packages/react/README.md), [CLI](./packages/cli/README.md), [Testing](./packages/testing/README.md), [Vite](./packages/vite/README.md), [Studio](./packages/studio/README.md) |

**Runtime support is package-specific.** Having an adapter does not make every package portable to that host. For example, the Drizzle integration is Node.js-only, while the Socket.IO adapter supports Node.js and Bun but not Deno or Workers. The Next.js integration targets Node.js hosts, not the Edge Runtime. Before changing hosts, check startup, shutdown, and dependency requirements in the [Canonical Runtime Package Matrix](./docs/reference/package-surface.md) and the owning package README.

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
