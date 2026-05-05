# Package Architecture Reference

<p><strong><kbd>English</kbd></strong> <a href="./architecture-overview.ko.md"><kbd>한국어</kbd></a></p>

## Layer Model

| Layer | Representative packages | Responsibility | Boundary |
| --- | --- | --- | --- |
| Core | `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, `@fluojs/runtime` | Defines decorators, dependency resolution, configuration access, bootstrap order, and runtime orchestration. | Core packages MUST provide framework contracts that remain independent from any concrete HTTP server or feature integration. |
| Transport | `@fluojs/http`, `@fluojs/platform-fastify`, `@fluojs/platform-nodejs`, `@fluojs/platform-express`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers` | Maps request execution, routing, response writing, and hosting-environment adapters onto runtime contracts. | Transport packages MUST implement runtime-facing adapter seams and MUST NOT redefine core dependency or configuration rules. |
| Feature | `@fluojs/graphql`, `@fluojs/validation`, `@fluojs/serialization`, `@fluojs/openapi`, `@fluojs/jwt`, `@fluojs/passport`, `@fluojs/cqrs`, `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, `@fluojs/redis`, `@fluojs/metrics`, `@fluojs/terminus`, `@fluojs/websockets`, `@fluojs/socket.io` | Adds protocol extensions, persistence integrations, auth, observability, and application capabilities on top of core and transport contracts. | Feature packages MUST attach to documented framework seams instead of introducing alternate bootstrap, DI, or platform lifecycles. |

## Package Responsibilities

| Package or family | Layer | Responsibility | Factual reference |
| --- | --- | --- | --- |
| `@fluojs/core` | Core | Owns TC39-standard decorators and framework metadata helpers. | `docs/architecture/decorators-and-metadata.md` |
| `@fluojs/di` | Core | Resolves providers, scopes, visibility, and module graph injection. | `docs/architecture/di-and-modules.md` |
| `@fluojs/config` | Core | Loads validated configuration snapshots and centralizes environment access. | `docs/architecture/config-and-environments.md` |
| `@fluojs/runtime` | Core | Compiles modules, registers runtime tokens, coordinates lifecycle hooks, and starts the adapter shell. | `docs/getting-started/bootstrap-paths.md` |
| `@fluojs/http` | Transport | Defines request context, routing phases, guards, interceptors, materialization, and response serialization. | `docs/architecture/http-runtime.md` |
| `@fluojs/platform-*` | Transport | Implements concrete runtime adapters for Node.js, Bun, Deno, Express, Fastify, and Cloudflare Workers. | `docs/architecture/platform-consistency-design.md` |
| `@fluojs/graphql` | Feature | Extends the HTTP execution model with GraphQL schema exposure and resolver execution. | `docs/reference/package-surface.md` |
| `@fluojs/validation` and `@fluojs/serialization` | Feature | Enforces input materialization, validation boundaries, and output shaping. | `docs/reference/package-surface.md` |
| `@fluojs/openapi` | Feature | Projects HTTP metadata into OpenAPI surface documentation. | `docs/reference/package-surface.md` |
| `@fluojs/jwt` and `@fluojs/passport` | Feature | Adds authentication, principal handling, and strategy integration without changing the core request pipeline. | `docs/reference/package-surface.md` |
| Persistence packages | Feature | Integrates storage and cache concerns through package-specific adapters such as `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, and `@fluojs/redis`. | `docs/reference/package-surface.md` |
| Operational packages | Feature | Adds health, metrics, and runtime observability through `@fluojs/terminus` and `@fluojs/metrics`. | `docs/reference/package-surface.md` |
| Realtime packages | Feature | Adds gateway and bidirectional transport support through `@fluojs/websockets` and `@fluojs/socket.io`. | `docs/reference/package-surface.md` |

## Dependency Rules

| Rule | Statement |
| --- | --- |
| Rule 1 | Core packages MUST NOT depend on transport adapters or feature packages. |
| Rule 2 | Transport packages MAY depend on core contracts, but transport packages MUST NOT redefine decorator, DI, or config primitives owned by the core layer. |
| Rule 3 | Feature packages MAY depend on core packages and the documented transport surface that they extend. |
| Rule 4 | Feature packages MUST NOT access hosting-environment APIs as a substitute for `@fluojs/config`, runtime lifecycle contracts, or documented adapter seams. |
| Rule 5 | Platform packages MUST implement the repository policy seam named `PlatformAdapter` (`HttpApplicationAdapter` for HTTP transports) and MUST preserve the request-phase ordering defined by the HTTP runtime. |
| Rule 6 | Cross-package integration MUST flow through exported module contracts, provider tokens, and documented metadata rather than implicit reflection or ambient globals. |

## Constraints

- Constraint: architecture documents in this repository treat `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, and `@fluojs/runtime` as the canonical core boundary.
- Constraint: packages MUST use TC39 standard decorators and MUST NOT require `experimentalDecorators` or `emitDecoratorMetadata`.
- Constraint: packages MUST NOT read `process.env` directly, configuration enters package code through `@fluojs/config` and DI.
- Constraint: module visibility is private by default, cross-module access MUST pass through explicit `exports` and `imports` chains.
- Constraint: transport adapters MUST translate runtime contracts to concrete servers without changing bootstrap order, guard order, validation order, or response serialization order.
- Constraint: feature integrations MUST extend existing framework seams, they MUST NOT create alternate lifecycle state machines or parallel dependency containers.
