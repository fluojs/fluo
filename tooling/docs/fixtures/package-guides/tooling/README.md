# Package Guides: Tooling Fixtures (react, cli, studio, testing, vite)

Executable evidence for the five tooling package guides. Every test imports
public package names (`@fluojs/react`, `@fluojs/react/typegen`, `@fluojs/http`,
`@fluojs/core`, `@fluojs/testing`, `@fluojs/testing/mock`, `@fluojs/studio`,
`@fluojs/vite`, `@fluojs/cli`) exactly as the guides instruct. Under the root
vitest workspace these names resolve through source aliases; under
`tsconfig.tools.json` root imports resolve through the published `dist`
declarations (see the known subpath-mapping gap below).

The react fixture deliberately does **not** import `react` directly: the
`react`/`react-dom` peers are not resolvable from `tooling/**` (they exist only
inside `packages/react` and `packages/studio` dependency contexts), so the
react fixture covers the runtime-neutral seams (metadata, module registration,
page catalog, typegen) and leaves direct SSR execution to `packages/react`'s
own suite (`src/dispatcher-ssr.test.ts`) and `examples/react-stable-ssr`.

## File manifest

| Directory | Files | Proves |
| --- | --- | --- |
| `react/` | `react.test.ts` | `@Router`/`@Path` write HTTP-equivalent controller/`GET` metadata plus React markers (empty-path defaults included), `ReactModule.forRoot` registers routers through ordinary module metadata and exports `REACT_PAGE_RENDERER` when `renderPage` is configured, `createReactPageCatalog` projects only React pages from `createHandlerMapping` descriptors, deterministic path-only `generateReactPageTypes` output with `inspectReactPageTypeArtifact` = `valid` v1, and typed `ReactPageTypegenError` (`react-page-typegen-versioned-route-unsupported`) for versioned catalog entries |
| `cli/` | `cli.test.ts` | Programmatic `runGenerateCommand` dry-run plan without writes, files-only `module` generator vs auto-registered `service` generator (`moduleRegistered`, `modulePath`, module file rewritten with the import + `UserService` registration), and `--with-slice-test` emitting a `*.slice.test.ts` that calls `Test.createTestingModule` |
| `studio/` | `studio.test.ts` | `parseStudioPayload` static snapshot/report parsing with route normalization (`react-page` kind preserved, legacy `kind` -> `http`, `params` -> `[]`, `graphNodeId` derivation), report artifact summary/timing, unsupported timing phase rejection, non-mutating `applyFilters`, deterministic `renderMermaid` across JSON round-trips, live request trace acceptance and body-like field rejection (`body`/`headers`/`payload`/`rawBody`/`requestBody`/`responseBody`), `isStudioLiveEvent` guard, and non-string route kind rejection |
| `testing/` | `app.ts`, `testing.test.ts` | `Test.createTestingModule` overrides (`useValue`, `useFactory`) before compilation, `overrideModule` swapping resolution while preserving `rootModule` and compiled `modules[].type` identity (fake `StripeClient` becomes resolvable and `BillingService.charge()` returns the fake), real request pipeline via `Test.createApp` (string body + cookies object overload), and `@fluojs/testing/mock` helpers (`ShallowMock` with strict rejection, `PrototypeMock` spies without constructors, `mockToken` shape, `asMock` over a real `vi.fn`) |
| `vite/` | `run-transform.ts`, `vite.test.ts` | `fluoDecoratorsPlugin` identity (`fluo-babel-decorators`, `enforce: 'pre'`), decorated application `.ts` transforms with `@fluojs/core/metadata-preload` injected and decorator syntax removed, decorator-free modules without the preload, application-boundary skips (`.test.ts`, `.d.ts`, `node_modules`, `.js`), and the `transformBoundary: 'test'` mode including test modules while still skipping declarations |
| `composition/` | `contract.ts`, `app.ts`, `composition.test.ts` | All five packages in one application: a `publicToken` alias (`CATALOG_VIEW`) served by both an ordinary `@Controller` and a `@Router` React page handler through `Test.createApp` (plain-value page handlers keep the HTTP path), the React page catalog feeding `generateReactPageTypes` (`valid` v1 artifact), Studio parsing the composed routes with normalized kinds, and the fluo Vite transform compiling the composition app's own decorators |

## Behavior contract asserted

- React page handlers are HTTP handlers: matching, DTO binding
  (`@RequestDto` + `@FromPath`), and response writing come from
  `@fluojs/http`; non-element returns never reach a page renderer.
- `ReactModule.forRoot(...)` output is ordinary module metadata readable with
  `@fluojs/testing` introspection helpers.
- CLI generation is idempotent file planning: dry-run plans never write;
  auto-registration rewrites the module file only when content changes.
- Studio never retains body-like request fields and preserves route kind
  strings end-to-end; parsed output is normalized while raw JSON echoes back.
- Testing overrides compose before compilation and `overrideModule` keeps
  authored module identity for diagnostics and introspection.
- The decorator transform is a pre-stage, boundary-scoped, lazy-Babel seam
  that preloads `@fluojs/core/metadata-preload` only when decorator syntax
  exists.

All tests are deterministic: no sleeps, no polling, event/state assertions
only; every app, module, and temp directory is closed or removed in `finally`.

## Verification

Commands run from the worktree root (`docs-foundation` @ `e0c73126e`):

