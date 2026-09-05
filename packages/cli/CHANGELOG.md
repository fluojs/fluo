# @fluojs/cli

## [Unreleased]

## 3.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3603](https://github.com/fluojs/fluo/pull/3603) [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976) Thanks [@ayden94](https://github.com/ayden94)! - **Breaking change:** Node response `send()` now rejects when compression fails before the
  response commits. Dispatcher-managed requests recover with the standard JSON 500 envelope.

  Migration: Await and handle Node response `send()` rejections in adapter integrations. The
  fallback removes only the adapter-assigned default `Content-Type`, so its JSON envelope uses
  `application/json`; application-owned explicit `Content-Type` values remain unchanged.
  Node integration packages own their Node support contract; the portable runtime root has no package-wide Node engine. Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

- [#3514](https://github.com/fluojs/fluo/pull/3514) [`6bc1b0d`](https://github.com/fluojs/fluo/commit/6bc1b0db270ac4933b8a6b8a67e7acd853188744) Thanks [@ayden94](https://github.com/ayden94)! - `fluo migrate` now preserves Nest bootstrap by default. If you relied on the former automatic Express bootstrap transform, rerun with `--platform express`. That automatic path supports only one numeric-literal single-argument `listen(port)`; host, callback, string, environment-derived, and multiple-listen shapes remain preserved for manual migration.

- [#3078](https://github.com/fluojs/fluo/pull/3078) [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317) Thanks [@ayden94](https://github.com/ayden94)! - Add validated uppercase custom HTTP route authoring with `Route(method, path)` and first-class RFC `Query(path)` support while preserving exact-method precedence, versioning, DTO validation, and default response semantics.

  Widen the internal route metadata method declaration so HTTP integrations can carry custom tokens, keep custom methods on Bun fetch fallback, and let Fastify wildcard fallback receive registered custom method names without creating native fluo route handoffs.

  Expose shared network and fetch-style portability assertions for body-bearing `QUERY` and extension-method routes across supported adapters.

  Require Node.js `>=24.0.0 <27` for published Node listener paths and generated Node HTTP starters so RFC `QUERY` reaches framework dispatch. This final coordinated-release policy supersedes the earlier listener-only Node floor. Bun and Deno fetch-style adapter contracts are unchanged. Cloudflare Workers' documented fetch-style contract includes body-bearing `QUERY` and extension-method dispatch through its Worker fetch handler.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Regenerated Node HTTP projects use the same Node support range. Custom-method and portability additions remain part of this one upcoming release per package.

### Minor Changes

- [#2852](https://github.com/fluojs/fluo/pull/2852) [`d2b1bc6`](https://github.com/fluojs/fluo/commit/d2b1bc6eb48e767578b887bbe35464826fbae84e) Thanks [@ayden94](https://github.com/ayden94)! - Add the official `fluo new --starter react-vite-ssr` application with explicit Vite client/server builds, HTTP-owned React pages, manifest-fed hydration, full-document navigation, and generated SSR, hydration, and production browser tests.

- [#3623](https://github.com/fluojs/fluo/pull/3623) [`09dece4`](https://github.com/fluojs/fluo/commit/09dece48a2fa94fcc3b59c17637cf36432309ed0) Thanks [@ayden94](https://github.com/ayden94)! - Add live `fluo dev --studio` support for Node dev-runner projects and clear Bun project error guidance to export Studio-compatible artifacts with `fluo inspect`.

- [#3632](https://github.com/fluojs/fluo/pull/3632) [`e58d3f4`](https://github.com/fluojs/fluo/commit/e58d3f4513a2b6dcaa8878a8c38755d02ead963e) Thanks [@ayden94](https://github.com/ayden94)! - Add the public `fluo inspect --format json` option as an explicit equivalent of `--json`, keeping stdout parseable as one JSON document while runtime diagnostics are written to stderr.

- [#3697](https://github.com/fluojs/fluo/pull/3697) [`a39f7b8`](https://github.com/fluojs/fluo/commit/a39f7b847095c5cc05f16a866e0649a1a0191ce4) Thanks [@ayden94](https://github.com/ayden94)! - Generate new non-Deno projects with Vite ^8.2.2, Vitest ^4.1.11, and matching @vitest/coverage-v8 ^4.1.11. Generated ESM Vite configs use Rolldown options while retaining the Babel application decorator plugin and the separate Vitest testing transform. React SSR keeps decorated declarations in .ts files and JSX in .tsx files.

  Existing projects are not rewritten. When adopting the new generated toolchain, update the three dependency ranges together, rename build.rollupOptions to build.rolldownOptions, and retain fluoDecoratorsPlugin() and fluoBabelDecoratorsPlugin(); direct Oxc/esbuild decorator processing is unsupported. Remove the generated Babel ignore rule for src/\*_/_.test.ts so the testing plugin can transform decorators declared inside tests instead of leaving them to the default compiler. The Node.js >=24.0.0 <27 policy and Bun/Deno/Workers runtime metadata are unchanged.

  The @fluojs/vite patch updates its shipped README pair to distinguish the generated Vite 8/Vitest 4 baseline from its unchanged Vite >=6.2.0 peer range. It does not change the plugin API or transform behavior.

- [#2851](https://github.com/fluojs/fluo/pull/2851) [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2) Thanks [@ayden94](https://github.com/ayden94)! - Add immutable React page catalogs and expose compiled route kinds, effective paths, versions, and parameter names through runtime inspection, `fluo inspect`, and Studio diagnostics.

- [#2853](https://github.com/fluojs/fluo/pull/2853) [`44cb5e9`](https://github.com/fluojs/fluo/commit/44cb5e928bb634c91cfbd376fd9b5f3d2f07f753) Thanks [@ayden94](https://github.com/ayden94)! - Add deterministic path-only React page type generation with typed absolute href builders through `@fluojs/react/typegen` and `fluo typegen`.

- [#2859](https://github.com/fluojs/fluo/pull/2859) [`edf47a1`](https://github.com/fluojs/fluo/commit/edf47a1aafb764a82d5eb1b401bc8590685c1678) Thanks [@ayden94](https://github.com/ayden94)! - Generate route-bound real-anchor props and typed `push`/`replace` methods so React page ids and exact path params stay visible through declarative and programmatic HTTP-first navigation.

- [#2895](https://github.com/fluojs/fluo/pull/2895) [`26b5b75`](https://github.com/fluojs/fluo/commit/26b5b75c2c8e50529680c50fa83bf228d88ff0e0) Thanks [@ayden94](https://github.com/ayden94)! - Simplify the generated React SSR + Vite starter so the first editable page is isolated from manifest, renderer, document, route-snapshot, and hydration wiring while preserving explicit HTTP routes and replaceable application-owned server/client composition.

- [#2900](https://github.com/fluojs/fluo/pull/2900) [`ca5fb8d`](https://github.com/fluojs/fluo/commit/ca5fb8dc19da0703022d33eb07a4b8ec08bd2824) Thanks [@ayden94](https://github.com/ayden94)! - Add deterministic React typegen check and watch workflows with versioned artifact diagnostics, atomic writes, stable exit codes, and a documented consumer testing loop.

- [#3507](https://github.com/fluojs/fluo/pull/3507) [`c6cc61b`](https://github.com/fluojs/fluo/commit/c6cc61b6d77685c221961f0b17bc383a745beb6f) Thanks [@ayden94](https://github.com/ayden94)! - Keep React SSR + Vite starter decorator declarations in `src/app.ts` so generated projects stay within the supported `@fluojs/vite` transform boundary while JSX remains in `.tsx` modules.

### Patch Changes

- [#3506](https://github.com/fluojs/fluo/pull/3506) [`4663c12`](https://github.com/fluojs/fluo/commit/4663c12314606ff80558f34b48a21f0daa67c33d) Thanks [@ayden94](https://github.com/ayden94)! - Accept the documented `inject-params` and `tests` migration transform tokens, while retaining `injectable` and `testing` as aliases.

- [#2929](https://github.com/fluojs/fluo/pull/2929) [`1bca3e9`](https://github.com/fluojs/fluo/commit/1bca3e994fa4123c325a04bc21e68ffa6f4b1808) Thanks [@ayden94](https://github.com/ayden94)! - Bound Studio sidecar teardown by closing active authenticated ingestion sockets and sharing repeated close calls across one deterministic shutdown operation.

- [#3052](https://github.com/fluojs/fluo/pull/3052) [`cb57982`](https://github.com/fluojs/fluo/commit/cb57982dcc058f84b95e0be2de6686f3eabb811a) Thanks [@ayden94](https://github.com/ayden94)! - Route primary and fallback development watcher errors through the restart runner's bounded terminal cleanup so app children and sibling watchers are not left running.

- [#3624](https://github.com/fluojs/fluo/pull/3624) [`6bef167`](https://github.com/fluojs/fluo/commit/6bef167b5658cd2c2443c930c2af88f90a3ec2d1) Thanks [@ayden94](https://github.com/ayden94)! - Fail `fluo dev` with terminal cleanup and exit code `1` when the required source target is missing or becomes inaccessible before watcher registration, or recursive watching is unavailable and fallback traversal cannot establish required source coverage, including total acquisition failure, partial acquisition after sibling watchers succeed, and a directory discovered while fallback watching is active.

- [#3505](https://github.com/fluojs/fluo/pull/3505) [`ef68712`](https://github.com/fluojs/fluo/commit/ef6871261475ece4eece4ef1f32765ffd935a252) Thanks [@ayden94](https://github.com/ayden94)! - Generate the published `@fluojs/react` 0.1 range for the React SSR + Vite starter so registry installs resolve after Version Packages.

- [#3636](https://github.com/fluojs/fluo/pull/3636) [`e3c197f`](https://github.com/fluojs/fluo/commit/e3c197fc102b0f64a1d0e5f5e5f286b7fb0a7c77) Thanks [@ayden94](https://github.com/ayden94)! - Ensure `fluo typegen --watch` waits for caller-process generation bootstrap and application cleanup,
  as well as owned generation-child cancellation, before watch exit or stale artifact publication.

- [#3515](https://github.com/fluojs/fluo/pull/3515) [`ce42999`](https://github.com/fluojs/fluo/commit/ce42999945ce827f4cbddd45c96b6bcfa42d0c77) Thanks [@ayden94](https://github.com/ayden94)! - Preserve type-only imports when Nest migration adds the runtime `Inject` binding required by converted constructor metadata.

- [#3504](https://github.com/fluojs/fluo/pull/3504) [`06cf0d4`](https://github.com/fluojs/fluo/commit/06cf0d40e591e6fee38f15d7d1d1d3f100b06504) Thanks [@ayden94](https://github.com/ayden94)! - Preserve required type-only NestJS provider imports while removing obsolete runtime imports during migration.

- [#3646](https://github.com/fluojs/fluo/pull/3646) [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685) Thanks [@ayden94](https://github.com/ayden94)! - Lazy-load command handlers so commands unrelated to runtime inspection remain usable across the CLI's supported Node.js range.

- [#3646](https://github.com/fluojs/fluo/pull/3646) [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685) Thanks [@ayden94](https://github.com/ayden94)! - Resolve `@fluojs/runtime` from the inspected project's dependency tree at the `inspect` command boundary, preflight its availability before importing the application module, and preserve command-scoped missing-runtime guidance across the CLI's documented Node.js `>=20.0.0` range.

- [#3509](https://github.com/fluojs/fluo/pull/3509) [`5e9a563`](https://github.com/fluojs/fluo/commit/5e9a5636a5e071c24a172b27781ffa487cf76748) Thanks [@ayden94](https://github.com/ayden94)! - Preserve every NestJS constructor dependency when `fluo migrate` converts safe parameter-level `@Inject(...)` usage, and report unsupported constructor shapes without dropping dependencies.

- [#3635](https://github.com/fluojs/fluo/pull/3635) [`cc271d5`](https://github.com/fluojs/fluo/commit/cc271d53936ef0dad67efd227617188cb5dfec34) Thanks [@ayden94](https://github.com/ayden94)! - Reject inspect and typegen artifact outputs that identify the input application module.

- [#2776](https://github.com/fluojs/fluo/pull/2776) [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995) Thanks [@ayden94](https://github.com/ayden94)! - Raise the CLI and generated Node.js starter `tsx` floor to 4.23.1, and generate gRPC starters with `@grpc/grpc-js` 1.14.4 or newer. Refresh existing project lockfiles when adopting these patched toolchain floors.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- [#3621](https://github.com/fluojs/fluo/pull/3621) [`fa268f0`](https://github.com/fluojs/fluo/commit/fa268f01fbaab8242a0230ebdd2e20bf0128b4bc) Thanks [@ayden94](https://github.com/ayden94)! - Wait for captured dependency-install streams to close before reporting failures.

- Updated dependencies [[`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`0a18afc`](https://github.com/fluojs/fluo/commit/0a18afc70589c33fa7d0d4974336125f330cc07e), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`4772475`](https://github.com/fluojs/fluo/commit/4772475b02ce84ee7ad532581f5827383fdc5c1b), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`7e04a10`](https://github.com/fluojs/fluo/commit/7e04a106aec8e1ce2d722c2800c293a2d335102e), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`e33e11f`](https://github.com/fluojs/fluo/commit/e33e11f15d9fcfe19fb4b89637102bc022885f8e), [`ad48313`](https://github.com/fluojs/fluo/commit/ad4831301994dd61c0b01e409424b889db8d2db2), [`c9de01b`](https://github.com/fluojs/fluo/commit/c9de01b9c896657581d40e575339bcd0e6600fc0), [`a981ca4`](https://github.com/fluojs/fluo/commit/a981ca40c51ab6ba5b57d47a9e3c5e33d6dc2c9a), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`93e91a6`](https://github.com/fluojs/fluo/commit/93e91a6fd9625fbc62212b443f7ac38fe06f00ff), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`482af10`](https://github.com/fluojs/fluo/commit/482af10b73f50ffa08953782450729db15f2a86b), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`29437ff`](https://github.com/fluojs/fluo/commit/29437ffc91db6f1d904b15bdce5c3236fa6f100e), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c)]:
  - @fluojs/runtime@3.0.0
  - @fluojs/studio@2.0.0

## 2.0.1

### Patch Changes

- [#2761](https://github.com/fluojs/fluo/pull/2761) [`a88152c`](https://github.com/fluojs/fluo/commit/a88152c18378a9016fba505b90de4975a1c0d260) Thanks [@ayden94](https://github.com/ayden94)! - Settle Studio sidecar ingestion when a local client closes the socket after sending only a partial request body. The sidecar now binds request `close`/`error` events to body-reader cancellation and sends a bounded error completion instead of hanging indefinitely on a malformed local client.

- Updated dependencies [[`65cc3a2`](https://github.com/fluojs/fluo/commit/65cc3a28457d58b75858ed33ab7280b09900db36)]:
  - @fluojs/runtime@2.0.1

## 2.0.0

### Major Changes

- [#2465](https://github.com/fluojs/fluo/pull/2465) [`5f29631`](https://github.com/fluojs/fluo/commit/5f296312efa63bbf98da01f1e0dc6b1004d05586) Thanks [@ayden94](https://github.com/ayden94)! - Remove monorepo-local starter dependency overrides from the documented `NewCommandRuntimeOptions` public type while keeping the sandbox harness behavior internal to the CLI implementation.

### Patch Changes

- [#2690](https://github.com/fluojs/fluo/pull/2690) [`36f9832`](https://github.com/fluojs/fluo/commit/36f983257be5ebc069077b05a09010468c599b7c) Thanks [@ayden94](https://github.com/ayden94)! - Ensure generated NATS, Kafka, and RabbitMQ starters release owned broker clients when shutdown or partial initialization fails.

- [#2376](https://github.com/fluojs/fluo/pull/2376) [`139be9b`](https://github.com/fluojs/fluo/commit/139be9bc0ac3910279a5bdc7cb7a79529a065437) Thanks [@ayden94](https://github.com/ayden94)! - Harden generated broker transport lazy initialization so overlapping first lifecycle calls share one tracked setup, with Studio sidecar auth/privacy and generated test cleanup regressions covered.

- [#2333](https://github.com/fluojs/fluo/pull/2333) [`49b8c17`](https://github.com/fluojs/fluo/commit/49b8c175fb555fc9391714667151c88b96f3ff43) Thanks [@ayden94](https://github.com/ayden94)! - Preserve the CLI root entrypoint lazy-loading boundary and avoid loading the optional Studio sidecar unless `fluo dev --studio` actually starts it.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925)]:
  - @fluojs/runtime@2.0.0

## 1.1.0

### Minor Changes

- [#2116](https://github.com/fluojs/fluo/pull/2116) [`78b5ab0`](https://github.com/fluojs/fluo/commit/78b5ab0d0c2d9ea2057a02682b2c2c6a9202f624) Thanks [@ayden94](https://github.com/ayden94)! - Expose the CLI generator and inspect programmatic APIs from the root package entrypoint, including generator result/plan types and middleware module registration metadata.

### Patch Changes

- [#2160](https://github.com/fluojs/fluo/pull/2160) [`2873577`](https://github.com/fluojs/fluo/commit/2873577f3f40acdc160b93a5ee8dc3448d5811fe) Thanks [@ayden94](https://github.com/ayden94)! - Keep Studio dev-runner restarts aligned with the current sidecar epoch and lazy-load the full CLI dispatcher from the package root programmatic entrypoint.

- [#2225](https://github.com/fluojs/fluo/pull/2225) [`8979f7a`](https://github.com/fluojs/fluo/commit/8979f7acad128d6b3665685ddf3c1f4b4b0e7f59) Thanks [@ayden94](https://github.com/ayden94)! - Harden CLI Studio dev-runner contracts by rejecting native/raw-watch Studio combinations, preventing sidecar heartbeat timers from starting on listen failures, and routing fallback update-check prompts through injected IO streams.

- Updated dependencies [[`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/runtime@1.1.8

## 1.0.6

### Patch Changes

- [#2038](https://github.com/fluojs/fluo/pull/2038) [`4403acd`](https://github.com/fluojs/fluo/commit/4403acdf90ed3335895c4eb43a304161476cff57) Thanks [@ayden94](https://github.com/ayden94)! - Restore generated Node starter runtime log colors by using platform startup helpers and internalizing runtime logger selection instead of accepting logger overrides in app options.

- Updated dependencies [[`4403acd`](https://github.com/fluojs/fluo/commit/4403acdf90ed3335895c4eb43a304161476cff57)]:
  - @fluojs/runtime@1.1.5

## 1.0.5

### Patch Changes

- [#2032](https://github.com/fluojs/fluo/pull/2032) [`439d93e`](https://github.com/fluojs/fluo/commit/439d93eb1caa850574410811bac31e8668651192) Thanks [@ayden94](https://github.com/ayden94)! - Add the runtime-connected Studio devtool path with `fluo dev --studio`, a local sidecar live event bridge, runtime snapshot/request instrumentation, and a React/FSD Studio UI while preserving static report compatibility.

- Updated dependencies [[`439d93e`](https://github.com/fluojs/fluo/commit/439d93eb1caa850574410811bac31e8668651192)]:
  - @fluojs/runtime@1.1.3

## 1.0.4

### Patch Changes

- [#2006](https://github.com/fluojs/fluo/pull/2006) [`c0b88cc`](https://github.com/fluojs/fluo/commit/c0b88ccc012d5ff51c54938b70aa8bb9bca56145) Thanks [@ayden94](https://github.com/ayden94)! - Harden the development restart runner so child process spawn failures clean up watchers and resolve with a failure exit code.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.3

### Patch Changes

- [#1885](https://github.com/fluojs/fluo/pull/1885) [`acf0a8d`](https://github.com/fluojs/fluo/commit/acf0a8d5a0f881028caedf6f1001f1a1e89281f4) Thanks [@ayden94](https://github.com/ayden94)! - Align generated e2e test imports with the default `fluo new` starter root module at `src/app` while preserving explicit root module import overrides.

- [#1886](https://github.com/fluojs/fluo/pull/1886) [`66179a9`](https://github.com/fluojs/fluo/commit/66179a93827fb4af969f26cd2ee6747fa75657fa) Thanks [@ayden94](https://github.com/ayden94)! - Harden the fluo-owned dev restart runner fallback so platforms without recursive `fs.watch` still restart on nested source-tree changes.

- [#1884](https://github.com/fluojs/fluo/pull/1884) [`6f3fd14`](https://github.com/fluojs/fluo/commit/6f3fd142bde826706b6f6a458a7908b720646655) Thanks [@ayden94](https://github.com/ayden94)! - Keep generated NATS, Kafka, and RabbitMQ starters import-safe by lazily creating broker clients inside the Fluo-owned transport lifecycle instead of during module import.

- [#1887](https://github.com/fluojs/fluo/pull/1887) [`3a13112`](https://github.com/fluojs/fluo/commit/3a13112624e3f089197c97a501c72b1592a16d92) Thanks [@ayden94](https://github.com/ayden94)! - Preserve default JSON snapshot output when `fluo inspect --timing` is used without an explicit output mode, emitting the same `{ snapshot, timing }` envelope as `--json --timing`.

- [#1882](https://github.com/fluojs/fluo/pull/1882) [`c37a61a`](https://github.com/fluojs/fluo/commit/c37a61a9cdb12b02899de7ee18f42c5f109aa2b7) Thanks [@ayden94](https://github.com/ayden94)! - Support documented TypeScript source module paths in `fluo inspect` while preserving native `.js` and `.mjs` module loading.

- [#1888](https://github.com/fluojs/fluo/pull/1888) [`43b3072`](https://github.com/fluojs/fluo/commit/43b3072bfa0bacf37145bcf647c07f93c280b2a0) Thanks [@ayden94](https://github.com/ayden94)! - Skip the interactive CLI update check for pure help invocations and print `fluo help info` with info-branded usage text.

## 1.0.1

### Patch Changes

- [#1853](https://github.com/fluojs/fluo/pull/1853) [`010f5ac`](https://github.com/fluojs/fluo/commit/010f5ac256a65f616b39ff5fc6bad049b14efd8c) Thanks [@ayden94](https://github.com/ayden94)! - Keep generated starter CLI scripts aligned to the generator version and bound `fluo dev` restart shutdowns so non-cooperative child processes cannot hang restarts indefinitely.

- Updated dependencies [[`92636ee`](https://github.com/fluojs/fluo/commit/92636eee23991859a04f4590871179508dee12fb), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/studio@1.0.1
  - @fluojs/runtime@1.1.0

## 1.0.0

### Minor Changes

- 185487f: Expand CLI automation outputs for generation, inspection, migration, scaffolding, and generator metadata.

  Expose Studio-owned snapshot-to-Mermaid rendering helpers and platform snapshot types.

  Refresh the published Fastify adapter dependency metadata to fastify@^5.8.5.

- 45a84a8: Align generated project lifecycle scripts around `fluo dev`, `fluo build`, and `fluo start`, with CLI-owned runtime commands, project-local toolchain binary resolution, Workers preview-safe start behavior, and Next.js-like `NODE_ENV` defaults that preserve explicitly provided environment values.
- 6cb8d78: Add CLI roadmap command MVPs for version inspection, diagnostics, script orchestration, package workflow guidance, and composite resource generation.
- 922fa87: Update the CLI self-update flow to reuse the package manager that owns the current global install instead of always invoking pnpm.
- b6ab426: Add module slice-test, resource slice-test, and e2e test generators so generated projects can scaffold the canonical fluo TDD ladder with `createTestingModule({ rootModule })` and `createTestApp({ rootModule })`.
- f516e5f: Replace the generated starter-owned `src/health/*` example slice and `/health-info` route with a `src/greeting/*` feature slice exposed at `/greeting`. Runtime operational health remains owned by `HealthModule.forRoot(...)`, so new projects should treat `/health` and `/ready` as runtime endpoints and use the greeting slice as the starter application-structure example.
- 1b75835: Extract the generated Vite decorator transform into the new `@fluojs/vite` package so `fluo new` projects import a maintained plugin instead of copying the Babel implementation inline.
- f28a8c8: Add configurable runtime console logger modes and level filtering, and add CLI lifecycle reporter controls for quieter interactive dev output while preserving raw passthrough for CI and debugging.

### Patch Changes

- 6c877e2: Preserve Bun app terminal color detection when `fluo dev` or `fluo start` pipes child output through the CLI lifecycle reporter.
- e0427f6: Include Bun globals in generated Bun starter TypeScript configuration so pnpm typecheck succeeds when the starter references `Bun.env`.
- 292634e: Keep interactive `fluo dev` application output visible with an `app │` prefix so CLI lifecycle status and runtime logs remain easy to distinguish.
- 207de57: Preserve `runCli(...)` numeric exit-code behavior when lifecycle command spawning fails, and align CLI learning docs with the Node.js 20+ package baseline.
- ca1bbdd: Update generated `fluo new` starters to import `HealthModule` directly from `@fluojs/runtime`, call `HealthModule.forRoot()`, and omit explicit metadata symbol setup from the greeting controller scaffold.
- cf2be08: Generated starter e2e templates now use the application-level `app.request(...).send()` testing helper as the default HTTP request path.
- 0b0bb10: Refresh `fluo new` starter dependency pins to the latest published beta versions of the generated `@fluojs/*` packages.
- 2239996: Refresh the interactive CLI latest-version check for `fluo new` and `fluo create` before scaffolding while preserving cached update checks for normal commands.
- 2e3408f: Keep colorized application logs consistent between `fluo dev` and `fluo start` by preserving ANSI color intent through the CLI development reporter.
- 93fc34b: Add `HealthModule.forRoot(...)` as the application-facing runtime health facade and update generated starters to use it while preserving the deprecated `createHealthModule(...)` compatibility helper.
- c7a31c3: Preserve fluo application log colors when generated Bun, Deno, and Cloudflare Workers dev lifecycles run through the CLI reporter.
- 6adc9dc: Clarify generated Node.js starter logging defaults and point JSON-log opt-ins to the runtime logger factory.
- 9295ce5: Update generated Bun, Deno, and Cloudflare Workers starter lifecycles so `fluo dev` defaults to runtime-native watch loops with an explicit `--runner fluo` fallback, while production and deployment use runtime-native commands.
- fd0aeda: Normalize generated HTTP starter tests around colocated unit/slice coverage plus a dedicated `test/app.e2e.test.ts` suite, and expose `test:cov`/`test:e2e` scripts for Vitest-backed starters.
- 1f312e0: Add a fluo-owned Node dev restart runner that dedupes unchanged file saves before restart while preserving raw runtime watcher escape hatches. Config watch reloads now also skip unchanged env file saves and change-then-revert bursts before replacing the in-process snapshot.
- Updated dependencies [185487f]
- Updated dependencies [da003a1]
- Updated dependencies [1b0a68a]
- Updated dependencies [93fc34b]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [53a2b8e]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [b74832f]
- Updated dependencies [4333cee]
- Updated dependencies [f28a8c8]
- Updated dependencies [6b8e8a9]
- Updated dependencies [89f6379]
- Updated dependencies [f0dce1f]
- Updated dependencies [c509e27]
- Updated dependencies [c3ef937]
- Updated dependencies [69936b1]
- Updated dependencies [35f60fd]
- Updated dependencies [ec504ae]
- Updated dependencies [db1723c]
- Updated dependencies [3ccf4e1]
- Updated dependencies [d3504c6]
  - @fluojs/studio@1.0.0
  - @fluojs/runtime@1.0.0

## 1.0.0-beta.8

### Minor Changes

- [#1581](https://github.com/fluojs/fluo/pull/1581) [`b6ab426`](https://github.com/fluojs/fluo/commit/b6ab4260fd6b641d94eb144d771a5cac311d2de0) Thanks [@ayden94](https://github.com/ayden94)! - Add module slice-test, resource slice-test, and e2e test generators so generated projects can scaffold the canonical fluo TDD ladder with `createTestingModule({ rootModule })` and `createTestApp({ rootModule })`.

### Patch Changes

- [#1626](https://github.com/fluojs/fluo/pull/1626) [`207de57`](https://github.com/fluojs/fluo/commit/207de57ffb524d1a6150304030d50831f9085101) Thanks [@ayden94](https://github.com/ayden94)! - Preserve `runCli(...)` numeric exit-code behavior when lifecycle command spawning fails, and align CLI learning docs with the Node.js 20+ package baseline.

- [#1580](https://github.com/fluojs/fluo/pull/1580) [`cf2be08`](https://github.com/fluojs/fluo/commit/cf2be087c19465aa01ad4d58ecb6ffd6452eed25) Thanks [@ayden94](https://github.com/ayden94)! - Generated starter e2e templates now use the application-level `app.request(...).send()` testing helper as the default HTTP request path.

- [#1578](https://github.com/fluojs/fluo/pull/1578) [`fd0aeda`](https://github.com/fluojs/fluo/commit/fd0aedaf385e79bb1cefd0bd7e05d3d71a9509ef) Thanks [@ayden94](https://github.com/ayden94)! - Normalize generated HTTP starter tests around colocated unit/slice coverage plus a dedicated `test/app.e2e.test.ts` suite, and expose `test:cov`/`test:e2e` scripts for Vitest-backed starters.

- Updated dependencies [[`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`db1723c`](https://github.com/fluojs/fluo/commit/db1723cde769526a6ad73e19424fc78297ec745a), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/runtime@1.0.0-beta.12
  - @fluojs/studio@1.0.0-beta.4

## 1.0.0-beta.7

### Patch Changes

- [#1566](https://github.com/fluojs/fluo/pull/1566) [`6adc9dc`](https://github.com/fluojs/fluo/commit/6adc9dca23341bd97cc6c64aeb041c80f29f15dc) Thanks [@ayden94](https://github.com/ayden94)! - Clarify generated Node.js starter logging defaults and point JSON-log opt-ins to the runtime logger factory.

## 1.0.0-beta.6

### Minor Changes

- [#1556](https://github.com/fluojs/fluo/pull/1556) [`f516e5f`](https://github.com/fluojs/fluo/commit/f516e5f10dd6aaaf9a8cde44031f4eebd42d6fc5) Thanks [@ayden94](https://github.com/ayden94)! - Replace the generated starter-owned `src/health/*` example slice and `/health-info` route with a `src/greeting/*` feature slice exposed at `/greeting`. Runtime operational health remains owned by `HealthModule.forRoot(...)`, so new projects should treat `/health` and `/ready` as runtime endpoints and use the greeting slice as the starter application-structure example.

- [#1563](https://github.com/fluojs/fluo/pull/1563) [`1b75835`](https://github.com/fluojs/fluo/commit/1b7583508375a8a4cd7b5cbfa69bced006e5df5d) Thanks [@ayden94](https://github.com/ayden94)! - Extract the generated Vite decorator transform into the new `@fluojs/vite` package so `fluo new` projects import a maintained plugin instead of copying the Babel implementation inline.

### Patch Changes

- [#1558](https://github.com/fluojs/fluo/pull/1558) [`6c877e2`](https://github.com/fluojs/fluo/commit/6c877e2dfb07b4514aae027eece38db673cc9a05) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Bun app terminal color detection when `fluo dev` or `fluo start` pipes child output through the CLI lifecycle reporter.

- [#1551](https://github.com/fluojs/fluo/pull/1551) [`e0427f6`](https://github.com/fluojs/fluo/commit/e0427f6d260f2dffaf0dc34a98909ddab0eecb40) Thanks [@ayden94](https://github.com/ayden94)! - Include Bun globals in generated Bun starter TypeScript configuration so pnpm typecheck succeeds when the starter references `Bun.env`.

- [#1547](https://github.com/fluojs/fluo/pull/1547) [`292634e`](https://github.com/fluojs/fluo/commit/292634e5be6b17257c3248d4fe79d82d29ea8c3b) Thanks [@ayden94](https://github.com/ayden94)! - Keep interactive `fluo dev` application output visible with an `app │` prefix so CLI lifecycle status and runtime logs remain easy to distinguish.

- [#1557](https://github.com/fluojs/fluo/pull/1557) [`ca1bbdd`](https://github.com/fluojs/fluo/commit/ca1bbdd84b71bfe3e5f8af9321cd4624aa376c52) Thanks [@ayden94](https://github.com/ayden94)! - Update generated `fluo new` starters to import `HealthModule` directly from `@fluojs/runtime`, call `HealthModule.forRoot()`, and omit explicit metadata symbol setup from the greeting controller scaffold.

- [#1549](https://github.com/fluojs/fluo/pull/1549) [`2e3408f`](https://github.com/fluojs/fluo/commit/2e3408f93675e0aa8a2740209ce4061692183292) Thanks [@ayden94](https://github.com/ayden94)! - Keep colorized application logs consistent between `fluo dev` and `fluo start` by preserving ANSI color intent through the CLI development reporter.

- [#1554](https://github.com/fluojs/fluo/pull/1554) [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0) Thanks [@ayden94](https://github.com/ayden94)! - Add `HealthModule.forRoot(...)` as the application-facing runtime health facade and update generated starters to use it while preserving the deprecated `createHealthModule(...)` compatibility helper.

- [#1562](https://github.com/fluojs/fluo/pull/1562) [`c7a31c3`](https://github.com/fluojs/fluo/commit/c7a31c356942556f4f4c84e8bec0ef62e1d94785) Thanks [@ayden94](https://github.com/ayden94)! - Preserve fluo application log colors when generated Bun, Deno, and Cloudflare Workers dev lifecycles run through the CLI reporter.

- [#1560](https://github.com/fluojs/fluo/pull/1560) [`9295ce5`](https://github.com/fluojs/fluo/commit/9295ce57d965639baec9ed03d806b743e66d3251) Thanks [@ayden94](https://github.com/ayden94)! - Update generated Bun, Deno, and Cloudflare Workers starter lifecycles so `fluo dev` defaults to runtime-native watch loops with an explicit `--runner fluo` fallback, while production and deployment use runtime-native commands.

- Updated dependencies [[`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0)]:
  - @fluojs/runtime@1.0.0-beta.11

## 1.0.0-beta.5

### Minor Changes

- [#1535](https://github.com/fluojs/fluo/pull/1535) [`45a84a8`](https://github.com/fluojs/fluo/commit/45a84a87fe77d2936ab075d2c7b3eafd870d3b41) Thanks [@ayden94](https://github.com/ayden94)! - Align generated project lifecycle scripts around `fluo dev`, `fluo build`, and `fluo start`, with CLI-owned runtime commands, project-local toolchain binary resolution, Workers preview-safe start behavior, and Next.js-like `NODE_ENV` defaults that preserve explicitly provided environment values.

- [#1531](https://github.com/fluojs/fluo/pull/1531) [`6cb8d78`](https://github.com/fluojs/fluo/commit/6cb8d781f3ac62f7848da71aad292d78948abf04) Thanks [@ayden94](https://github.com/ayden94)! - Add CLI roadmap command MVPs for version inspection, diagnostics, script orchestration, package workflow guidance, and composite resource generation.

- [#1539](https://github.com/fluojs/fluo/pull/1539) [`f28a8c8`](https://github.com/fluojs/fluo/commit/f28a8c8e01a2dea8906c1d0b47ed60c4966b8081) Thanks [@ayden94](https://github.com/ayden94)! - Add configurable runtime console logger modes and level filtering, and add CLI lifecycle reporter controls for quieter interactive dev output while preserving raw passthrough for CI and debugging.

### Patch Changes

- [#1538](https://github.com/fluojs/fluo/pull/1538) [`2239996`](https://github.com/fluojs/fluo/commit/2239996bcc61c5fa63427511c6927ad0e248b78c) Thanks [@ayden94](https://github.com/ayden94)! - Refresh the interactive CLI latest-version check for `fluo new` and `fluo create` before scaffolding while preserving cached update checks for normal commands.

- [#1540](https://github.com/fluojs/fluo/pull/1540) [`1f312e0`](https://github.com/fluojs/fluo/commit/1f312e02ff7123a82c63d86d022ec9d3bb8c92eb) Thanks [@ayden94](https://github.com/ayden94)! - Add a fluo-owned Node dev restart runner that dedupes unchanged file saves before restart while preserving raw runtime watcher escape hatches. Config watch reloads now also skip unchanged env file saves and change-then-revert bursts before replacing the in-process snapshot.

- Updated dependencies [[`f28a8c8`](https://github.com/fluojs/fluo/commit/f28a8c8e01a2dea8906c1d0b47ed60c4966b8081)]:
  - @fluojs/runtime@1.0.0-beta.10

## 1.0.0-beta.4

### Patch Changes

- [#1527](https://github.com/fluojs/fluo/pull/1527) [`0b0bb10`](https://github.com/fluojs/fluo/commit/0b0bb10f2efa206e6c71cd5cf88ea0f28685b5e2) Thanks [@ayden94](https://github.com/ayden94)! - Refresh `fluo new` starter dependency pins to the latest published beta versions of the generated `@fluojs/*` packages.

## 1.0.0-beta.3

### Minor Changes

- [#1525](https://github.com/fluojs/fluo/pull/1525) [`922fa87`](https://github.com/fluojs/fluo/commit/922fa87998ecc4c3c4b94dffb921439171663460) Thanks [@ayden94](https://github.com/ayden94)! - Update the CLI self-update flow to reuse the package manager that owns the current global install instead of always invoking pnpm.

## 1.0.0-beta.2

### Minor Changes

- [#1285](https://github.com/fluojs/fluo/pull/1285) [`185487f`](https://github.com/fluojs/fluo/commit/185487f01a8aaa0fe723b536f6bcaa2ab75cd84f) Thanks [@ayden94](https://github.com/ayden94)! - Expand CLI automation outputs for generation, inspection, migration, scaffolding, and generator metadata.

  Expose Studio-owned snapshot-to-Mermaid rendering helpers and platform snapshot types.

  Refresh the published Fastify adapter dependency metadata to fastify@^5.8.5.

### Patch Changes

- Updated dependencies [[`185487f`](https://github.com/fluojs/fluo/commit/185487f01a8aaa0fe723b536f6bcaa2ab75cd84f)]:
  - @fluojs/studio@1.0.0-beta.2
