# @fluojs/cqrs

## [Unreleased]

## 3.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3599](https://github.com/fluojs/fluo/pull/3599) [`deb5ecc`](https://github.com/fluojs/fluo/commit/deb5eccb4b4b2b1dfebe286e702cc551abcaf94d) Thanks [@ayden94](https://github.com/ayden94)! - Declare the package-owned Node.js support range `>=24.0.0 <27` for `@fluojs/cqrs` in the upcoming coordinated release. The portable `@fluojs/runtime` package no longer supplies a transitive Node engine requirement.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

### Minor Changes

- [#3607](https://github.com/fluojs/fluo/pull/3607) [`d797bc6`](https://github.com/fluojs/fluo/commit/d797bc654d2b8d358193c365685982d6dab75127) Thanks [@ayden94](https://github.com/ayden94)! - Expose command and query discovery counts and lifecycle summaries in CQRS status snapshots without revealing handler descriptors or provider tokens.

### Patch Changes

- [#3614](https://github.com/fluojs/fluo/pull/3614) [`3f6ca8c`](https://github.com/fluojs/fluo/commit/3f6ca8c23e383e0208428aae4b0a7580698ea9b9) Thanks [@ayden94](https://github.com/ayden94)! - Complete the public CQRS status snapshot, lifecycle, module visibility, and nested-dispatch context documentation.

- [#3580](https://github.com/fluojs/fluo/pull/3580) [`9692cd0`](https://github.com/fluojs/fluo/commit/9692cd0e91db2aa7f6256275806859e143b70f87) Thanks [@ayden94](https://github.com/ayden94)! - Reject non-constructable callable values passed to `@Saga()` before saga discovery and preserve normalized saga event metadata.

- [#3600](https://github.com/fluojs/fluo/pull/3600) [`1f93761`](https://github.com/fluojs/fluo/commit/1f93761331a32cfd05a1da2222e1fa90d476f158) Thanks [@ayden94](https://github.com/ayden94)! - Enforce one bounded CQRS shutdown deadline across active event pipelines, saga drains, and delegated Event Bus publication. Existing `shutdown.drainTimeoutMs` configuration remains unchanged.

- [#3586](https://github.com/fluojs/fluo/pull/3586) [`54cba88`](https://github.com/fluojs/fluo/commit/54cba886f2cac2579bbfbb116c2ddbdf69bc3e17) Thanks [@ayden94](https://github.com/ayden94)! - Discover singleton command, query, event, and saga handlers registered through supported `useFactory` and `useValue` provider forms.

- [#3051](https://github.com/fluojs/fluo/pull/3051) [`fa43294`](https://github.com/fluojs/fluo/commit/fa43294cd8f00d562e1f84e67ebfa96f70dd7aff) Thanks [@ayden94](https://github.com/ayden94)! - Serialize nested different-event saga continuations, external publications, and awaited delegated-subscriber re-entry on one provider-token FIFO chain without concurrent `handle(...)` entry or publish deadlocks, while preserving cycle and depth protections.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- Updated dependencies [[`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`3e9f149`](https://github.com/fluojs/fluo/commit/3e9f149d6dc7f629900f41e6b3bc54e8c0b54276), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`1f93761`](https://github.com/fluojs/fluo/commit/1f93761331a32cfd05a1da2222e1fa90d476f158), [`5e00d27`](https://github.com/fluojs/fluo/commit/5e00d2740239a48bf7efa2d1deeef4e4fe3731b1), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`679b72a`](https://github.com/fluojs/fluo/commit/679b72a76bc5dba92207a1990793243158e414fb), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0
  - @fluojs/event-bus@3.0.0

## 2.0.0

### Major Changes

- [#2471](https://github.com/fluojs/fluo/pull/2471) [`7d53a2a`](https://github.com/fluojs/fluo/commit/7d53a2aca3c2ea3cf610cb60d4585f67129c4f4e) Thanks [@ayden94](https://github.com/ayden94)! - Reject CQRS event publishes and direct saga dispatches as soon as runtime shutdown starts, drain late nested saga work until the saga queue is quiescent, and keep delegated event-bus providers module-local by default when `CqrsModule.forRoot({ global: false })` is used.

  Migration note: applications that intentionally relied on delegated `@fluojs/event-bus` providers remaining globally visible while using `CqrsModule.forRoot({ global: false })` must now either pass `eventBus: { global: true }` explicitly or import the CQRS module into consumers that inject delegated event-bus tokens.

### Patch Changes

- [#2608](https://github.com/fluojs/fluo/pull/2608) [`be29f76`](https://github.com/fluojs/fluo/commit/be29f76660157a9cbd107421db5a3c6f1db17a5e) Thanks [@ayden94](https://github.com/ayden94)! - Preserve event-handler and saga fan-out for distinct singleton provider tokens, and keep nested CQRS topology and shutdown-drain state private and immutable.

- [#2300](https://github.com/fluojs/fluo/pull/2300) [`4eee9ad`](https://github.com/fluojs/fluo/commit/4eee9ad2708c53803ede2123b1c1f9f6777fc9a0) Thanks [@ayden94](https://github.com/ayden94)! - Detect duplicate command and query handlers when the same handler class is registered under different singleton provider tokens.

- [#2382](https://github.com/fluojs/fluo/pull/2382) [`3c9ebdd`](https://github.com/fluojs/fluo/commit/3c9ebddcff028e8a54a979da4f1e4dcf059c3f81) Thanks [@ayden94](https://github.com/ayden94)! - Tighten CQRS handler discovery to provider-only registrations and reject command/query dispatch after shutdown starts while clearing preloaded handler caches.

- [#2315](https://github.com/fluojs/fluo/pull/2315) [`592320d`](https://github.com/fluojs/fluo/commit/592320de3bdb11d270aa9a222b51c50f4d3f11c9) Thanks [@ayden94](https://github.com/ayden94)! - Allow context-preserving nested CQRS event publishes to finish while shutdown drains active handler and saga pipelines.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`5764ff8`](https://github.com/fluojs/fluo/commit/5764ff80b460515f13e41c21c3ef6e2b743b2777), [`2df22b7`](https://github.com/fluojs/fluo/commit/2df22b7cd9fff354df1a3e1df3dd65de4de9f3ed), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896), [`f521959`](https://github.com/fluojs/fluo/commit/f5219597ea109d383fe993cfa732bf7765417d88)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/event-bus@2.0.0
  - @fluojs/core@1.1.0

## 1.1.2

### Patch Changes

- [#2119](https://github.com/fluojs/fluo/pull/2119) [`4fd0631`](https://github.com/fluojs/fluo/commit/4fd063145ad8ac7df823751aaa11f63a6e31c572) Thanks [@ayden94](https://github.com/ayden94)! - Align the CQRS source and generated declaration surface with the documented runtime-agnostic dispatch context contract by keeping `CqrsDispatchContext` opaque, ignoring caller-shaped topology internals unless CQRS created the context, and keeping low-level provider assembly behind `CqrsModule.forRoot(...)`.

- [#2231](https://github.com/fluojs/fluo/pull/2231) [`5372401`](https://github.com/fluojs/fluo/commit/5372401b1842947717d816ac9fe8fda08cdd86dd) Thanks [@ayden94](https://github.com/ayden94)! - Reject new CQRS event publishes and direct saga dispatches once shutdown has started while still draining already active publish and saga work.

- Updated dependencies [[`7cb2070`](https://github.com/fluojs/fluo/commit/7cb2070549382319349e03a0309f527c70673b6e), [`f6bd63b`](https://github.com/fluojs/fluo/commit/f6bd63b94044260643704ad2ed4f5486a2db6e64), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/event-bus@1.0.1
  - @fluojs/runtime@1.1.8

## 1.1.1

### Patch Changes

- [#2083](https://github.com/fluojs/fluo/pull/2083) [`9ca5e72`](https://github.com/fluojs/fluo/commit/9ca5e7276f3a1157954638865fd1e90bade4fe34) Thanks [@ayden94](https://github.com/ayden94)! - Remove the Node.js `node:async_hooks` root import from saga dispatch by threading an explicit runtime-agnostic CQRS dispatch context through nested command, query, event, and saga calls.

- Updated dependencies [[`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/runtime@1.1.7

## 1.1.0

### Minor Changes

- [#1870](https://github.com/fluojs/fluo/pull/1870) [`7edcd4e`](https://github.com/fluojs/fluo/commit/7edcd4ed79be3f00676a61cbcdb6816ec5fedaa9) Thanks [@ayden94](https://github.com/ayden94)! - Reject CQRS command, query, event, and direct saga dispatch after shutdown has completed, preventing stopped applications from starting new local handler or saga work. Also detect aliased duplicate command/query handlers by provider token while preserving event-handler and saga fan-out for aliased providers.

### Patch Changes

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`d23049a`](https://github.com/fluojs/fluo/commit/d23049a59a49bdaea110a5f542ae18606c782db8), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.2
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.2

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- c32073a: Bound event-bus and CQRS shutdown drains so stuck handlers, sagas, or delegated publish chains report degraded diagnostics and no longer hang application close indefinitely.
- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 93125c1: Clarify CQRS event publishing contracts and add regression coverage for isolated handler and saga event copies before delegated event-bus publication.
- fd6864f: Drain active CQRS event publish and publishAll pipelines during application shutdown, and clarify that duplicate event handlers fan out instead of throwing duplicate-handler errors.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- Updated dependencies [eaddb13]
- Updated dependencies [c32073a]
- Updated dependencies [4fdb48c]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [1dda8b5]
- Updated dependencies [68fc4d0]
- Updated dependencies [0d6f074]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [aaab8c4]
- Updated dependencies [93fc34b]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [53a2b8e]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [00f4d90]
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
- Updated dependencies [dc8fff1]
- Updated dependencies [d3504c6]
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.7

### Patch Changes

- [#1768](https://github.com/fluojs/fluo/pull/1768) [`c32073a`](https://github.com/fluojs/fluo/commit/c32073a31cb474a8323dae5ca2538f243ec6b6a6) Thanks [@ayden94](https://github.com/ayden94)! - Bound event-bus and CQRS shutdown drains so stuck handlers, sagas, or delegated publish chains report degraded diagnostics and no longer hang application close indefinitely.

- Updated dependencies [[`c32073a`](https://github.com/fluojs/fluo/commit/c32073a31cb474a8323dae5ca2538f243ec6b6a6), [`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`0d6f074`](https://github.com/fluojs/fluo/commit/0d6f074b861325c665a73770b8bb413da08d0f9b)]:
  - @fluojs/event-bus@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8

## 1.0.0-beta.6

### Patch Changes

- [#1645](https://github.com/fluojs/fluo/pull/1645) [`fd6864f`](https://github.com/fluojs/fluo/commit/fd6864ff3f44f3da8ee348500eeebd292df77bbd) Thanks [@ayden94](https://github.com/ayden94)! - Drain active CQRS event publish and publishAll pipelines during application shutdown, and clarify that duplicate event handlers fan out instead of throwing duplicate-handler errors.

- Updated dependencies [[`eaddb13`](https://github.com/fluojs/fluo/commit/eaddb13cdc700762fcdb731ffb310018ad1d6205), [`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`68fc4d0`](https://github.com/fluojs/fluo/commit/68fc4d081a87e5c6516033d6c08bc1737ce158f0), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/event-bus@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.5

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- Updated dependencies [[`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299)]:
  - @fluojs/event-bus@1.0.0-beta.5

## 1.0.0-beta.4

### Patch Changes

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5), [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/event-bus@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.11

## 1.0.0-beta.3

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75), [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c)]:
  - @fluojs/runtime@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/event-bus@1.0.0-beta.3
  - @fluojs/di@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#1353](https://github.com/fluojs/fluo/pull/1353) [`93125c1`](https://github.com/fluojs/fluo/commit/93125c1ca69003aba9d2eaa9d87a27df14e7ff90) Thanks [@ayden94](https://github.com/ayden94)! - Clarify CQRS event publishing contracts and add regression coverage for isolated handler and saga event copies before delegated event-bus publication.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/event-bus@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
