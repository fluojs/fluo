# architecture overview

<p><strong><kbd>English</kbd></strong> <a href="./architecture-overview.ko.md"><kbd>한국어</kbd></a></p>

Konekti maintains a narrow public surface, moving most behavior behind stable decorators, explicit package boundaries, and a CLI-first bootstrap flow.

### related documentation

- `./http-runtime.md`
- `./platform-consistency-design.md`
- `./dev-reload-architecture.md`
- `./auth-and-jwt.md`
- `../reference/package-surface.md`

## public package families

### framework core

- `@konekti/core`
- `@konekti/config`
- `@konekti/di`
- `@konekti/http`
- `@konekti/runtime`
- `@konekti/testing`

### validation, serialization, auth, and docs

- `@konekti/validation`
- `@konekti/serialization`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/openapi`
- `@konekti/metrics`
- `@konekti/cron`

### data integrations

- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`

### tooling

- `@konekti/cli`

## package connection map

- `@konekti/core`: shared decorators, metadata helpers, and stable framework primitives.
- `@konekti/di`: explicit token-based provider resolution and scopes.
- `@konekti/http`: request execution, validation/materialization entrypoints, exceptions, and route metadata.
- `@konekti/runtime`: config assembly, DI, handler mapping, health/readiness, adapter bootstrapping, and dev-mode config reload application.
- `@konekti/platform-*`: runtime/protocol adapter packages that implement `PlatformAdapter` and bridge the abstract HTTP layer to concrete runtimes or server libraries; see `../reference/package-surface.md#platform--naming-convention` for naming rationale and package-selection guidance.
- `@konekti/validation` package: input materialization and validation engine.
- `@konekti/serialization` package: output shaping and response serialization decorators plus interceptor support.
- `@konekti/jwt`: token-core concerns.
- `@konekti/passport`: generic auth strategy registration and guard wiring.
- `@konekti/openapi`: document production from route and schema metadata.
- `@konekti/metrics`: Prometheus metrics via runtime-owned HTTP routes.
- `@konekti/cron`: decorator-based background task scheduling and optional distributed cron locks.
- `@konekti/redis`: Redis client lifecycle and DI token surface.

## request execution path

The runtime execution path follows this sequence:

```text
bootstrap -> handler mapping -> app middleware -> route match -> module middleware -> guard -> interceptor -> input binding/materialization -> input validation -> controller -> response serialization -> response write
```

Implementation details are located in:

- `packages/http/src/dispatcher.ts`
- `packages/http/src/mapping.ts`
- `packages/runtime/src/application.test.ts`

## design stance

- Explicit DI and stable metadata are preferred over implicit magic.
- Package boundaries take precedence over phase history.
- Starter apps should use runtime-owned bootstrap helpers instead of duplicating infrastructure.
- Development-time source edits use runner-level process restart, while targeted config reload remains an explicit runtime path.
- Package READMEs contain package-specific details; `docs/` contains cross-package information.

## transport boundary

Konekti is currently HTTP-first.

- The official runtime and starter paths assume HTTP request/response execution.
- Packages named `@konekti/platform-*` mark the runtime/protocol adapter boundary rather than generic library wrappers.
- Adapter-agnostic framework types exist but do not imply supported non-HTTP surfaces.
- Support for non-HTTP transports (e.g., websockets, gateways) is deferred to future updates.

This ensures transport expansion remains an explicit decision rather than an accidental side effect of internal helpers.
