# realworld-api example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

A more realistic fluo application demonstrating the standard app path beyond the minimal starter. This example builds on the same starter-aligned adapter-first bootstrap while adding module composition, DTO validation, config loading, and a domain CRUD slice.

## what this example demonstrates

- Multi-module composition with `imports` / `exports`
- Typed configuration via `ConfigModule.forRoot`
- Request DTO validation with `@fluojs/validation` decorators
- Repository pattern with explicit DI tokens
- Runtime-owned `/health` and `/ready` plus a domain `/users` CRUD surface
- Unit and e2e-style testing patterns from `@fluojs/testing`

## how to run

This example lives inside the fluo monorepo and uses workspace-linked packages. From the repository root:

```sh
pnpm install
```

The example is validated through tests:

```sh
pnpm vitest run examples/realworld-api
```

## project structure

```
examples/realworld-api/
├── src/
│   ├── app.ts                     # AppModule — root module with config and domain imports
│   ├── main.ts                    # Entry point: adapter-first Fastify startup
│   ├── users/
│   │   ├── users.module.ts        # UsersModule — domain module
│   │   ├── users.controller.ts    # GET/POST /users
│   │   ├── users.service.ts       # Business logic
│   │   ├── users.repo.ts          # In-memory repository
│   │   ├── create-user.dto.ts     # Request DTO with validation
│   │   └── user-response.dto.ts   # Response shape
│   └── app.test.ts                # Integration + e2e tests
└── README.md
```

## relationship to the starter scaffold

This example extends the `konekti new` pattern by adding a real domain module. It uses the same packages the starter includes (core, runtime, http, config, validation, testing, platform-fastify) plus standard module composition patterns. No extra packages beyond the starter scaffold are required.

## recommended reading order

1. `src/users/create-user.dto.ts` — DTO validation decorators
2. `src/users/users.repo.ts` — explicit DI with class token
3. `src/users/users.service.ts` — `@Inject` with explicit tokens
4. `src/users/users.controller.ts` — route handlers with `@RequestDto`
5. `src/users/users.module.ts` — module boundary with `exports`
6. `src/app.ts` — root module composition
7. `src/app.test.ts` — testing at unit, integration, and e2e levels

## related docs

- `../README.md` — official examples index
- `../../docs/getting-started/quick-start.md` — canonical first-run guide
- `../../docs/getting-started/first-feature-path.md` — path from starter app to first feature
- `../../docs/reference/package-chooser.md` — pick packages by task
- `../../docs/operations/testing-guide.md` — testing patterns and recipes
- `../../docs/concepts/di-and-modules.md` — DI and module system
