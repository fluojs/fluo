# examples

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Choose an official repository example to run or test the capability you need. To create a new application, use the [root quick start](../README.md#quick-start). Start with the [three-volume Book](../book/README.md) for the complete product and pattern learning path. The [short FluoBlog exercise](../apps/docs/content/docs/tutorial/index.mdx) and its [complete checkpoints](./fluo-blog/README.md) are companions for the initial HTTP/DI path. Other examples are independent capability references, not later chapters of that project. If you are an AI tool or need contract references, start from `../docs/CONTEXT.md`.

These examples cover the HTTP side of the published `fluo new` v2 matrix through shared public framework APIs, not identical scaffolds or bootstrap policies. They are `repository-example` workspaces; generated applications use registry dependencies and their own CLI lifecycle scripts. The other first-class starter contracts are the runnable application starter variants for Express, raw Node.js HTTP, Bun, and Cloudflare Workers; the runnable microservice starter paths (TCP by default, plus Redis Streams, NATS, Kafka, RabbitMQ, MQTT, and gRPC); and the mixed single-package path (Fastify HTTP app + attached TCP microservice).

The historical platform inventory of the v2 HTTP starter matrix includes Express, raw Node.js HTTP, Bun, Deno, and Cloudflare Workers. This inventory is not the current first-class support or new-project recommendation list. The Deno starter remains a deprecated path for existing users during migration. Do not choose it for new projects; follow the [Deno migration guide](../docs/getting-started/migrate-from-deno.md).

## current official examples

- [`./fluo-blog/`](./fluo-blog/README.md) — cumulative tutorial checkpoints for posts, explicit DI, validation, errors, and tests
- [`./minimal/`](./minimal/README.md) — explicit low-level Fastify composition, not the default generated starter
- [`./realworld-api/`](./realworld-api/README.md) — a more realistic multi-module HTTP API with config, DTO validation, explicit DI, and CRUD
- [`./auth-jwt-passport/`](./auth-jwt-passport/README.md) — bearer-token auth example with JWT issuance and protected routes via passport core
- [`./ops-metrics-terminus/`](./ops-metrics-terminus/README.md) — operations example centered on `/metrics`, `/health`, and `/ready`
- [`./openapi-multiple-documents/`](./openapi-multiple-documents/README.md) — two OpenAPI JSON documents and Swagger UI pages on distinct routes
- [`./graphql/`](./graphql/README.md) — GraphQL module registration, resolver discovery, operation-scoped DataLoader, and SSE subscriptions
- [`./react-stable-ssr/`](./react-stable-ssr/README.md) — stable `@fluojs/react` SSR MVP example with HTTP-owned routes, DTO-bound
  params/search, lifecycle middleware, and explicit hydration assets
- [`./react-vite-ssr/`](./react-vite-ssr/README.md) — Vite-backed React SSR example with manifest-fed assets, streamed Suspense,
  hydration, HTTP-first client navigation, and a JavaScript-optional native form mutation

## run examples from the repo root

Prepare Node.js `>=24.11.0 <27` and the repository-pinned pnpm 10. These commands **run tests**, not development servers. Choose the test command for the example you need.

```bash
pnpm install
pnpm vitest run examples/fluo-blog
pnpm vitest run examples/minimal
pnpm vitest run examples/realworld-api
pnpm vitest run examples/auth-jwt-passport
pnpm vitest run examples/ops-metrics-terminus
pnpm vitest run examples/openapi-multiple-documents
pnpm vitest run examples/graphql
pnpm vitest run examples/react-stable-ssr
pnpm vitest run examples/react-vite-ssr
```

To try an app in a browser or with `curl`, follow the build/start commands and expected results in [FluoBlog](./fluo-blog/README.md#run-inside-the-repository), [GraphQL](./graphql/README.md#how-to-run), or [React + Vite](./react-vite-ssr/README.md#run-from-the-repo-root). Run each example server separately.

## recommended reading order

Follow the [Book](../book/README.md) for the complete learning path, or use the [FluoBlog exercise](../apps/docs/content/docs/tutorial/index.mdx) to check the initial HTTP behavior quickly. Choose the standalone examples below by the capability you need:

1. `./minimal/README.md` — smallest bootstrap and request path
2. `./realworld-api/README.md` — first real domain module and DTO boundary
3. `./auth-jwt-passport/README.md` — auth, JWT issuance, and protected route path
4. `./ops-metrics-terminus/README.md` — metrics and health/readiness path
5. `./openapi-multiple-documents/README.md` — multiple OpenAPI JSON and Swagger UI routes
6. `./graphql/README.md` — code-first GraphQL query, DataLoader, and SSE subscription flow
7. `./react-stable-ssr/README.md` — stable React SSR pages as HTTP-owned handlers
8. `./react-vite-ssr/README.md` — Vite build manifest and hydration layered onto the SSR baseline

The [Book](../book/README.md) is the primary learning path from FluoBlog through commerce and framework internals. Previous-edition project-state labels do not identify snapshots in this directory.

## how these examples fit the docs

- `minimal` and the default CLI Node/Fastify starter share static adapter + Factory + listen. Factory owns middleware, logging, and startup cleanup; the host explicitly selects signal registration.
- `realworld-api` proves the first practical module/DTO/test path beyond that HTTP starter baseline
- `auth-jwt-passport` proves the current official bearer-token auth path
- `ops-metrics-terminus` proves the current markdown-first observability/health path
- `openapi-multiple-documents` proves that one app can serve independently configured OpenAPI JSON and Swagger UI routes
- `graphql` proves resolver discovery, operation-scoped DataLoader reuse, and the default SSE subscription lifecycle
- `react-stable-ssr` proves the stable `@fluojs/react` root contract: `@Router`/`@Path` are lexical
  facades over `@fluojs/http`, URL matching and route grammar stay HTTP-owned, DTO validation and
  the request lifecycle are preserved, hydration assets are explicit, and RSC/server functions stay
  outside the stable root
- `react-vite-ssr` proves the Vite hydration and `@fluojs/react/client` phases: the same HTTP-owned
  route and DTO contracts feed streamed Suspense HTML, an already-loaded Vite manifest supplies
  hydration assets, full-document client navigation keeps server DTO validation authoritative, and
  a native form crosses guarded/intercepted `POST`, validation, mutation, and `303` redirect boundaries
  without claiming SPA document swapping, file-based routing, or compiled actions

The examples also anchor the canonical fluo TDD ladder from `../docs/contracts/testing-guide.md`: write fast unit tests near `src/**`, add slice/module tests with `Test.createTestingModule({ rootModule })` when DI wiring or provider overrides matter, and use `Test.createApp({ rootModule })` with `app.request(...).send()` for app-level e2e-style request-pipeline checks. Existing files such as `minimal/src/app.test.ts`, `auth-jwt-passport/src/app.test.ts`, and `ops-metrics-terminus/src/app.test.ts` show the app-level end of that ladder.

The [bootstrap owner](../docs/getting-started/bootstrap-paths.md) defines Factory creation/startup cleanup and explicit host signal ownership. FluoBlog uses the same static adapter, Factory, and listen path while retaining workspace package builds and numbered checkpoint scripts; it does not supply the generated app's config/greeting registrations. Preserve those registrations and tests when extending a generated app rather than copying a repository root module over it.

For the other v2 starter contracts, see the CLI README for commands and the contract matrix for the full specification:

- `../packages/cli/README.md` — command examples for HTTP, microservice, mixed, and interactive wizard flows
- `../docs/reference/toolchain-contract-matrix.md` — published starter contract matrix

These examples are intentionally small enough to read in one sitting. They are not meant to replace package READMEs.

## related docs

- `../README.md`
- `../book/README.md`
- `../docs/CONTEXT.md`
- `../docs/getting-started/quick-start.md`
- `../docs/getting-started/first-feature-path.md`
