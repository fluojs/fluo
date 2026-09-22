# Package Guides: Foundation Fixtures (core, di, runtime, config, i18n)

Executable evidence for the five foundation package guides. Every test imports
public package names (`@fluojs/core`, `@fluojs/di`, `@fluojs/runtime`,
`@fluojs/config`, `@fluojs/i18n`, `@fluojs/i18n/loaders/fs`, `@fluojs/i18n/http`,
`@fluojs/testing`) exactly as the guides instruct. Under the root vitest
workspace these names resolve through source aliases; under
`tsconfig.tools.json` they resolve through the published `dist` declarations.

The `core/` fixture files are the same code the guide shows as its canonical
example (`posts.contract.ts`, `posts.service.ts`, `posts.module.ts`).

## File manifest

| Directory | Files | Proves |
| --- | --- | --- |
| `core/` | `posts.contract.ts`, `posts.service.ts`, `posts.module.ts`, `core.test.ts` | `@Module`/`@Inject`/`@Scope` metadata through `getModuleMetadata` (frozen snapshots), stacked `@Module` merge, `publicToken` = `Symbol.for` identity, removed array-form `Inject` rejected with `TypeError`, contract-token alias resolution through `@fluojs/di` |
| `di/` | `di.test.ts` | Standalone `Container`: register/resolve/dispose, `DuplicateProviderError`, atomic `override` with stale-instance disposal, multi-provider ordering, `RequestScopeResolutionError` / `ScopeMismatchError`, `hasRequestScopedDependency`, `ForwardRef`/`Optional` wrappers, reverse-creation disposal order, failed-`onDestroy` retry with exactly-once success |
| `runtime/` | `lifecycle.module.ts`, `runtime.test.ts` | `createApplicationContext` startup/shutdown hook ordering (init -> bootstrap, reversed destroy -> shutdown in reverse provider order), `Test.createApp` with `HealthModule.forRoot()` (`/health` 200, `/ready` 200 after bootstrap, failing readiness check -> 503 `unavailable`), terminal `context.get()` rejection after `close()` |
| `config/` | `config.test.ts` | `ConfigModule.load` precedence (`runtimeOverrides` > `processEnv` > env files > `defaults`) with deep-merged objects and wholesale-replaced arrays, synchronous Standard Schema validation (`INVALID_CONFIG`), `forRoot` + `ConfigService` dot-path access with detached clones and `CONFIG_KEY_MISSING`, standalone `ConfigReloadManager` manual reload, listener-failure rollback, terminal `close()` |
| `i18n/` | `locales/en/common.json`, `locales/ko/common.json`, `i18n.test.ts` | Deterministic fallback chain (locale -> fallback chain -> `defaultLocale` -> `defaultValue` -> `missingMessage` -> `I18N_MISSING_MESSAGE`), namespace prefixing, `I18N_INVALID_OPTIONS` for unsupported locale, catalogs detached from caller mutations, `FileSystemI18nLoader` layout + `I18N_MISSING_CATALOG` / `I18N_INVALID_LOADER_OPTIONS`, HTTP `Accept-Language` binding through a real test app (regional range normalization) |
| `composition/` | `contract.ts`, `app.ts`, `composition.test.ts` | All five packages in one application: `defineModule` metadata, validated config snapshot -> DI factory provider -> typed `publicToken`, controller resolving the request locale through `@fluojs/i18n/http` and translating with `I18nService` |

## Behavior contract asserted

- Startup hooks run provider-ordered `onModuleInit` then `onApplicationBootstrap`;
  shutdown runs `onModuleDestroy` then `onApplicationShutdown` in reverse
  provider order (`lifecycle.module.ts` records the exact sequence).
- `/ready` answers `503 { status: 'starting' }` before bootstrap completes and
  `503 { status: 'unavailable' }` while a readiness check fails.
- Config reload preserves `ConfigService` identity; a throwing reload listener
  rolls the snapshot back to the last committed value and rethrows.
- Config object reads are detached clones; mutating a returned object does not
  change the active snapshot.
- i18n locale validation rejects unsupported locales with `I18N_INVALID_OPTIONS`
  instead of silently falling back; `defaultValue` is consulted before the
  missing-message hook.
- Container disposal tears down dependents before dependencies; a failed
  `onDestroy` is retried exactly once more by a later `dispose()`, and hooks
  that succeeded never run again.

All tests are deterministic: no sleeps, no watch-mode polling (config reload is
exercised through the manual `reload()` path), event/state assertions only, and
every app, context, container, and manager is closed or disposed in `finally`.

## Verification

Commands run from the worktree root (`docs-foundation` @ `e0c73126e`):

