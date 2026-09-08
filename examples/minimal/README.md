# minimal example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

A small fluo repository example of explicit low-level Node.js + Fastify composition: `FluoFactory.create(...)` with `createFastifyAdapter(...)`, followed by `app.listen()`. It is not the generated starter. The default and explicit HTTP v2 starter for Node.js + Fastify uses `runFastifyApplication(...)`, whose middleware defaults, logger, post-creation failure cleanup, and signal registration are not automatically reproduced by this composition. Factory still shares runtime initialization-failure cleanup. See the [bootstrap recipe](../../docs/getting-started/bootstrap-paths.md).

## what this example demonstrates

- Explicit Fastify bootstrap via `FluoFactory.create(..., { adapter: createFastifyAdapter(...) })` (`fluoFactory` is the same factory's alias)
- Standard decorator DI with `@Module`, `@Inject`, `@Controller`, `@Get`
- Built-in `/health` and `/ready` endpoints from `HealthModule.forRoot(...)`
- A single starter controller at `/hello`
- Portable multipart DTO binding at `/uploads` with `@FromFiles('attachments')`
- Unit and e2e-style testing with `@fluojs/testing`

## how to run

This example lives inside the fluo monorepo and uses workspace-linked packages. From the repository root:

```sh
pnpm install
```

The package has no dev/start script. Its `src/main.ts` would start a network listener when built and executed; the repository test command below instead validates the request pipeline without running that entrypoint:

```sh
pnpm vitest run examples/minimal
```

Use Node.js `>=24.0.0 <27` and the repository's standard decorator test configuration. Preserve metadata preparation before decorated declarations evaluate; do not enable legacy decorator flags to run this example. Its entrypoint passes numeric port `3000` directly and has no `PORT` parser or automatic Node signal registration.

## project structure

```
examples/minimal/
├── src/
│   ├── app.ts              # AppModule — root module
│   ├── main.ts             # Entry point: adapter-first Fastify startup
│   ├── hello.controller.ts # GET /hello
│   ├── hello.service.ts    # Business logic
│   ├── upload.controller.ts # POST /uploads portable multipart DTO
│   └── app.test.ts         # Unit + createTestApp request-helper tests
└── README.md
```

## relationship to the starter scaffold

This is a `repository-example` with `workspace:*` dependencies, not a registry-based `generated-app`. The generated `src/app.ts` keeps `ConfigModule`, `GreetingModule`, and `HealthModule.forRoot()`; do not overwrite it with this example's root module while retaining tests that expect greeting. Generated lifecycle scripts use `fluo dev`, `fluo build`, and `fluo start`, not scripts supplied by this example.

This example is intentionally smaller than the full `fluo new` HTTP starter output. The CLI starter now emits a `src/greeting/` feature slice with controller/service/repository files, unit tests, slice tests, `src/app.test.ts`, `test/app.e2e.test.ts`, and build/test tooling config. If you want that complete starter experience, run either the default command or the explicit Node.js + Fastify HTTP contract:

```sh
pnpm add -g @fluojs/cli
fluo new my-app
fluo new my-app --shape application --transport http --runtime node --platform fastify
```

This example does not cover Express/raw Node.js/Bun/Deno/Cloudflare Workers application starters, TCP/Redis Streams/NATS/Kafka/RabbitMQ/MQTT/gRPC microservice starters, or the mixed single-package starter. Those contracts are documented in `../../packages/cli/README.md`, `../../docs/reference/fluo-new-support-matrix.md`, and `../../docs/reference/toolchain-contract-matrix.md`.

## related docs

- `../README.md` — official examples index
- `../../docs/getting-started/quick-start.md` — canonical first-run guide
- `../../docs/getting-started/first-feature-path.md` — path from starter app to first feature
- `../../docs/reference/fluo-new-support-matrix.md` — exact `fluo new` starter matrix
- `../../docs/reference/package-chooser.md` — pick packages by task
- `../../docs/contracts/testing-guide.md` — testing patterns and recipes
