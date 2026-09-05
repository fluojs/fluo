# @fluojs/testing

## [Unreleased]

## 3.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3694](https://github.com/fluojs/fluo/pull/3694) [`f9c605b`](https://github.com/fluojs/fluo/commit/f9c605b5be3eb6ad7563e5617829dabc615be484) Thanks [@ayden94](https://github.com/ayden94)! - Require Vitest 4.1.11 or newer within the Vitest 4 release line for the public mock helpers and `@fluojs/testing/vitest` tooling entrypoints.

  Update the Vite plugin documentation to describe the workspace Vite 8.2.2/Rolldown verification gate while preserving the published `vite >=6.2.0` peer contract.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Upgrade `vitest` from version 3 to `^4.1.11` in workspaces that consume `@fluojs/testing` mock or Vitest tooling surfaces.

- [#3078](https://github.com/fluojs/fluo/pull/3078) [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317) Thanks [@ayden94](https://github.com/ayden94)! - Add validated uppercase custom HTTP route authoring with `Route(method, path)` and first-class RFC `Query(path)` support while preserving exact-method precedence, versioning, DTO validation, and default response semantics.

  Widen the internal route metadata method declaration so HTTP integrations can carry custom tokens, keep custom methods on Bun fetch fallback, and let Fastify wildcard fallback receive registered custom method names without creating native fluo route handoffs.

  Expose shared network and fetch-style portability assertions for body-bearing `QUERY` and extension-method routes across supported adapters.

  Require Node.js `>=24.0.0 <27` for published Node listener paths and generated Node HTTP starters so RFC `QUERY` reaches framework dispatch. This final coordinated-release policy supersedes the earlier listener-only Node floor. Bun and Deno fetch-style adapter contracts are unchanged. Cloudflare Workers' documented fetch-style contract includes body-bearing `QUERY` and extension-method dispatch through its Worker fetch handler.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Regenerated Node HTTP projects use the same Node support range. Custom-method and portability additions remain part of this one upcoming release per package.

### Minor Changes

- [#3560](https://github.com/fluojs/fluo/pull/3560) [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317) Thanks [@ayden94](https://github.com/ayden94)! - Add portable RFC single-byte-range responses with conditional `If-Range` integration, identity-byte partial delivery, and cross-adapter conformance coverage.

- [#3552](https://github.com/fluojs/fluo/pull/3552) [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9) Thanks [@ayden94](https://github.com/ayden94)! - Add RFC 9110 conditional request handling with explicit representation existence, validated entity-tag and HTTP-date parsing, middleware/guard-safe evaluation, and Node.js/Express/Fastify listener plus Bun/Deno/Cloudflare fetch-adapter conformance coverage.

- [#2898](https://github.com/fluojs/fluo/pull/2898) [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d) Thanks [@ayden94](https://github.com/ayden94)! - Add an HTTP-owned, content-negotiated error representation seam that preserves canonical JSON by default, optionally renders application-owned HTML for classified errors and route misses, and keeps status, headers, `HEAD`, abort, commit, and one-shot fallback behavior in the dispatcher.

  Expose runtime bootstrap wiring, a buffered React error-document provider adapter, and typed network/fetch-style portability assertions for the new representation contract.

  Preserve existing Express response `Vary` values when HTTP error representation negotiation adds `Accept`.

- [#3534](https://github.com/fluojs/fluo/pull/3534) [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049) Thanks [@ayden94](https://github.com/ayden94)! - Add portable `setCookie` and `clearCookie` response helpers with ordered, non-folded `Set-Cookie` fields and whole-second lifetime semantics across adapters. Add response-cookie portability assertions for Node, Express, Fastify, Web, Bun, Deno, and Workers.

- [#3435](https://github.com/fluojs/fluo/pull/3435) [`c50b44b`](https://github.com/fluojs/fluo/commit/c50b44b822fb808dcb2c0f1257a7b88d0653bafb) Thanks [@ayden94](https://github.com/ayden94)! - Add a PlatformShell lifecycle exclusivity conformance harness for platform packages.

- [#3300](https://github.com/fluojs/fluo/pull/3300) [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2) Thanks [@ayden94](https://github.com/ayden94)! - Add an optional, independently versioned fetch-style realtime binding installation extension while preserving the public capability version 1 contract, and expose the shared internal gateway discovery seam for protocol adapters.

  Make Socket.IO attach connection lifecycle buffering before asynchronous gateway resolution, drain accepted gateway work before clearing managed state, share one bounded attempt across runtime shutdown hooks with explicit `retryShutdown()` recovery, clean pre-listen Bun bindings after bootstrap failure, reject unsupported `serverBacked` gateways consistently, dispatch through canonical handler indexes, and align runtime manifests, migration, and bilingual option documentation.

  Existing Socket.IO gateways configured with `@WebSocketGateway({ serverBacked })` must remove that option and use the shared application listener. Consumers that require a dedicated listener must migrate that gateway to `@fluojs/websockets/node` or own a separate Socket.IO server outside this adapter.

- [#3427](https://github.com/fluojs/fluo/pull/3427) [`0f9dc52`](https://github.com/fluojs/fluo/commit/0f9dc523826ca4ab8e6cd8f8d896da7d65bf5b3f) Thanks [@ayden94](https://github.com/ayden94)! - Support normalized cookie records in `createTestApp` object requests and `TestingModuleRef.dispatch`.

### Patch Changes

- [#3522](https://github.com/fluojs/fluo/pull/3522) [`cb8f9f4`](https://github.com/fluojs/fluo/commit/cb8f9f4322819bea6d97d3218d02f3214a143333) Thanks [@ayden94](https://github.com/ayden94)! - Bound Web abort portability dispatch completion so stuck adapters time out and still close.

- [`9207118`](https://github.com/fluojs/fluo/commit/92071186a7f2cb3e4a279de4e6e6342093b6eed0) Thanks [@ayden94](https://github.com/ayden94)! - Make SSE portability checks wait for the handler before explicitly closing the stream, with bounded failures and abort cleanup.

- [#2927](https://github.com/fluojs/fluo/pull/2927) [`bcdede7`](https://github.com/fluojs/fluo/commit/bcdede77130aede73c848523bddd96d2129d9554) Thanks [@ayden94](https://github.com/ayden94)! - Dispose internally created testing containers when module compilation fails while preserving the compile and cleanup failures.

- [#3598](https://github.com/fluojs/fluo/pull/3598) [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab) Thanks [@ayden94](https://github.com/ayden94)! - Add the internal contribution-resolution seam used by framework packages while keeping index-based contribution resolution off the root `Container` API. Run lifecycle hooks for every eligible singleton `multi: true` provider contribution in provider order, with reverse contribution order during shutdown and bootstrap rollback. Make testing-module lifecycle compilation report the canonical DI scope and circular-dependency errors.

- [#3418](https://github.com/fluojs/fluo/pull/3418) [`2921851`](https://github.com/fluojs/fluo/commit/29218513f25ac3d9ed81f34cfdb040d60d82327c) Thanks [@ayden94](https://github.com/ayden94)! - Merge mixed-case virtual response `Set-Cookie` writes into one ordered header.

- [#3545](https://github.com/fluojs/fluo/pull/3545) [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566) Thanks [@ayden94](https://github.com/ayden94)! - Reuse the portable HTTP cookie serializer for Passport authentication cookies while preserving established defaults, attribute ordering, and append behavior. Values such as `token with spaces` now emit as `token%20with%20spaces`, and invalid cookie names or attributes fail the portable serializer's validation instead of producing malformed headers.

- [#3424](https://github.com/fluojs/fluo/pull/3424) [`f6ab730`](https://github.com/fluojs/fluo/commit/f6ab73046779d9c08150e4a81a7777f24e7a7fb7) Thanks [@ayden94](https://github.com/ayden94)! - Run singleton factory provider lifecycle hooks during testing-module compilation, including factory overrides and multi providers.

- [#3074](https://github.com/fluojs/fluo/pull/3074) [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8) Thanks [@ayden94](https://github.com/ayden94)! - Suppress framework-managed response bodies for `HEAD` requests while preserving selected status and headers across successful, canonical JSON error, negotiated error, and `406` outcomes.

  Extend the shared HTTP adapter portability assertion to cover successful and canonical JSON `HEAD` responses across supported network and fetch-style adapters.

  Preserve Express response metadata by committing framework-suppressed `HEAD` bodies without reserializing them as empty text.

- [#3462](https://github.com/fluojs/fluo/pull/3462) [`dcb351d`](https://github.com/fluojs/fluo/commit/dcb351de5904e38b6a52bdd92daff10fb00f2b0e) Thanks [@ayden94](https://github.com/ayden94)! - Document caller-owned disposal for successfully compiled testing modules across official testing guidance and examples.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`199f2f9`](https://github.com/fluojs/fluo/commit/199f2f91d68ad3db12e0db965a8f6e25a10122a0), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`fa3a990`](https://github.com/fluojs/fluo/commit/fa3a9904f53c543ddc9fbf6f0fdf635731d07ffa), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`31f9c02`](https://github.com/fluojs/fluo/commit/31f9c02d3983e321cd7a1fb752df43269681ada7), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`8d6c163`](https://github.com/fluojs/fluo/commit/8d6c163579c45dd49ca202c5926958c9ecb2a6d4), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`f4e2f04`](https://github.com/fluojs/fluo/commit/f4e2f045bb68c8410c2e3435948a45e42b86d301), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/http@3.0.0
  - @fluojs/runtime@3.0.0
  - @fluojs/config@2.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0

## 2.0.0

### Major Changes

- [#2470](https://github.com/fluojs/fluo/pull/2470) [`ad586ec`](https://github.com/fluojs/fluo/commit/ad586ecf063083877282c1a77800ea4bf393ca2a) Thanks [@ayden94](https://github.com/ayden94)! - Narrow the root `@fluojs/testing` type surface to documented app/module testing contracts while keeping mock compatibility helpers available from `@fluojs/testing/types` and `@fluojs/testing/mock`.

  Migration: import low-level mock compatibility helper types such as `TestingMockFunction`, `TestingMockContext`, `TestingMockResult`, and `TestingMockSettledResult` from `@fluojs/testing/types` instead of the root package.

### Patch Changes

- [#2464](https://github.com/fluojs/fluo/pull/2464) [`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439) Thanks [@ayden94](https://github.com/ayden94)! - Refresh runtime platform telemetry from the active registry collect path so advanced shared-registry scrapers observe fresh component readiness and health series.

- [#2454](https://github.com/fluojs/fluo/pull/2454) [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100) Thanks [@ayden94](https://github.com/ayden94)! - Harden DI introspection snapshots and override stale-instance disposal ordering so framework-owned state cannot be observed through live maps and replacement resolution waits for stale teardown failures. Update testing module sync cache adoption to consume the snapshot introspection contract.

- [#2388](https://github.com/fluojs/fluo/pull/2388) [`64dec7f`](https://github.com/fluojs/fluo/commit/64dec7ff348544af6dfbe666b12f6f8d4d4f2195) Thanks [@ayden94](https://github.com/ayden94)! - Clarify `DeepMocked<T>` import surfaces and strengthen testing package regression coverage for createTestApp option forwarding, Vitest Babel config diagnostics, and portability cleanup failures.

- [#2302](https://github.com/fluojs/fluo/pull/2302) [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6) Thanks [@ayden94](https://github.com/ayden94)! - Harden DI request-scope lifecycle and introspection ownership by recursively disposing nested request scopes from their owners, returning read-only introspection state, and keeping testing cache adoption on controlled container-owned APIs.

  Migration note: callers that used `inspectResolutionState()` as a mutable escape hatch must stop mutating returned registration/cache maps or normalized provider records. Framework-owned tooling should use the returned `cacheOwner` helpers for controlled cache adoption instead of writing to the maps directly.

- [#2332](https://github.com/fluojs/fluo/pull/2332) [`8e0e43f`](https://github.com/fluojs/fluo/commit/8e0e43f7fa355aa9b804a9fb2833d29e1542a5c6) Thanks [@ayden94](https://github.com/ayden94)! - Keep Vitest mock-only declaration imports on the `@fluojs/testing/mock` boundary while preserving backward-compatible root `DeepMocked<T>` type imports through a Vitest-free structural mock type.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`344cec0`](https://github.com/fluojs/fluo/commit/344cec07b828af4d405efea3767302840edde19e), [`ec8ffb6`](https://github.com/fluojs/fluo/commit/ec8ffb605cf4b128fb2f7786a2a606b613530164), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/config@1.0.4
  - @fluojs/core@1.1.0

## 1.0.6

### Patch Changes

- [#2172](https://github.com/fluojs/fluo/pull/2172) [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451) Thanks [@ayden94](https://github.com/ayden94)! - Harden `overrideModule()` so testing module replacements preserve authored module identities without mutating source module metadata, add the runtime module replacement compile seam used by testing, and document the testing module, `createTestApp`, Vitest entrypoint, and NestJS migration contracts.

- [#2113](https://github.com/fluojs/fluo/pull/2113) [`1fab5ce`](https://github.com/fluojs/fluo/commit/1fab5ced669a02141c12760afc387ab88da1e1bf) Thanks [@ayden94](https://github.com/ayden94)! - Restrict the Vitest workspace alias helper to package exports so private source files are not exposed as importable `@fluojs/*` subpaths.

- [#2233](https://github.com/fluojs/fluo/pull/2233) [`b038b4c`](https://github.com/fluojs/fluo/commit/b038b4c6014a092c321289358a3f5e965d452461) Thanks [@ayden94](https://github.com/ayden94)! - Harden testing harness cleanup by closing platform conformance components after validation, diagnostics, and snapshot checks, making `createTestApp().close()` idempotent, and preserving cleanup failures for portability `run()` callbacks that surface a partially bootstrapped app.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## 1.0.5

### Patch Changes

- [#2053](https://github.com/fluojs/fluo/pull/2053) [`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1) Thanks [@ayden94](https://github.com/ayden94)! - Add an explicit DI container resolution-state introspection seam for framework testing helpers, remove HTTP portability startup-log assertions from global console monkey-patching, cache Vitest workspace alias scans per repository root, and harden testing package documentation and regression coverage.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1)]:
  - @fluojs/di@1.1.0
  - @fluojs/runtime@1.1.6

## 1.0.4

### Patch Changes

- [#2011](https://github.com/fluojs/fluo/pull/2011) [`4be19f0`](https://github.com/fluojs/fluo/commit/4be19f0e343e686ec84b5d15273e1b44241cbabb) Thanks [@ayden94](https://github.com/ayden94)! - Run testing-module bootstrap lifecycle hooks for singleton multi-provider contributions and document the Test namespace facade while covering createTestApp bootstrap option forwarding.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.3

### Patch Changes

- [#1990](https://github.com/fluojs/fluo/pull/1990) [`ca0e46a`](https://github.com/fluojs/fluo/commit/ca0e46afeb370eed4c64c7c9bdc5286f2f9d367b) Thanks [@ayden94](https://github.com/ayden94)! - Align testing module compilation and synchronous resolution with production lifecycle and DI ownership semantics.

- [#1992](https://github.com/fluojs/fluo/pull/1992) [`452bfb4`](https://github.com/fluojs/fluo/commit/452bfb44f80cb83d0f6bcf7aa6e333db07b4085f) Thanks [@ayden94](https://github.com/ayden94)! - Stabilize HTTP adapter portability tests by binding ephemeral ports directly, make the Deno adapter report actual `port: 0` listen targets before startup completes, document local Vitest peer installation, and publish the `@fluojs/testing/vitest/tooling` subpath with import regression coverage.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0

## 1.0.2

### Patch Changes

- [#1848](https://github.com/fluojs/fluo/pull/1848) [`d3eabb0`](https://github.com/fluojs/fluo/commit/d3eabb070ea2d89375d1074c84784188c7093e4b) Thanks [@ayden94](https://github.com/ayden94)! - Harden portability and conformance harness cleanup so partially bootstrapped HTTP apps are closed after setup failures, web-runtime raw-body checks cover exact bytes, and diagnostics include actionable failure context.

- Updated dependencies [[`34c840f`](https://github.com/fluojs/fluo/commit/34c840f3a1cd15e0399aa91467201d5b8f85a988), [`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/config@1.0.1
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1

## 1.0.0

### Patch Changes

- e22c645: Add Fastify coverage for the shared HTTP adapter portability harness and extend the harness to verify stream drain waiters settle when a response stream closes before a drain event.
- cf07bd7: Report portability harness cleanup failures explicitly while preserving primary assertion failures, and declare fetch-style platform test dependencies so conformance imports remain type-checked.
- aaab8c4: Harden `@fluojs/testing/vitest` module-id and Babel config portability, make HTTP portability harness assertions less flaky, and add a public `getModuleMetadata()` reader through the core root entrypoint so testing helpers avoid private internals.
- 00f4d90: Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- 1b0fb6a: Preserve testing module identity during module overrides and align documented `createTestingModule` contracts with regression coverage.
- f6e90f0: Preserve `createTestApp(...)` bootstrap middleware/options and align synchronous `TestingModuleRef.get(...)` singleton instances with later async resolution.
- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [aa80042]
- Updated dependencies [372a80d]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [e430e58]
- Updated dependencies [aaab8c4]
- Updated dependencies [93fc34b]
- Updated dependencies [a625716]
- Updated dependencies [45e0f1b]
- Updated dependencies [b82b28f]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [16420f9]
- Updated dependencies [53a2b8e]
- Updated dependencies [e1bce3d]
- Updated dependencies [3baf5df]
- Updated dependencies [7b50db8]
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
- Updated dependencies [28ca2ef]
- Updated dependencies [d4b7d48]
- Updated dependencies [dc8fff1]
- Updated dependencies [d3504c6]
- Updated dependencies [1f312e0]
  - @fluojs/http@1.0.0
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/config@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.4

### Patch Changes

- [#1769](https://github.com/fluojs/fluo/pull/1769) [`cf07bd7`](https://github.com/fluojs/fluo/commit/cf07bd747c9a385db21868a1615c380faa96eaf8) Thanks [@ayden94](https://github.com/ayden94)! - Report portability harness cleanup failures explicitly while preserving primary assertion failures, and declare fetch-style platform test dependencies so conformance imports remain type-checked.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74), [`7b50db8`](https://github.com/fluojs/fluo/commit/7b50db85e95e2341f82d006f1e665c2bbcebeaa5)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8
  - @fluojs/http@1.0.0-beta.11

## 1.0.0-beta.3

### Patch Changes

- [#1692](https://github.com/fluojs/fluo/pull/1692) [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0) Thanks [@ayden94](https://github.com/ayden94)! - Harden `@fluojs/testing/vitest` module-id and Babel config portability, make HTTP portability harness assertions less flaky, and add a public `getModuleMetadata()` reader through the core root entrypoint so testing helpers avoid private internals.

- [#1640](https://github.com/fluojs/fluo/pull/1640) [`f6e90f0`](https://github.com/fluojs/fluo/commit/f6e90f0cd781d481b98976425273ea952a170100) Thanks [@ayden94](https://github.com/ayden94)! - Preserve `createTestApp(...)` bootstrap middleware/options and align synchronous `TestingModuleRef.get(...)` singleton instances with later async resolution.

- Updated dependencies [[`372a80d`](https://github.com/fluojs/fluo/commit/372a80d337f8b806f05693ed33ca45d6e4289115), [`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/config@1.0.0-beta.8
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.2

### Patch Changes

- [#1354](https://github.com/fluojs/fluo/pull/1354) [`e22c645`](https://github.com/fluojs/fluo/commit/e22c645f0ad78ec1e050db9f6b9d8e2479884959) Thanks [@ayden94](https://github.com/ayden94)! - Add Fastify coverage for the shared HTTP adapter portability harness and extend the harness to verify stream drain waiters settle when a response stream closes before a drain event.

- [#1349](https://github.com/fluojs/fluo/pull/1349) [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a) Thanks [@ayden94](https://github.com/ayden94)! - Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- [#1364](https://github.com/fluojs/fluo/pull/1364) [`1b0fb6a`](https://github.com/fluojs/fluo/commit/1b0fb6a2ad3f0dfe8175b187453d43a03976c9f2) Thanks [@ayden94](https://github.com/ayden94)! - Preserve testing module identity during module overrides and align documented `createTestingModule` contracts with regression coverage.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/config@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
