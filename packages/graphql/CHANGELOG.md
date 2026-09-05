# @fluojs/graphql

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3078](https://github.com/fluojs/fluo/pull/3078) [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317) Thanks [@ayden94](https://github.com/ayden94)! - Add validated uppercase custom HTTP route authoring with `Route(method, path)` and first-class RFC `Query(path)` support while preserving exact-method precedence, versioning, DTO validation, and default response semantics.

  Widen the internal route metadata method declaration so HTTP integrations can carry custom tokens, keep custom methods on Bun fetch fallback, and let Fastify wildcard fallback receive registered custom method names without creating native fluo route handoffs.

  Expose shared network and fetch-style portability assertions for body-bearing `QUERY` and extension-method routes across supported adapters.

  Require Node.js `>=24.0.0 <27` for published Node listener paths and generated Node HTTP starters so RFC `QUERY` reaches framework dispatch. This final coordinated-release policy supersedes the earlier listener-only Node floor. Bun and Deno fetch-style adapter contracts are unchanged. Cloudflare Workers' documented fetch-style contract includes body-bearing `QUERY` and extension-method dispatch through its Worker fetch handler.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Regenerated Node HTTP projects use the same Node support range. Custom-method and portability additions remain part of this one upcoming release per package.

### Minor Changes

- [#3476](https://github.com/fluojs/fluo/pull/3476) [`1308eaf`](https://github.com/fluojs/fluo/commit/1308eaff52a3e3ba03c071eff494111364d79723) Thanks [@ayden94](https://github.com/ayden94)! - Activate `@FieldResolver({ nullable: false, type })` for newly added object fields, exposing them as non-null GraphQL outputs without changing existing field nullability.

- [#3669](https://github.com/fluojs/fluo/pull/3669) [`040eeed`](https://github.com/fluojs/fluo/commit/040eeedb4c6a8a79ef98c7758b61f59810216911) Thanks [@ayden94](https://github.com/ayden94)! - Add `GraphqlModule.forRootAsync({ inject, useFactory })` for explicit asynchronous GraphQL configuration from application-graph dependencies.

- [#3469](https://github.com/fluojs/fluo/pull/3469) [`8525b33`](https://github.com/fluojs/fluo/commit/8525b337f359678bfd1abf820fc7ef0504140099) Thanks [@ayden94](https://github.com/ayden94)! - Export `GraphqlWebSocketLimitsOptions` from the package root so consumers can type `subscriptions.websocket.limits` configuration.

- [#3474](https://github.com/fluojs/fluo/pull/3474) [`5e55b62`](https://github.com/fluojs/fluo/commit/5e55b621ab16ae5286f89b56cb1900f3be6f5c97) Thanks [@ayden94](https://github.com/ayden94)! - Add `@Args()` and `FieldResolverOptions.input` so code-first object field resolvers can materialize and validate DTO-bound GraphQL arguments at explicit TC39 decorator indexes.

### Patch Changes

- [#3471](https://github.com/fluojs/fluo/pull/3471) [`b253e40`](https://github.com/fluojs/fluo/commit/b253e40228741a1e8f498ae0a7650bce51039668) Thanks [@ayden94](https://github.com/ayden94)! - Ensure deterministic GraphQL network-test cleanup and exclude test fixtures from published package output.

- [#3477](https://github.com/fluojs/fluo/pull/3477) [`b8bfc4b`](https://github.com/fluojs/fluo/commit/b8bfc4bb48e372342352183a03a981b0c1d3ec62) Thanks [@ayden94](https://github.com/ayden94)! - Preserve cached `undefined` request-scoped DataLoader values within a GraphQL operation.

- [#3670](https://github.com/fluojs/fluo/pull/3670) [`d088b5a`](https://github.com/fluojs/fluo/commit/d088b5a45112876dfb0b17a3618ddcd23f4f856c) Thanks [@ayden94](https://github.com/ayden94)! - Document the application-owned authorization, schema nullability, resolver lifecycle, fixed endpoint, decorator target, and subscription ownership boundaries required when migrating GraphQL resolvers from NestJS.

- [#3671](https://github.com/fluojs/fluo/pull/3671) [`bcf033e`](https://github.com/fluojs/fluo/commit/bcf033ed8d9dd3d9098dc6faf9f37dbe51fd1fc5) Thanks [@ayden94](https://github.com/ayden94)! - Document the new runnable GraphQL example in English and Korean and make it easier to discover from the package documentation.

- [#3480](https://github.com/fluojs/fluo/pull/3480) [`72304c1`](https://github.com/fluojs/fluo/commit/72304c1130543f2612a89e47e17e5501a4c987f1) Thanks [@ayden94](https://github.com/ayden94)! - Isolate cross-realm GraphQL `instanceOf` patch ownership by mutable module object so built ESM applications, active allowlists across external re-patches, lifecycle cleanup, other GraphQL module instances, and external integrations remain correct.

- [#3467](https://github.com/fluojs/fluo/pull/3467) [`1925586`](https://github.com/fluojs/fluo/commit/19255864942b02461e969b6501a857f18cbcd3df) Thanks [@ayden94](https://github.com/ayden94)! - Document the public GraphQL WebSocket transport interfaces and factory.

- [#3478](https://github.com/fluojs/fluo/pull/3478) [`c6db5ec`](https://github.com/fluojs/fluo/commit/c6db5ec6448252ba503af274861a0b843f0ef210) Thanks [@ayden94](https://github.com/ayden94)! - Preserve downstream streaming failures when best-effort upstream cancellation cleanup also fails.

- [#3473](https://github.com/fluojs/fluo/pull/3473) [`96a7fc1`](https://github.com/fluojs/fluo/commit/96a7fc1fdfbedae7cbc0d18a80836e9bcc7418fc) Thanks [@ayden94](https://github.com/ayden94)! - Fix GraphQL endpoint middleware registration through module metadata so `GraphqlModule.forRoot()` consistently dispatches requests through the application pipeline.

- [#3021](https://github.com/fluojs/fluo/pull/3021) [`fb4dd53`](https://github.com/fluojs/fluo/commit/fb4dd5322bf1cb692e82fde46301797553e3fe69) Thanks [@ayden94](https://github.com/ayden94)! - Release cross-realm GraphQL runtime object allowances when an application shuts down or fails to bootstrap without disturbing other active GraphQL applications.

- [#3481](https://github.com/fluojs/fluo/pull/3481) [`90e039f`](https://github.com/fluojs/fluo/commit/90e039ff3ffc109a9e775186c5393c656ed37156) Thanks [@ayden94](https://github.com/ayden94)! - Retain failed GraphQL HTTP and WebSocket cleanup owners for shutdown retry, and report every remaining teardown failure together.

- [#3461](https://github.com/fluojs/fluo/pull/3461) [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409) Thanks [@ayden94](https://github.com/ayden94)! - Route HTTP and GraphQL DTO metadata reads through `@fluojs/core/request-pipeline` so first-party request processing remains on the documented integration seam.

- [#2776](https://github.com/fluojs/fluo/pull/2776) [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995) Thanks [@ayden94](https://github.com/ayden94)! - Raise the package-owned `ws` dependency to 8.21.0 or newer for optional GraphQL-over-WebSocket subscriptions. Refresh consumer lockfiles when upgrading so the patched runtime is installed.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`8b63f78`](https://github.com/fluojs/fluo/commit/8b63f78b87f4cd28c040d4a5bf50bb26501b5b7d), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`4f89ac4`](https://github.com/fluojs/fluo/commit/4f89ac4dc77169badb160804d86f78d612989af4), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`758fa42`](https://github.com/fluojs/fluo/commit/758fa42f64317751123d5a9ff8e03c414fc20fb2), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`2cce586`](https://github.com/fluojs/fluo/commit/2cce58646b5b10e6fb39c4b54c1d74734e7308c5), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`5e59219`](https://github.com/fluojs/fluo/commit/5e59219c5346d9fa3d70719f7204fcf5e9f602f6), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`5dec76e`](https://github.com/fluojs/fluo/commit/5dec76e05a229b4ef52d112fd593bc167e650a3c), [`08ea346`](https://github.com/fluojs/fluo/commit/08ea346cdfb087da050f961cdb4d5841dc922e51), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/http@3.0.0
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0
  - @fluojs/validation@2.0.0

## 1.1.0

### Minor Changes

- [#2719](https://github.com/fluojs/fluo/pull/2719) [`40436a6`](https://github.com/fluojs/fluo/commit/40436a600fa0a8f40bcd53f07d58395610990877) Thanks [@ayden94](https://github.com/ayden94)! - Add code-first object field resolvers with `FieldResolver`, `Parent`, and `Context` standard method decorators.

### Patch Changes

- [#2702](https://github.com/fluojs/fluo/pull/2702) [`553fb51`](https://github.com/fluojs/fluo/commit/553fb516adf8c2fd2ecbd907b69fc191864f90f3) Thanks [@ayden94](https://github.com/ayden94)! - Align the documented GraphQL runtime boundary with the effective mandatory dependency floor by requiring Node.js 20.16.0 or newer and treating Bun, Deno, and Cloudflare Workers as unsupported until native runtime verification exists.
  Migration guidance: consumers on Node.js below 20.19.3, Node.js 21, or Node.js 22.0.0 through 22.1.9 must upgrade to Node.js 20.19.3+ or 22.2.0+ before installing the current package.

- [#2318](https://github.com/fluojs/fluo/pull/2318) [`df0886f`](https://github.com/fluojs/fluo/commit/df0886f96cef6f7c87031630654db7c620cf112d) Thanks [@ayden94](https://github.com/ayden94)! - Dispose request-scoped websocket operation providers when GraphQL clients disconnect before subscription completion.

- [#2308](https://github.com/fluojs/fluo/pull/2308) [`da020c2`](https://github.com/fluojs/fluo/commit/da020c2dc3ff2dfc0468ed7ddd5c552dc389dfb0) Thanks [@ayden94](https://github.com/ayden94)! - Keep GraphQL/Yoga HTTP and SSE loading on Web-standard request/response imports within the supported Node.js 20.16.0+ package boundary, while keeping the Node-only `graphql-ws`/`ws` upgrade transport behind the opt-in websocket subscription path.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`2c09f35`](https://github.com/fluojs/fluo/commit/2c09f3541a6ffb33a26e045f531fbecbabd5dfe7), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`94f6518`](https://github.com/fluojs/fluo/commit/94f6518bf26b6bb412759c48d043e05e153ce533), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/validation@1.0.6
  - @fluojs/core@1.1.0

## 1.0.4

### Patch Changes

- [#2075](https://github.com/fluojs/fluo/pull/2075) [`a0537cf`](https://github.com/fluojs/fluo/commit/a0537cf1a75a45b3392cc4558db32646ca7fb280) Thanks [@ayden94](https://github.com/ayden94)! - Keep the root GraphQL package import portable by loading websocket transport dependencies only when websocket subscriptions are enabled.

- Updated dependencies [[`06f35cb`](https://github.com/fluojs/fluo/commit/06f35cbef3a0343a6745e658c120eb19d15d4480), [`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/http@1.1.1
  - @fluojs/runtime@1.1.7

## 1.0.3

### Patch Changes

- [#1987](https://github.com/fluojs/fluo/pull/1987) [`bde2330`](https://github.com/fluojs/fluo/commit/bde2330a6fe833ef7447a668cdf984c51ca9d1f9) Thanks [@ayden94](https://github.com/ayden94)! - Harden OpenAPI descriptor and document snapshots so caller-owned descriptor mutations and served-document mutations cannot alter generated module state.
  Document and test the adjacent GraphQL websocket shutdown and cache Redis namespace contracts covered by the request-pipeline audit.
- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`45b50e6`](https://github.com/fluojs/fluo/commit/45b50e649b5f3a833555523c20b11d3bb0a07f5b), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/validation@1.0.4
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0

## 1.0.2

### Patch Changes

- [#1866](https://github.com/fluojs/fluo/pull/1866) [`287644c`](https://github.com/fluojs/fluo/commit/287644c535de02e340cb54fab06d56d96952852d) Thanks [@ayden94](https://github.com/ayden94)! - Clarify GraphQL runtime portability boundaries and document resolver-visible context fields, including HTTP principals, custom context values, websocket connection params, and subscription cleanup coverage.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1
  - @fluojs/validation@1.0.1

## 1.0.0

### Minor Changes

- 10d7b6b: Narrow the public GraphQL contract to executable `GraphQLSchema` integration and reject the unsupported resolver `topics` option instead of silently ignoring it.

### Patch Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- b35576b: Align resolver input and request-scoped lifecycle contracts with focused regression coverage and package documentation.
- 5b97a76: Restore GraphQL's patched instance helper on shutdown and cancel streaming GraphQL response bodies when downstream streams close or error, preventing long-lived subscription resources from leaking.
- 17eddf8: Restore the temporary GraphQL `instanceOf` monkey patch when application bootstrap fails, preventing failed startups from leaking process-wide GraphQL behavior into later app attempts.
- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [b15ac1b]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [aaab8c4]
- Updated dependencies [65a08db]
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
- Updated dependencies [d3504c6]
- Updated dependencies [8422e56]
  - @fluojs/http@1.0.0
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0
  - @fluojs/validation@1.0.0

## 1.0.0-beta.7

### Patch Changes

- [#1762](https://github.com/fluojs/fluo/pull/1762) [`17eddf8`](https://github.com/fluojs/fluo/commit/17eddf876bd5a8d6d7497430468112dce3ba8215) Thanks [@ayden94](https://github.com/ayden94)! - Restore the temporary GraphQL `instanceOf` monkey patch when application bootstrap fails, preventing failed startups from leaking process-wide GraphQL behavior into later app attempts.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74), [`7b50db8`](https://github.com/fluojs/fluo/commit/7b50db85e95e2341f82d006f1e665c2bbcebeaa5)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8
  - @fluojs/http@1.0.0-beta.11

## 1.0.0-beta.6

### Patch Changes

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5), [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/http@1.0.0-beta.10
  - @fluojs/validation@1.0.0-beta.3
  - @fluojs/runtime@1.0.0-beta.11

## 1.0.0-beta.5

### Patch Changes

- [#1503](https://github.com/fluojs/fluo/pull/1503) [`5b97a76`](https://github.com/fluojs/fluo/commit/5b97a7657889587a9e9d03245772d1d94c7d4ef9) Thanks [@ayden94](https://github.com/ayden94)! - Restore GraphQL's patched instance helper on shutdown and cancel streaming GraphQL response bodies when downstream streams close or error, preventing long-lived subscription resources from leaking.

- Updated dependencies [[`c5aebdf`](https://github.com/fluojs/fluo/commit/c5aebdfe141bda72a6701516c48ace0f5caf5ee2), [`1d43614`](https://github.com/fluojs/fluo/commit/1d4361416e56ec935d67da096ba8b72d3886f7ee), [`f086fa5`](https://github.com/fluojs/fluo/commit/f086fa58827617bda8bdef50e0b694bd5e85dfaa), [`f8d05fa`](https://github.com/fluojs/fluo/commit/f8d05fac610bd5a58c27f84e764338ee718c0a67), [`6b8e8a9`](https://github.com/fluojs/fluo/commit/6b8e8a9d2c6123d9a1ca2ec805ef4fde97d1f199), [`8422e56`](https://github.com/fluojs/fluo/commit/8422e566e4d22b466542ef457d36c2e99e1a634a)]:
  - @fluojs/core@1.0.0-beta.3
  - @fluojs/di@1.0.0-beta.6
  - @fluojs/runtime@1.0.0-beta.9
  - @fluojs/validation@1.0.0-beta.2

## 1.0.0-beta.4

### Minor Changes

- [#1451](https://github.com/fluojs/fluo/pull/1451) [`10d7b6b`](https://github.com/fluojs/fluo/commit/10d7b6bd2d87d49b8acdcfa33822db1ff17dfb8c) Thanks [@ayden94](https://github.com/ayden94)! - Narrow the public GraphQL contract to executable `GraphQLSchema` integration and reject the unsupported resolver `topics` option instead of silently ignoring it.

### Patch Changes

- Updated dependencies [[`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0), [`48a9f97`](https://github.com/fluojs/fluo/commit/48a9f9761c093e6622922719869a29a84f7d0079), [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27), [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946), [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/http@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.5
  - @fluojs/di@1.0.0-beta.5

## 1.0.0-beta.3

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75), [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c)]:
  - @fluojs/runtime@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/http@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#1361](https://github.com/fluojs/fluo/pull/1361) [`b35576b`](https://github.com/fluojs/fluo/commit/b35576bf0cc2ec1fc9721c5ea15b718b8b9da4e3) Thanks [@ayden94](https://github.com/ayden94)! - Align resolver input and request-scoped lifecycle contracts with focused regression coverage and package documentation.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
