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

Completion output pattern:

```text
Done.
Next steps:
  cd ./my-fluo-app
  pnpm dev  # runs fluo dev
```

When you choose not to install dependencies, the CLI prints `Skipping dependency installation.` before this completion output. When you install dependencies, it prints `Installing dependencies with pnpm...` and the package-manager output before the same next steps.

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
├── .env
├── .gitignore
├── README.md
├── babel.config.cjs
├── package.json
├── pnpm-lock.yaml # written when dependencies are installed
├── tsconfig.json
├── tsconfig.build.json
├── vite.config.ts
├── vitest.config.ts
├── test/
│   └── app.e2e.test.ts
└── src/
    ├── app.ts
    ├── app.test.ts
    ├── main.ts
    └── greeting/
        ├── greeting.controller.ts
        ├── greeting.controller.test.ts
        ├── greeting.module.ts
        ├── greeting.repo.ts
        ├── greeting.repo.test.ts
        ├── greeting.response.dto.ts
        ├── greeting.service.ts
        ├── greeting.service.test.ts
        └── greeting.slice.test.ts
```

The tree above describes the default Node.js + Fastify application starter. `pnpm-lock.yaml` is created by the dependency-install step, so `fluo new ... --no-install` omits it. The `vite.config.ts` artifact imports `fluoDecoratorsPlugin()` from `@fluojs/vite` for application-file decorator transforms, while `vitest.config.ts` imports `@fluojs/testing/vitest` so generated test files keep their testing-specific transform path. Other shipped starter recipes deliberately differ: Deno omits the Node/Vite/Babel/Vitest config files and keeps a Deno-native `src/app.test.ts`; Cloudflare Workers uses `src/worker.ts` plus `wrangler.jsonc`; gRPC microservices add `proto/math.proto`; and microservice or mixed starters emit `src/math/*` transport handlers instead of the HTTP-only greeting tree alone.

Authoritative starter matrix: [fluo new support matrix](../reference/fluo-new-support-matrix.md).

In an interactive terminal, the `fluo new` wizard resolves the same maintained starter matrix before writing files.

### Choosing a destination

By default, `fluo new my-fluo-app` writes into `./my-fluo-app`. Use `--target-directory` when the project name and filesystem destination should differ, or when automation needs an explicit output path:

```bash
fluo new my-fluo-app --target-directory ./apps/api
```

The target directory must be empty or absent by default. Add `--force` only when you intentionally want the scaffold to overwrite conflicting generated files in an existing target:

```bash
fluo new my-fluo-app --target-directory ./apps/api --force
```

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

The default Node.js + Fastify starter generates lifecycle scripts that run `fluo dev`, `fluo build`, and `fluo start`. Those CLI lifecycle runners select the starter's runtime commands and default `NODE_ENV` to `development` for dev and `production` for build/start unless the caller already set it. Bun, Deno, and Cloudflare Workers starters still use the `fluo dev` abstraction, but default to each runtime's native watch loop to reduce Node-supervised dev processes; `fluo dev --runner fluo` restores the fluo-owned restart-on-watch boundary when you need its debounce/hash reporter contract. Their generated production/deployment scripts use runtime-native commands: Bun builds with `bun build` and starts with `bun dist/main.js`, Deno compiles with `deno compile` and starts the compiled `./dist/app`, and Workers exposes Wrangler `preview`/`deploy` scripts instead of a `start` script.

Expected output pattern:

```text
Server listening on http://localhost:3000
```

Default verification endpoints:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/greeting
```

Expected output:

```text
{"status":"ok"}
{"message":"Hello from fluo","framework":"fluo","project":"my-fluo-app"}
```

## Invariants

- `tsconfig.json` keeps `experimentalDecorators` disabled.
- `tsconfig.json` keeps `emitDecoratorMetadata` disabled.
- The default generated Node.js application listens on port `3000` during `pnpm dev`, which delegates to `fluo dev`; its generated build/start scripts likewise delegate to `fluo build` and `fluo start`.
- Generated Bun, Deno, and Cloudflare Workers applications keep the `fluo dev` command abstraction, default to runtime-owned watch/reload behavior, and expose `fluo dev --runner fluo` for the fluo-owned restart-on-watch contract.
- Generated Bun and Deno application production scripts are runtime-native after build, and generated Cloudflare Workers applications use Wrangler `preview`/`deploy` scripts instead of `start`.
- The default generated application exposes runtime `/health` plus starter-owned `/greeting`.
- `fluo new` starter variants map to the maintained starter matrix documented in the CLI README and the support matrix.
- `fluo new --print-plan` is a read-only preview path. It resolves the starter plan and dependency sets without writing project files, running dependency installation, or initializing git.
