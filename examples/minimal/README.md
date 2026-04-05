# minimal example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The smallest runnable Konekti application. This example follows the exact same startup path that `konekti new` generates, stripped down to the essentials.

## what this example demonstrates

- Adapter-first Fastify bootstrap via `KonektiFactory.create(..., { adapter: createFastifyAdapter(...) })`
- Standard decorator DI with `@Module`, `@Inject`, `@Controller`, `@Get`
- Built-in `/health` and `/ready` endpoints from `createHealthModule()`
- A single starter controller at `/hello`
- Unit and e2e-style testing with `@konekti/testing`

## how to run

This example lives inside the Konekti monorepo and uses workspace-linked packages. From the repository root:

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
│   └── app.test.ts         # Runtime dispatch + e2e-style tests
└── README.md
```

## relationship to the starter scaffold

This example is intentionally a subset of the `konekti new` output. If you want the full starter experience with config, health module, generated tests, and build tooling, run:

```sh
pnpm add -g @konekti/cli
konekti new my-app
```

## related docs

- `../README.md` — official examples index
- `../../docs/getting-started/quick-start.md` — canonical first-run guide
- `../../docs/getting-started/first-feature-path.md` — path from starter app to first feature
- `../../docs/reference/package-chooser.md` — pick packages by task
- `../../docs/operations/testing-guide.md` — testing patterns and recipes
