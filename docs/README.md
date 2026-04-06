# docs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Welcome to the Konekti cross-package documentation hub. This directory contains framework-level information that spans multiple packages. For package-specific APIs, refer to `../packages/*/README.md`.

## start

If you are new to Konekti, follow this path to get your first application running.

- `getting-started/quick-start.md` - **Canonical first run**: install -> `new` -> `dev`.
- `getting-started/first-feature-path.md` - **Official next step**: from starter app to first real feature.
- `getting-started/bootstrap-paths.md` - Bootstrap reference and advanced startup paths.
- `reference/glossary-and-mental-model.md` - Core vocabulary and mental model.

## examples

Working applications that demonstrate the canonical starter path and common patterns. The examples in this directory stay on the default Node.js + Fastify starter path, while the package docs cover the other official runtimes.

- `../examples/minimal/` - Smallest runnable Konekti app, matching the `konekti new` output.
- `../examples/realworld-api/` - Multi-module app with DTO validation, config loading, and CRUD.
- `../examples/auth-jwt-passport/` - Bearer-token auth example with JWT issuance and passport-style route protection.
- `../examples/ops-metrics-terminus/` - Metrics + terminus example for `/metrics`, `/health`, and `/ready`.
- `../examples/README.md` - Current official example index and reading order.

## common tasks

Practical guides for day-to-day development once your application is running.

- `getting-started/generator-workflow.md` - Using the CLI to generate modules and providers.
- `operations/testing-guide.md` - Unit and integration testing patterns.
- `operations/platform-conformance-authoring-checklist.md` - Platform-facing package conformance harness gate and authoring checklist.
- `operations/release-governance.md` - Release checks, CI governance gates (PR affected-scope build/typecheck/test with safe full fallback and governance gate vs `main` full verification + release-readiness gate), including the package-source `process.env` boundary guard.
- `operations/behavioral-contract-policy.md` - Behavioral contract documentation requirements and CI governance enforcement rules, including explicit env-ownership rules for package internals.
- `operations/deployment.md` - Moving from local development to production.
- `concepts/auth-and-jwt.md` - Implementing authentication and session management.
- `concepts/openapi.md` - Documenting and exposing your API surface.

## packages

Konekti is highly composable. Use these links to discover and select the right tools for your task.

For the canonical runtime/package matrix, start with `reference/package-surface.md`. This hub keeps the starter/default-path framing short, still points readers to the default `@konekti/platform-fastify` starter path, the raw Node `@konekti/platform-nodejs` path, the `@konekti/platform-express` Node.js alternative, and links to the published adapter READMEs for runtime-specific startup or hosting details. Raw `@konekti/websocket/node` and `@konekti/platform-socket.io` support are intentionally documented as limited to the currently tested server-backed adapters (`platform-nodejs`, `platform-fastify`, and `platform-express`), while Bun, Deno, and Cloudflare Workers remain outside those support claims until a tested compatible implementation exists.

- `reference/package-chooser.md` - **Start here**: Pick the right packages for your specific use case.
- `reference/package-surface.md` - Overview of the public API surface across the framework.
- `reference/package-chooser.md#add-real-time-communication` - Task-oriented raw websocket vs Socket.IO package guidance, including the current supported adapter set for both realtime options.
- `reference/package-surface.md#package-responsibilities` - Canonical package ownership summary, including the honest raw websocket and Socket.IO support boundaries.
- `reference/toolchain-contract-matrix.md` - Versioning and compatibility across the ecosystem.
- `../packages/platform-fastify/README.md` - `@konekti/platform-fastify` contract for the default Node.js starter path.
- `../packages/platform-nodejs/README.md` - `@konekti/platform-nodejs` contract for raw Node.js HTTP startup on the runtime facade.
- `../packages/platform-express/README.md` - `@konekti/platform-express` contract for Node.js compatibility-focused apps.
- `../packages/websocket/README.md` - `@konekti/websocket` gateway authoring contracts plus the raw `ws` Node binding boundary on `@konekti/websocket/node`.
- `../packages/platform-socket.io/README.md` - `@konekti/platform-socket.io` contract for Socket.IO gateway behavior on the platform-selected realtime capability seam.
- `../packages/platform-bun/README.md` - `@konekti/platform-bun` contract and startup path.
- `../packages/platform-deno/README.md` - `@konekti/platform-deno` contract and startup path.
- `../packages/platform-cloudflare-workers/README.md` - `@konekti/platform-cloudflare-workers` contract and startup path.

## migration

Guidance for moving existing applications to the Konekti standard decorator model.

- `getting-started/migrate-from-nestjs.md` - Step-by-step guide for NestJS developers.
- `operations/nestjs-parity-gaps.md` - Known differences and how to bridge them.

## reference

Deep dives into the architecture, runtime behavior, and governing policies.

### architecture & runtime
- `concepts/architecture-overview.md`
- `concepts/platform-consistency-design.md`
- `concepts/dev-reload-architecture.md`
- `concepts/di-and-modules.md`
- `concepts/config-and-environments.md`
- `concepts/http-runtime.md`
- `concepts/cqrs.md`
- `concepts/caching.md`
- `concepts/transactions.md`
- `concepts/observability.md`
- `concepts/security-middleware.md`
- `concepts/lifecycle-and-shutdown.md`

### behavior & policy
- `concepts/decorators-and-metadata.md`
- `concepts/error-responses.md`
- `operations/release-governance.md`
- `operations/behavioral-contract-policy.md`
- `operations/third-party-extension-contract.md`

## authority rules

- Documentation for shipped behavior belongs here or in a package README.
- Future work belongs in GitHub Issues.
- If a topic is specific to one package, prefer the package README to avoid duplication.
