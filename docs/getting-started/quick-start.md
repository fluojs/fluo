# Setup Command Reference

<p><strong><kbd>English</kbd></strong> <a href="./quick-start.ko.md"><kbd>한국어</kbd></a></p>

## Prerequisites

- Node.js runtime available on the host system.
- `pnpm` available on the host system.
- Shell session with permission to install a global package or run `pnpm dlx`.
- Default generated application path: Node.js runtime, HTTP transport, Fastify platform.

## Installation

The fluo CLI is your central tool for project scaffolding and component generation.

Global install:

```bash
pnpm add -g @fluojs/cli
```

Expected output pattern:

```text
Packages: +1
dependencies:
+ @fluojs/cli <version>
Done in <time>
```

No-install execution path:

```bash
pnpm dlx @fluojs/cli new my-fluo-app
```

## Project Creation

Default application starter:

```bash
fluo new my-fluo-app
cd my-fluo-app
```

Expected output pattern:

```text
Scaffolding project: my-fluo-app
Template: application/http/node/fastify
Installing dependencies: <package-manager-dependent>
Project ready
```

Representative explicit starters:

```bash
fluo new my-app --shape application --transport http --runtime node --platform fastify
fluo new my-express-app --shape application --transport http --runtime node --platform express
fluo new my-node-app --shape application --transport http --runtime node --platform nodejs
fluo new my-bun-app --shape application --transport http --runtime bun --platform bun
fluo new my-deno-app --shape application --transport http --runtime deno --platform deno
fluo new my-worker-app --shape application --transport http --runtime cloudflare-workers --platform cloudflare-workers
fluo new my-microservice --shape microservice --transport tcp --runtime node --platform none
fluo new my-redis-streams-service --shape microservice --transport redis-streams --runtime node --platform none
fluo new my-nats-service --shape microservice --transport nats --runtime node --platform none
fluo new my-kafka-service --shape microservice --transport kafka --runtime node --platform none
fluo new my-rabbitmq-service --shape microservice --transport rabbitmq --runtime node --platform none
fluo new my-mqtt-service --shape microservice --transport mqtt --runtime node --platform none
fluo new my-grpc-service --shape microservice --transport grpc --runtime node --platform none
fluo new my-mixed-app --shape mixed --transport tcp --runtime node --platform fastify
```

Generated artifacts for the default application starter:

```text
my-fluo-app/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── src/
    ├── app.ts
    ├── hello.controller.ts
    ├── hello.service.ts
    └── main.ts
```

Authoritative starter matrix: [fluo new support matrix](../reference/fluo-new-support-matrix.md).

In an interactive terminal, the `fluo new` wizard resolves the same maintained starter matrix before writing files.

### Previewing a starter plan

Use `--print-plan` when you need to inspect the resolved starter without touching the filesystem:

```bash
fluo new my-fluo-app --print-plan
fluo new my-service --shape microservice --transport tcp --print-plan
fluo new my-mixed-app --shape mixed --print-plan
```

Plan preview mode resolves the same project name, target directory, shape, runtime, platform, transport, tooling preset, package manager, dependency installation choice, and git initialization choice as a real scaffold. It prints the selected starter recipe and runtime/dev dependency sets, then exits with no side effects. It does not create files, install dependencies, or initialize git.

## Development Server

Generated project start command from the project root:

```bash
pnpm dev
```

The generated lifecycle scripts run `fluo dev`, `fluo build`, and `fluo start`. Those CLI lifecycle runners select the starter's runtime commands and default `NODE_ENV` to `development` for dev and `production` for build/start unless the caller already set it.

Expected output pattern:

```text
Server listening on http://localhost:3000
```

Default verification endpoints:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/hello
```

Expected output:

```text
{"status":"ok"}
{"message":"Hello, World!"}
```

## Invariants

- `tsconfig.json` keeps `experimentalDecorators` disabled.
- `tsconfig.json` keeps `emitDecoratorMetadata` disabled.
- The default generated application listens on port `3000` during `pnpm dev`, which delegates to `fluo dev`; generated build/start scripts likewise delegate to `fluo build` and `fluo start`.
- The default generated application exposes `/health` and `/hello`.
- `fluo new` starter variants map to the maintained starter matrix documented in the CLI README and the support matrix.
- `fluo new --print-plan` is a read-only preview path. It resolves the starter plan and dependency sets without writing project files, running dependency installation, or initializing git.