1. Tests:
   `pnpm vitest run --project tooling tooling/docs/fixtures/package-guides/foundation --maxWorkers=1`
   -> `Test Files 6 passed (6)`, `Tests 29 passed (29)`.
2. Typecheck:
   `npx tsc -p tsconfig.tools.json --noEmit`
   -> 15 total errors, of which 3 are in this fixture directory: `TS2307`
   Cannot find module `@fluojs/i18n/http` / `@fluojs/i18n/loaders/fs`. The
   catch-all `paths` mapping `"@fluojs/*": ["./packages/*/dist/index.d.ts"]` in
   the lead-owned `tsconfig.tools.json` does not cover package subpaths, so
   subpath type declarations cannot resolve for any tooling consumer (same
   class as the pre-existing errors in `tooling/realtime-native/fixtures`).
   No suppression is used; the imports are correct per each package's
   `package.json` `exports` (verified below). The 12 remaining errors are
   pre-existing and outside this track.
3. Lint: `npx biome check tooling/docs/fixtures/package-guides/foundation`
   -> clean (after `biome check --write` fixed import order and one
   type-only import in 4 files).
4. LSP diagnostics on the fixture directory -> 12 files scanned, 0 errors.

## Source and API references

- `@fluojs/core`: `Module`, `Inject`, `Scope` (`packages/core/src/decorators.ts`),
  `publicToken` (`packages/core/src/public-token.ts`), `getModuleMetadata`
  (`packages/core/src/metadata/module.ts`), exports
  (`packages/core/src/index.ts`), README (`packages/core/README.md`).
- `@fluojs/di`: `Container`, provider types, `ForwardRef`, `Optional`,
  `Disposable` (`packages/di/src/container.ts`, `packages/di/src/types.ts`),
  error classes (`packages/di/src/errors.ts`), README (`packages/di/README.md`).
- `@fluojs/runtime`: `FluoFactory.create` / `createApplicationContext`
  (`packages/runtime/src/bootstrap.ts`), lifecycle types and
  `ApplicationContext` gate (`packages/runtime/src/types.ts`),
  `HealthModule.forRoot` (`packages/runtime/src/health/health.ts`),
  `defineModule` (`packages/runtime/src/module-definition.ts`),
  graph validation (`packages/runtime/src/module-graph.ts`), README
  (`packages/runtime/README.md`).
- `@fluojs/config`: `ConfigModule.forRoot`/`load`, `ConfigReloadManager`,
  `CONFIG_RELOADER` (`packages/config/src/module.ts`), `ConfigService`
  (`packages/config/src/service.ts`), merge/validation
  (`packages/config/src/load.ts`), option snapshotting
  (`packages/config/src/options.ts`), types (`packages/config/src/types.ts`),
  README (`packages/config/README.md`).
- `@fluojs/i18n`: `I18nModule` (`packages/i18n/src/module.ts`),
  `I18nService` lookup chain and interpolation (`packages/i18n/src/service.ts`),
  option/catalog snapshots (`packages/i18n/src/options.ts`),
  `resolveHttpLocale` (`packages/i18n/src/http.ts`),
  `FileSystemI18nLoader` (`packages/i18n/src/loaders/fs.ts`), error codes and
  types (`packages/i18n/src/types.ts`), README (`packages/i18n/README.md`).
- Subpath declarations: `packages/i18n/package.json` `exports` map
  (`./http`, `./loaders/fs`, `./icu`, ...).

## Unexecuted scope (not claimed)

- `@fluojs/i18n/icu`: the `intl-messageformat` optional peer is not installed
  at the repo root, so ICU behavior was not executed. The guide documents it
  from `packages/i18n/src/icu.ts` and the package README only.
- Zod example in the config guide: illustrative; zod is not installed at the
  repo root. The executed schema evidence uses an inline synchronous Standard
  Schema validator (the same protocol `@standard-schema/spec` defines).
- Config watch mode (FSWatcher events) was not exercised; reload correctness is
  proven through the deterministic manual `reload()` path, and watch semantics
  are cited from `packages/config/src/load.ts` and the README contract.
- No native external services are required by these five packages; none were
  used. (Docker-backed fixture infrastructure applies to other packages.)
- Vitest resolves `@fluojs/*` through source aliases, so the test run proves
  current-source behavior, not published-package compatibility; type-level
  resolution went through `packages/*/dist` declarations where
  `tsconfig.tools.json` permitted.
- Runtime adapter specifics (`NodeHttpApplicationAdapter`, `EADDRINUSE` retry,
  signal registration) are documented from `@fluojs/platform-nodejs` sources
  and contracts but not executed here; the fixture surface is the portable
  dispatcher via `Test.createApp` and `createApplicationContext`.
