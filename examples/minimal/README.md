# minimal example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The smallest runnable fluo application. This example follows the same adapter-first bootstrap path as the default and explicit HTTP v2 starter for `fluo new` Node.js + Fastify, stripped down to a smaller `/hello` route and a compact test set.

## what this example demonstrates

- Adapter-first Fastify bootstrap via `fluoFactory.create(..., { adapter: createFastifyAdapter(...) })`
- Standard decorator DI with `@Module`, `@Inject`, `@Controller`, `@Get`
- Built-in `/health` and `/ready` endpoints from `HealthModule.forRoot(...)`
- A single starter controller at `/hello`
- Unit and e2e-style testing with `@fluojs/testing`

## how to run

This example lives inside the fluo monorepo and uses workspace-linked packages. From the repository root:

```sh
pnpm install
```

The example does not start a network listener by default — it is validated through tests. To verify:

```sh
pnpm vitest run examples/minimal
```

## project structure

```
examples/minimal/
├── src/
│   ├── app.ts              # AppModule — root module
│   ├── main.ts             # Entry point: adapter-first Fastify startup
│   ├── hello.controller.ts # GET /hello
│   ├── hello.service.ts    # Business logic
│   └── app.test.ts         # Unit + createTestApp request-helper tests
└── README.md
```

## relationship to the starter scaffold

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
