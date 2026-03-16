# architecture overview

`konekti` keeps the public surface intentionally narrow and layers runtime behavior behind stable decorators and official packages.

## public package families

- `@konekti/core`
- `@konekti/config`
- `@konekti/http`
- `@konekti/dto-validator`
- `@konekti/jwt`
- `@konekti/openapi`
- `@konekti/metrics`
- `@konekti/passport`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/testing`
- `@konekti/cli`

The current release direction treats `@konekti/di`, `@konekti/dto-validator`, and `@konekti/runtime` as public support packages rather than leaking `@konekti-internal/*` names into generated app code.

## request execution path

The generated app and runtime tests follow this flow:

`bootstrapApplication -> handler mapping -> dispatcher -> binder -> dto-validator -> middleware -> guard -> interceptor -> controller`

Concrete evidence lives in:

- `packages/http/src/dispatcher.ts`
- `packages/http/src/dispatcher.test.ts`
- `packages/runtime/src/application.test.ts`
- `packages/prisma/src/vertical-slice.test.ts`

## data and auth stance

- repository generation stays generic-first and persistence-agnostic
- JWT token-core behavior belongs to `@konekti/jwt`
- OpenAPI document generation and metadata-only decorators belong to `@konekti/openapi`
- Prometheus scrape exposure belongs to `@konekti/metrics`
- strategy registry and auth metadata belong to `@konekti/passport`
- request-scoped transactions remain opt-in integration behavior, not a default service rule
- DTO binding belongs to `@konekti/http`, while DTO validation decorators and the validation engine belong to `@konekti/dto-validator`

## examples

- `docs/phase-3-reference-slice.md` captures the current reference slice baseline
- `src/examples/user.repo.ts` is the generated repository example in scaffolded starter projects
