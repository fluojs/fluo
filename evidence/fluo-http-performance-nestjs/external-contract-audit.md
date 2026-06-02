# External Contract Audit

Date: 2026-06-02

## Scope Reviewed

Packages touched:
- `@fluojs/http`
- `@fluojs/platform-fastify`
- `@fluojs/di`
- benchmark-only tooling under `tooling/benchmarks/http-comparison`

Public package export maps reviewed:
- `packages/http/package.json`
- `packages/platform-fastify/package.json`
- `packages/di/package.json`
- `packages/runtime/package.json`

Public surface tests run:
- `pnpm exec vitest run packages/http/src/public-api.test.ts`
- `pnpm exec vitest run packages/runtime/src/public-surface.test.ts`

Package tests run for touched behavior:
- `pnpm exec vitest run packages/platform-fastify/src/adapter.test.ts`
- `pnpm exec vitest run packages/di/src/container.test.ts packages/runtime/src/module-graph.test.ts`

## Findings

No public export map was changed.

No public adapter factory or bootstrap function signature was changed:
- `createFastifyAdapter(...)`
- `bootstrapFastifyApplication(...)`
- `runFastifyApplication(...)`

No public DI method semantics were changed:
- `Container.register(...)`
- `Container.override(...)`
- `Container.resolve(...)`
- `Container.hasRequestScopedDependency(...)`
- `Container.createRequestScope(...)`
- `Container.dispose(...)`

No documented HTTP response/error behavior was intentionally changed:
- Fastify response serialization tests passed.
- Not-found curl evidence remained valid.
- Multipart and raw-body fallback tests passed.
- Params containing `/` stay on the fallback dispatch path.

Internal-only changes:
- HTTP dispatcher fast-path execution avoids unnecessary async wrapping when the handler path is synchronous.
- Fastify native route metadata and request URL/param fallback handling moved into a private `native-route.ts` helper.
- DI caches resolved singleton multi-provider token lists internally while returning fresh arrays to callers.

## Release Readiness

Changesets added:
- `.changeset/fast-path-stats-benchmark-evidence.md`
- `.changeset/reduce-dispatch-fast-path-overhead.md`
- `.changeset/streamline-fastify-native-routes.md`
- `.changeset/improve-di-multi-provider-cache.md`

Conclusion: external public contracts are preserved for the measured changes. Final performance claims remain blocked on Task 7 repeated same-environment benchmark evidence.
