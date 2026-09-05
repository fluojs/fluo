# @fluojs/prisma

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

### Minor Changes

- [#3609](https://github.com/fluojs/fluo/pull/3609) [`17b943e`](https://github.com/fluojs/fluo/commit/17b943ec3ca550a832801f82687d490fa79eb68b) Thanks [@ayden94](https://github.com/ayden94)! - Expose active outer service and manual transaction boundaries through Prisma platform status snapshots.

- [#3613](https://github.com/fluojs/fluo/pull/3613) [`c378726`](https://github.com/fluojs/fluo/commit/c3787268fa10004e1dac8864dba3b43c01f6112c) Thanks [@ayden94](https://github.com/ayden94)! - Export reusable async module registration and platform status snapshot input contracts.

### Patch Changes

- [#3594](https://github.com/fluojs/fluo/pull/3594) [`583c7fc`](https://github.com/fluojs/fluo/commit/583c7fcb28ed127ced8ac05eff5bd81fce2c4eb6) Thanks [@ayden94](https://github.com/ayden94)! - Correct Prisma README examples to include their required explicit dependencies.

- [#3606](https://github.com/fluojs/fluo/pull/3606) [`eeb915e`](https://github.com/fluojs/fluo/commit/eeb915e9f65dba01e518ddb85c5928f39374b282) Thanks [@ayden94](https://github.com/ayden94)! - Avoid duplicate Prisma disconnects when application shutdown lifecycle hooks retry.

- [#3602](https://github.com/fluojs/fluo/pull/3602) [`3315deb`](https://github.com/fluojs/fluo/commit/3315debb05f38b69645a6c396192e4a5736958b0) Thanks [@ayden94](https://github.com/ayden94)! - Preserve the published Node.js 20+ support contract without inheriting `@fluojs/runtime`'s narrower engine range.

- [#3015](https://github.com/fluojs/fluo/pull/3015) [`6f421dc`](https://github.com/fluojs/fluo/commit/6f421dc9e8313948166b9bd8a70a68bdd2c1bae7) Thanks [@ayden94](https://github.com/ayden94)! - Serialize overlapping Prisma connect and shutdown transitions so a late `$connect()` completion cannot restore readiness or transaction admission, and `$disconnect()` waits for the connect attempt to settle.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/http@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0

## 1.1.1

### Patch Changes

- [#2373](https://github.com/fluojs/fluo/pull/2373) [`f0bb1af`](https://github.com/fluojs/fluo/commit/f0bb1af6a46218762f40f76ec17b189e373ac34b) Thanks [@ayden94](https://github.com/ayden94)! - Harden default `@Transaction()` target resolution so it selects only branded Prisma service/facade handles, treats unavailable or throwing AsyncLocalStorage host lookups as a graceful unavailable transaction context, and documents the Node.js 20+ runtime boundary.

- [#2460](https://github.com/fluojs/fluo/pull/2460) [`220bf05`](https://github.com/fluojs/fluo/commit/220bf054272d0edb8b411da08f7b66b5ccfe92b0) Thanks [@ayden94](https://github.com/ayden94)! - Reject new outer manual `transaction(...)` and service `@Transaction()` boundaries after Prisma shutdown starts while preserving the existing drain-before-disconnect contract for already-open boundaries.

- [#2334](https://github.com/fluojs/fluo/pull/2334) [`39a38fc`](https://github.com/fluojs/fluo/commit/39a38fc064b149c176d81961ae5ee71d54fee2de) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Prisma transaction boundaries during shutdown by draining active service/manual transactions before disconnect, and avoid binding `@Transaction()` to non-Prisma transaction-like host properties.

- [#2674](https://github.com/fluojs/fluo/pull/2674) [`71d83f1`](https://github.com/fluojs/fluo/commit/71d83f13c4264ceeaaba05111eb9e3f33c5ce371) Thanks [@ayden94](https://github.com/ayden94)! - Restore the governed `Unreleased` changelog placeholder for persistence packages and preserve it when Changesets generates future package versions.

- [#2659](https://github.com/fluojs/fluo/pull/2659) [`4781600`](https://github.com/fluojs/fluo/commit/47816000b85ac0c1c817ed2783736c5eed8387d2) Thanks [@ayden94](https://github.com/ayden94)! - Restore the deprecated Prisma and Mongoose transaction interceptor exports for 1.x compatibility while keeping service transactions and explicit request boundaries as the preferred migration path.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/core@1.1.0

## 1.1.0

### Minor Changes

- [#2089](https://github.com/fluojs/fluo/pull/2089) [`0e0348b`](https://github.com/fluojs/fluo/commit/0e0348b11ec2ad1e33b7aef26b3af40a3b5ac50d) Thanks [@ayden94](https://github.com/ayden94)! - Add a Prisma service `Transaction` decorator and current-less client delegate facade.

  Remove the previously exported `PrismaTransactionInterceptor`; use `@Transaction()` or explicit `requestTransaction()` boundaries instead.

### Patch Changes

- [#2123](https://github.com/fluojs/fluo/pull/2123) [`50b282f`](https://github.com/fluojs/fluo/commit/50b282f569b1a0b2d2dbf3822f8c5d3f78f37ed5) Thanks [@ayden94](https://github.com/ayden94)! - Expose a typed Prisma service facade for direct generated delegate calls and align Prisma documentation with the runtime facade contract.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## 1.0.2

### Patch Changes

- [#2022](https://github.com/fluojs/fluo/pull/2022) [`d69612a`](https://github.com/fluojs/fluo/commit/d69612a2fb13b884eacc7a4ef04cd37bf215c7aa) Thanks [@ayden94](https://github.com/ayden94)! - Redact sensitive refresh-token backing store diagnostics in passport status surfaces and remove Prisma's static Node async-hooks import while preserving transaction context behavior where host AsyncLocalStorage is available. Prisma now rejects transaction boundaries and reports `transactionContext: 'unavailable'` instead of using a synchronous fallback that can lose context across async boundaries when the host cannot provide AsyncLocalStorage.

- [#2008](https://github.com/fluojs/fluo/pull/2008) [`225759e`](https://github.com/fluojs/fluo/commit/225759e3103d0e7581ceec93694980623c037a78) Thanks [@ayden94](https://github.com/ayden94)! - Tighten persistence module registration input validation and document strict transaction handling for Mongoose connection-level transaction boundaries.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.1

### Patch Changes

- [#1996](https://github.com/fluojs/fluo/pull/1996) [`6e92478`](https://github.com/fluojs/fluo/commit/6e924781c31d4be551ec3f3a9a196a07dc637940) Thanks [@ayden94](https://github.com/ayden94)! - Report Prisma created/pre-connect snapshots as not-ready, align nested request transaction tracking docs, and keep validation as a test-only dependency.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0

## 1.0.0

### Major Changes

- de78f42: Remove the `PrismaModule.forName` and `PrismaModule.forNameAsync` convenience aliases. Register named Prisma clients through `PrismaModule.forRoot({ name, ... })` or `PrismaModule.forRootAsync({ name, ... })` instead.

### Minor Changes

- ea08719: Add explicit named PrismaModule registrations so one fluo application container can safely resolve multiple Prisma clients with isolated service, client, and options tokens.
- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- 9f168b1: Ensure request-scoped transaction bookkeeping is released when Prisma transaction validation fails before the request transaction starts.
- 49c22da: Reject new request-scoped Prisma transactions after shutdown starts and keep nested request transaction cleanup visible until the outer manual transaction settles.
- b6f8754: Clarify public Prisma DI tokens versus internal normalized module tokens, and document the nested transaction option guard with regression coverage.
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

## 1.0.0-beta.6

### Patch Changes

- [#1816](https://github.com/fluojs/fluo/pull/1816) [`49c22da`](https://github.com/fluojs/fluo/commit/49c22da803c716abe637389b2cd8c07a05a4b931) Thanks [@ayden94](https://github.com/ayden94)! - Reject new request-scoped Prisma transactions after shutdown starts and keep nested request transaction cleanup visible until the outer manual transaction settles.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74), [`7b50db8`](https://github.com/fluojs/fluo/commit/7b50db85e95e2341f82d006f1e665c2bbcebeaa5)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8
  - @fluojs/http@1.0.0-beta.11

## 1.0.0-beta.5

### Patch Changes

- [#1696](https://github.com/fluojs/fluo/pull/1696) [`9f168b1`](https://github.com/fluojs/fluo/commit/9f168b1121760b8e32faee34332cc4590008fdff) Thanks [@ayden94](https://github.com/ayden94)! - Ensure request-scoped transaction bookkeeping is released when Prisma transaction validation fails before the request transaction starts.

- [#1656](https://github.com/fluojs/fluo/pull/1656) [`b6f8754`](https://github.com/fluojs/fluo/commit/b6f8754e3d3247b29c412b5b5b20353ac60115a8) Thanks [@ayden94](https://github.com/ayden94)! - Clarify public Prisma DI tokens versus internal normalized module tokens, and document the nested transaction option guard with regression coverage.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`b15ac1b`](https://github.com/fluojs/fluo/commit/b15ac1bacccf53b39862ef0243182107840e9a3a), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`65a08db`](https://github.com/fluojs/fluo/commit/65a08db23814e2234bf5739fecf04f710b02a996), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/validation@1.0.0-beta.4
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.4

### Major Changes

- [#1571](https://github.com/fluojs/fluo/pull/1571) [`de78f42`](https://github.com/fluojs/fluo/commit/de78f42839c54af97369c37e6fc1cc7985b9f5fb) Thanks [@ayden94](https://github.com/ayden94)! - Remove the `PrismaModule.forName` and `PrismaModule.forNameAsync` convenience aliases. Register named Prisma clients through `PrismaModule.forRoot({ name, ... })` or `PrismaModule.forRootAsync({ name, ... })` instead.

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

## 1.0.0-beta.2

### Minor Changes

- [#1421](https://github.com/fluojs/fluo/pull/1421) [`ea08719`](https://github.com/fluojs/fluo/commit/ea08719da615cf60bcd6d9ac848c0d19f8ac538a) Thanks [@ayden94](https://github.com/ayden94)! - Add explicit named PrismaModule registrations so one fluo application container can safely resolve multiple Prisma clients with isolated service, client, and options tokens.

### Patch Changes

- Updated dependencies [[`01d5e65`](https://github.com/fluojs/fluo/commit/01d5e65f053db99704d9cb30585c75b94dd38367), [`1911e11`](https://github.com/fluojs/fluo/commit/1911e110e7dbb5296238ccc0a2e167ed6f34df86), [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6), [`89f6379`](https://github.com/fluojs/fluo/commit/89f637935736c0fe9c52668a5b714c5c0e394af1), [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d)]:
  - @fluojs/http@1.0.0-beta.3
  - @fluojs/di@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.4
