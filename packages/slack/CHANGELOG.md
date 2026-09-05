# @fluojs/slack

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3612](https://github.com/fluojs/fluo/pull/3612) [`dbd704e`](https://github.com/fluojs/fluo/commit/dbd704ed981a4de99aa705e0a276bfef8429ac73) Thanks [@ayden94](https://github.com/ayden94)! - Declare the package-owned Node.js support range `>=24.0.0 <27` for `@fluojs/slack` in the upcoming coordinated release. The portable `@fluojs/runtime` package no longer supplies a transitive Node engine requirement.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

- [#3603](https://github.com/fluojs/fluo/pull/3603) [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976) Thanks [@ayden94](https://github.com/ayden94)! - **Breaking change:** Node response `send()` now rejects when compression fails before the
  response commits. Dispatcher-managed requests recover with the standard JSON 500 envelope.

  Migration: Await and handle Node response `send()` rejections in adapter integrations. The
  fallback removes only the adapter-assigned default `Content-Type`, so its JSON envelope uses
  `application/json`; application-owned explicit `Content-Type` values remain unchanged.
  Node integration packages own their Node support contract; the portable runtime root has no package-wide Node engine. Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

### Patch Changes

- [#3030](https://github.com/fluojs/fluo/pull/3030) [`ffcf18e`](https://github.com/fluojs/fluo/commit/ffcf18ebdc6de3732f57e6658c5391bb4e4d7d32) Thanks [@ayden94](https://github.com/ayden94)! - Keep factory-owned Slack transports open until bootstrap verification settles before shutdown cleanup closes them.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- Updated dependencies [[`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`0c977f1`](https://github.com/fluojs/fluo/commit/0c977f164a650e33e058b18489e9d37ba44ea298), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`65e1b87`](https://github.com/fluojs/fluo/commit/65e1b87934b8351ea0e860085a63f147b47b7ef7), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`dbd704e`](https://github.com/fluojs/fluo/commit/dbd704ed981a4de99aa705e0a276bfef8429ac73), [`cfc9fcf`](https://github.com/fluojs/fluo/commit/cfc9fcfc016c2fbb12e7b1c3ab26311282f3eb21), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`0ed3cc0`](https://github.com/fluojs/fluo/commit/0ed3cc041f656e2a1b3b0912b898feb063d2dc0c), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`0d1aca9`](https://github.com/fluojs/fluo/commit/0d1aca91d45db68861821481c36327e155f829f7), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`7255c0d`](https://github.com/fluojs/fluo/commit/7255c0dc96d465d61eead1a3d6c30f5a2e1fadce), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0
  - @fluojs/notifications@2.0.0

## 1.1.4

### Patch Changes

- [#2307](https://github.com/fluojs/fluo/pull/2307) [`6e3bb42`](https://github.com/fluojs/fluo/commit/6e3bb424343f5249d7261c00ad949bc3c7d55d01) Thanks [@ayden94](https://github.com/ayden94)! - Close factory-owned Slack transports when bootstrap verification fails after the transport has already been created.

- [#2611](https://github.com/fluojs/fluo/pull/2611) [`1e7988b`](https://github.com/fluojs/fluo/commit/1e7988b770e8e51ffac8b39b71cafa2722c6691a) Thanks [@ayden94](https://github.com/ayden94)! - Drain active Slack deliveries before closing factory-owned transports during application shutdown.

- [#2621](https://github.com/fluojs/fluo/pull/2621) [`f7db1be`](https://github.com/fluojs/fluo/commit/f7db1be5100da2cfcc4b2232e18048aea1e3abae) Thanks [@ayden94](https://github.com/ayden94)! - Preserve caller cancellation across tolerant Slack batches and notification-channel delivery.

- [#2624](https://github.com/fluojs/fluo/pull/2624) [`0bf4841`](https://github.com/fluojs/fluo/commit/0bf484123ac5134a2175833f1d51d2523425809f) Thanks [@ayden94](https://github.com/ayden94)! - Preserve renderer and subject text fallbacks when notification payload text is blank.

- [#2628](https://github.com/fluojs/fluo/pull/2628) [`03e0bf5`](https://github.com/fluojs/fluo/commit/03e0bf52ead6adf047f702aea7407f1b8f991caa) Thanks [@ayden94](https://github.com/ayden94)! - Consume transient webhook response bodies before retrying delivery.

- [#2309](https://github.com/fluojs/fluo/pull/2309) [`a7d9206`](https://github.com/fluojs/fluo/commit/a7d9206f4a9477ecb343159e223eb37dd466e506) Thanks [@ayden94](https://github.com/ayden94)! - Reject Slack notification dispatches that include multiple non-empty recipients even when the payload also supplies a channel, preserving the documented one-destination boundary.

- [#2384](https://github.com/fluojs/fluo/pull/2384) [`0105a6a`](https://github.com/fluojs/fluo/commit/0105a6a14564e856bf104a436bf65fdc3743e659) Thanks [@ayden94](https://github.com/ayden94)! - Resolve Slack async module options through each application container so reusing one `SlackModule.forRootAsync(...)` module definition cannot leak resolved or rejected configuration across app boundaries.

- [#2380](https://github.com/fluojs/fluo/pull/2380) [`436cace`](https://github.com/fluojs/fluo/commit/436cace4097711b9be480854da3b55881c8d2b51) Thanks [@ayden94](https://github.com/ayden94)! - Gate Slack direct and notification-backed delivery on completed module readiness so bootstrap transport creation and optional verification finish before any provider handoff.

- [#2485](https://github.com/fluojs/fluo/pull/2485) [`20214b1`](https://github.com/fluojs/fluo/commit/20214b1385073c714d0cbe8f735f894dd5e782a8) Thanks [@ayden94](https://github.com/ayden94)! - Serialize factory-owned Slack transport cleanup across bootstrap failure and shutdown, document singleton provider wiring and public error failure modes, and add lifecycle regression coverage.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a1dcd40`](https://github.com/fluojs/fluo/commit/a1dcd401e72c1a9b15400c0e55b578bb48a32d3b), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/core@1.1.0
  - @fluojs/notifications@1.0.3

## 1.1.3

### Patch Changes

- [#2049](https://github.com/fluojs/fluo/pull/2049) [`c21d4fa`](https://github.com/fluojs/fluo/commit/c21d4fa2011542818bb9ab19006a35d492021c46) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Slack abort, shutdown, and webhook retry contracts by checking already-aborted empty batches, making owned transport shutdown idempotent, and avoiding transient retry response body reads before retry decisions.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1)]:
  - @fluojs/di@1.1.0
  - @fluojs/runtime@1.1.6

## 1.1.2

### Patch Changes

- [#2025](https://github.com/fluojs/fluo/pull/2025) [`223aa65`](https://github.com/fluojs/fluo/commit/223aa65135466d7c670186e3f18a6910fcab843a) Thanks [@ayden94](https://github.com/ayden94)! - Harden messaging and realtime lifecycle contracts by documenting Slack webhook ambient fetch fallback while preserving the existing optional fetch API, preventing Socket.IO raw server recreation after shutdown starts, preserving portable Socket.IO guard request typing, and deferring Queue metadata setup until decorator execution.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.1.1

### Patch Changes

- [#1983](https://github.com/fluojs/fluo/pull/1983) [`e0c855e`](https://github.com/fluojs/fluo/commit/e0c855eee03d8b59e19420ea1c22ee73ef66fe44) Thanks [@ayden94](https://github.com/ayden94)! - Align notification provider delivery semantics by closing owned email transports when bootstrap verification fails, documenting Slack abort/retry handling and Discord direct batch fan-out boundaries, and strengthening notification dependency diagnostics coverage.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`e0c855e`](https://github.com/fluojs/fluo/commit/e0c855eee03d8b59e19420ea1c22ee73ef66fe44)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/notifications@1.0.1

## 1.1.0

### Minor Changes

- [#1869](https://github.com/fluojs/fluo/pull/1869) [`41b2e38`](https://github.com/fluojs/fluo/commit/41b2e3862380f8e823e542b2e2c0279b7e4e87c8) Thanks [@ayden94](https://github.com/ayden94)! - Require `fetch` when creating the built-in Slack webhook transport so delivery uses an explicit runtime boundary, and align the public API documentation with the exported option/template contracts.

### Patch Changes

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`d23049a`](https://github.com/fluojs/fluo/commit/d23049a59a49bdaea110a5f542ae18606c782db8), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.2
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.2

## 1.0.0

### Minor Changes

- 7db5223: Add lifecycle-gated email and Slack delivery failures once shutdown begins so factory-owned notification transports are not reused or recreated during teardown, and expose lifecycle error classes for callers that handle send/shutdown races.
- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- 9c46186: Stop retrying permanent Slack webhook HTTP failures (such as 403, 404).

  Previously, the built-in webhook transport would mistakenly retry all errors if the attempt count had not been exhausted, ignoring the intent to only retry transient (408, 429, 5xx) failures. Now, non-transient HTTP errors correctly throw `SlackTransportError` immediately, aligning with the documented behavioral contract.

- da9e66b: Preserve Slack transport lifecycle ownership and tutorial status snapshot contracts with focused regression coverage and aligned package/book documentation.
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
- Updated dependencies [3785a42]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [aaab8c4]
- Updated dependencies [93fc34b]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [53a2b8e]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [8fb13ad]
- Updated dependencies [512bfd7]
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

## 1.0.0-beta.5

### Minor Changes

- [#1761](https://github.com/fluojs/fluo/pull/1761) [`7db5223`](https://github.com/fluojs/fluo/commit/7db522316b8204f80631e2594afbe9d6f9093382) Thanks [@ayden94](https://github.com/ayden94)! - Add lifecycle-gated email and Slack delivery failures once shutdown begins so factory-owned notification transports are not reused or recreated during teardown, and expose lifecycle error classes for callers that handle send/shutdown races.

### Patch Changes

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`512bfd7`](https://github.com/fluojs/fluo/commit/512bfd7edabd1d906e1964c0ecf5d7041d2f0477)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8
  - @fluojs/notifications@1.0.0-beta.5

## 1.0.0-beta.4

### Patch Changes

- [#1649](https://github.com/fluojs/fluo/pull/1649) [`9c46186`](https://github.com/fluojs/fluo/commit/9c461866856fc75d24c31c1641aab0fea7d375fe) Thanks [@ayden94](https://github.com/ayden94)! - Stop retrying permanent Slack webhook HTTP failures (such as 403, 404).

  Previously, the built-in webhook transport would mistakenly retry all errors if the attempt count had not been exhausted, ignoring the intent to only retry transient (408, 429, 5xx) failures. Now, non-transient HTTP errors correctly throw `SlackTransportError` immediately, aligning with the documented behavioral contract.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`3785a42`](https://github.com/fluojs/fluo/commit/3785a42a2206104fe3f799394446fd99ef9fb7d2), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`8fb13ad`](https://github.com/fluojs/fluo/commit/8fb13ad86cdb78d4a7a0316c68aa75d6b317b69a), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/notifications@1.0.0-beta.4
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- Updated dependencies [[`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299)]:
  - @fluojs/notifications@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#1357](https://github.com/fluojs/fluo/pull/1357) [`da9e66b`](https://github.com/fluojs/fluo/commit/da9e66b54cbf5404b1526258d2d06e3dc9235462) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Slack transport lifecycle ownership and tutorial status snapshot contracts with focused regression coverage and aligned package/book documentation.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/notifications@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
