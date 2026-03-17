# architecture overview

<p><strong><kbd>English</kbd></strong> <a href="./architecture-overview.ko.md"><kbd>한국어</kbd></a></p>


Konekti keeps the public surface intentionally narrow and pushes most behavior behind stable decorators, explicit package boundaries, and a CLI-first bootstrap flow.

See also:

- `./http-runtime.md`
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

### validation, auth, and docs

- `@konekti/dto-validator`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/openapi`
- `@konekti/metrics`

### data integrations

- `@konekti/prisma`
- `@konekti/drizzle`

### tooling

- `@konekti/cli`

## package connection map

- `@konekti/core` owns shared decorators, metadata helpers, and stable framework primitives
- `@konekti/di` owns explicit token-based provider resolution and scopes
- `@konekti/http` owns request execution, binding, validation entrypoints, exceptions, and route metadata
- `@konekti/runtime` assembles config, DI, handler mapping, health/readiness, and adapter bootstrapping
- `@konekti/dto-validator` owns validation decorators and the validation engine
- `@konekti/jwt` owns token-core concerns
- `@konekti/passport` owns generic auth strategy registration and guard wiring
- `@konekti/openapi` reads route and DTO metadata to produce documents
- `@konekti/metrics` exposes Prometheus metrics through runtime-owned HTTP routes

## request execution path

The current runtime path is:

```text
bootstrap -> handler mapping -> app middleware -> route match -> module middleware -> guard -> interceptor -> DTO bind/validate -> controller -> response write
```

Concrete behavior lives in:

- `packages/http/src/dispatcher.ts`
- `packages/http/src/mapping.ts`
- `packages/runtime/src/application.test.ts`

## design stance

- explicit DI and stable metadata beat implicit magic
- package boundaries matter more than phase history
- starter apps should use runtime-owned bootstrap helpers rather than app-local infrastructure copies
- package READMEs own package truth; `docs/` owns cross-package truth