1. Tests:
   `pnpm vitest run --project tooling tooling/docs/fixtures/package-guides/tooling --maxWorkers=1`
   -> `Test Files 6 passed (6)`, `Tests 33 passed (33)`.
2. Typecheck: `npx tsc -p tsconfig.tools.json --noEmit` -> exit 2 with 8 total
   errors. In this fixture directory: 3 x `TS2307` for the subpath imports
   `@fluojs/react/typegen` (`react/react.test.ts`,
   `composition/composition.test.ts`) and `@fluojs/testing/mock`
   (`testing/testing.test.ts`), plus 2 downstream `TS18046`
   (`error is of type 'unknown'`) in `react/react.test.ts` that disappear once
   the `@fluojs/react/typegen` module resolves. The imports are correct per
   each package's published `package.json` `exports`
   (`./typegen` -> `dist/typegen.d.ts`, `./mock` -> `dist/mock.d.ts`; both
   files exist), so the failures are the lead-owned catch-all `paths` mapping
   in `tsconfig.tools.json`
   (`"@fluojs/*": ["./packages/*/dist/index.d.ts"]`), which does not cover
   package subpaths — the same class as the `@fluojs/i18n/*` gap the lead
   already fixed. No suppression is used. The remaining 3 errors are
   pre-existing in `tooling/docs/fixtures/package-guides/async-work` and
   `/transports` (other workstreams' subpath imports) and outside this track.
3. Lint: `npx biome check tooling/docs/fixtures/package-guides/tooling`
   -> clean (after `biome check --write` fixed import order in 2 files).
4. LSP diagnostics on the fixture directory -> 10 files scanned, 0 errors.

## Source and API references

- `@fluojs/react`: `ReactModule.forRoot` options and renderer registration
  (`packages/react/src/module.ts`), `@Router`/`@Path` metadata writers
  (`packages/react/src/decorators.ts`), `createReactPageCatalog`
  (`packages/react/src/page-catalog.ts`), typegen artifact contract
  (`packages/react/src/typegen.ts`, `packages/react/src/typegen-artifact.ts`),
  root exports (`packages/react/src/index.ts`), README
  (`packages/react/README.md`).
- `@fluojs/cli`: public API barrel (`packages/cli/src/index.ts`),
  `runGenerateCommand` and `GenerateResult`
  (`packages/cli/src/generate-command.ts`, `packages/cli/src/generator-types.ts`,
  `packages/cli/src/public-generate.ts`), `runTypegenCommand`/
  `TYPEGEN_EXIT_CODES` (`packages/cli/src/public-typegen.ts`), README
  (`packages/cli/README.md`).
- `@fluojs/studio`: helper barrel (`packages/studio/src/index.ts`), static +
  live parsing/validation/filter/Mermaid contracts
  (`packages/studio/src/contracts.ts`), README (`packages/studio/README.md`).
- `@fluojs/testing`: `Test` facade and builder
  (`packages/testing/src/module.ts`, `packages/testing/src/types.ts`),
  request builder (`packages/testing/src/http.ts`), mock helpers
  (`packages/testing/src/mock.ts`), root exports
  (`packages/testing/src/index.ts`), README (`packages/testing/README.md`).
- `@fluojs/vite`: plugin options/transform
  (`packages/vite/src/decorators-plugin.ts`, `packages/vite/src/index.ts`),
  package-owned transform test seam mirrored by `vite/run-transform.ts`
  (`packages/vite/src/index.test.ts`), README (`packages/vite/README.md`).

## Unexecuted scope (not claimed)

- **React SSR through the dispatcher, client navigation, experimental RSC and
  Server Functions, `@fluojs/react/vite` manifest parsing, render policy
  decorator composition**: not executed in this fixture (react peer not
  resolvable from `tooling/**`; no Vite build assets; browser surfaces).
  Upstream executed evidence: `packages/react/src/dispatcher-ssr.test.ts`,
  `packages/react/src/render-policy.test.ts`,
  `packages/react/src/experimental/*`, `examples/react-stable-ssr/`,
  `examples/react-vite-ssr/`.
- **CLI end-to-end commands** (`runCli`, `runNewCommand`,
  `runInspectCommand`, `runTypegenCommand`, `fluo dev --studio`, `fluo
  migrate`): not executed here because their module loading resolves
  `@fluojs/*` through real Node resolution, which the tooling fixture
  workspace cannot provide outside the vitest aliases. Upstream executed
  evidence: `packages/cli/src/new/scaffold.test.ts`,
  `packages/cli/src/public-api.test.ts`, `packages/cli/src/cli-lazy-boundary.test.ts`.
- **Studio live sidecar/SSE transport and the packaged browser viewer**:
  covered upstream by `packages/studio/src/viewer-server.test.ts`,
  `packages/studio/tests/installed-viewer.spec.ts`. The snapshot used here is
  contract-shaped fixture data, not a real `fluo inspect` artifact.
- **Testing conformance/portability harness subpaths** (`platform-conformance`,
  `http-adapter-portability`, ...): platform-author surface, exercised
  upstream in `packages/testing/src/conformance/` and
  `packages/testing/src/portability/`.
- **Vite end-to-end `vite build` and the missing-Babel-peer diagnostic
  branch**: covered upstream by the workspace Vite 8.2.2 integration gate and
  `packages/vite/src/index.test.ts` (mocked Babel importer). Babel is
  installed in this workspace, so the diagnostic path was not triggered here.
