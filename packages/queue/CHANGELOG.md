# @fluojs/queue

## [Unreleased]

## 3.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3573](https://github.com/fluojs/fluo/pull/3573) [`3c7e09d`](https://github.com/fluojs/fluo/commit/3c7e09d470d7a8d2de99db00a10015354cc4fb5a) Thanks [@ayden94](https://github.com/ayden94)! - Clarify that Queue producers must enqueue an instance of the exact `JobClass` constructor registered by `@QueueWorker`; name-and-payload producer dispatch is not supported.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Replace NestJS Bull/BullMQ `queue.add(name, plainPayload)` calls with `queue.enqueue(new JobClass(...))`, importing the same exported job class used by the registered worker. Plain payload objects and duplicate class declarations type-check but are rejected at runtime.

- [#3589](https://github.com/fluojs/fluo/pull/3589) [`97f20bb`](https://github.com/fluojs/fluo/commit/97f20bbc7ca3af01f6738ab38ad554f9e9bb664e) Thanks [@ayden94](https://github.com/ayden94)! - Fail bootstrap when multiple singleton `@QueueWorker()` registrations own the same job class or effective `jobName`. Give each worker a unique job class and job name, or consolidate handlers behind one `handle(job)` method.

- [#3530](https://github.com/fluojs/fluo/pull/3530) [`90631a8`](https://github.com/fluojs/fluo/commit/90631a83b50209ab317af04fe6ea415282a9d7de) Thanks [@ayden94](https://github.com/ayden94)! - Declare the package-owned Node.js support range `>=24.0.0 <27` for `@fluojs/queue` in the upcoming coordinated release. The portable `@fluojs/runtime` package no longer supplies a transitive Node engine requirement.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

- [#3578](https://github.com/fluojs/fluo/pull/3578) [`cebc230`](https://github.com/fluojs/fluo/commit/cebc2304da92856c1ec148401d6aa496a34163cb) Thanks [@ayden94](https://github.com/ayden94)! - Reject duplicate default and trimmed named `RedisModule.forRoot(...)` registration identities during bootstrap before a Redis client is created.

  Migration: Register the unnamed default Redis client at most once, and give every additional Redis registration a distinct trimmed `name`. Consumers using `@fluojs/cache-manager`, `@fluojs/cron`, `@fluojs/email`, `@fluojs/queue`, `@fluojs/terminus`, or `@fluojs/throttler` with Redis must use the corresponding major release.

### Minor Changes

- [#3655](https://github.com/fluojs/fluo/pull/3655) [`976b757`](https://github.com/fluojs/fluo/commit/976b757de636aa0f27889d3fd371b4e2e2fd7899) Thanks [@ayden94](https://github.com/ayden94)! - Add an optional caller-owned `deduplicationKey` to `enqueue(...)`, mapped to a BullMQ-safe job id so repeated producer attempts can use idempotency without inheriting BullMQ custom-id restrictions.

- [#3665](https://github.com/fluojs/fluo/pull/3665) [`fef6b19`](https://github.com/fluojs/fluo/commit/fef6b196c726f534c42ec654c57827f352d4f877) Thanks [@ayden94](https://github.com/ayden94)! - Add atomic ordered `enqueueMany(...)` batches to Queue and use them for built-in email notification batches, preserving each notification identity as its backing-queue deduplication key.

- [#3018](https://github.com/fluojs/fluo/pull/3018) [`3ce24b7`](https://github.com/fluojs/fluo/commit/3ce24b720f1ddfc52afbf499d3ad800c00e435b4) Thanks [@ayden94](https://github.com/ayden94)! - Add application-supplied BullMQ `ownershipNamespace` validation for cross-scope worker ownership. Queue now groups collisions by `(ownershipNamespace, jobName)` rather than the DI-only `clientName`; unconfigured identities emit 2.x compatibility diagnostics by default, and `ownershipEnforcement: 'reject'` opts into bootstrap rejection before BullMQ resources are created.

### Patch Changes

- [#3019](https://github.com/fluojs/fluo/pull/3019) [`a7223a1`](https://github.com/fluojs/fluo/commit/a7223a198e5d893557c5e04c8ef1ed53c6063723) Thanks [@ayden94](https://github.com/ayden94)! - Bound BullMQ worker force-close attempts to `workerShutdownTimeoutMs` so Queue shutdown continues closing owned queues and Redis connections when force-close never settles.

- [#3597](https://github.com/fluojs/fluo/pull/3597) [`51a8bc7`](https://github.com/fluojs/fluo/commit/51a8bc761a750dc4229713284e786dbf3618f5f8) Thanks [@ayden94](https://github.com/ayden94)! - Bound Queue-owned BullMQ queue and Redis connection shutdown to `workerShutdownTimeoutMs`, continuing cleanup and force-disconnecting a timed-out owned Redis connection.

- [#3569](https://github.com/fluojs/fluo/pull/3569) [`1256356`](https://github.com/fluojs/fluo/commit/125635679674043739faf4da17edb5cfe649bf1f) Thanks [@ayden94](https://github.com/ayden94)! - Use the marker-aware registration context to detect duplicate scopes during bootstrap.

  `QueueLifecycleService` previously counted duplicate queue scopes using a structural check (`moduleType` function + `scope` string) that matched any `useValue` provider with those two fields. An unrelated application provider that happened to have the same shape and the same scope string as a real queue registration could trigger a false "duplicate scope" bootstrap failure.

  The marker-backed scope scan in `worker-ownership.ts` (`collectQueueModuleContexts` + `assertUniqueQueueScopes`) already runs in the same module factory before the service is constructed, so the service-level redundant scan has been removed. Queue registrations without the `QUEUE_MODULE_CONTEXT_MARKER` symbol are no longer counted.

- [#2776](https://github.com/fluojs/fluo/pull/2776) [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995) Thanks [@ayden94](https://github.com/ayden94)! - Raise BullMQ to 5.81.1 or newer so consumers install its patched dependency graph. Refresh application lockfiles when upgrading; queue registration, worker discovery, and persisted-job contracts are unchanged.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- Updated dependencies [[`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`c69aa43`](https://github.com/fluojs/fluo/commit/c69aa43c951398a34ab6593479e9785f1adf4c18), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`cebc230`](https://github.com/fluojs/fluo/commit/cebc2304da92856c1ec148401d6aa496a34163cb), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0
  - @fluojs/redis@2.0.0

## 2.0.0

### Major Changes

- [#2297](https://github.com/fluojs/fluo/pull/2297) [`471c923`](https://github.com/fluojs/fluo/commit/471c92379dcb55946b6ae6b2522f9544a14d9a52) Thanks [@ayden94](https://github.com/ayden94)! - Drain pending queue dead-letter writes during worker startup rollback before releasing Redis lifecycle state, and harden scoped queue registrations with explicit unique scopes, scoped public token helpers, and module-graph Redis visibility checks.

- [#2476](https://github.com/fluojs/fluo/pull/2476) [`1f8896a`](https://github.com/fluojs/fluo/commit/1f8896a632932d968c988f77dbcdf6629adca81f) Thanks [@ayden94](https://github.com/ayden94)! - Harden scoped queue module discovery so non-global registrations stay isolated to the module tree that imported their `QueueModule.forRoot(...)` call, and require the Redis client provider to be reachable from that same graph.

### Minor Changes

- [#2610](https://github.com/fluojs/fluo/pull/2610) [`7045978`](https://github.com/fluojs/fluo/commit/7045978594af410de6e14a638205084d3a30b465) Thanks [@ayden94](https://github.com/ayden94)! - Add bounded, read-only dead-letter inspection with newest-first typed records and malformed-record reporting.

### Patch Changes

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`9d70d61`](https://github.com/fluojs/fluo/commit/9d70d610dc447ac088533bcb7428af0b92bd6a7d), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`2190cbf`](https://github.com/fluojs/fluo/commit/2190cbf926309e6d9c40d173fa8fe7a9a23685be), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`6602fe0`](https://github.com/fluojs/fluo/commit/6602fe03d35dd2ba56669977d4d3af9deec96b21), [`f31435d`](https://github.com/fluojs/fluo/commit/f31435d980dca14051b462d3ad1940b94c994d52), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/redis@1.1.0
  - @fluojs/core@1.1.0

## 1.0.2

### Patch Changes

- [#2235](https://github.com/fluojs/fluo/pull/2235) [`9735d6d`](https://github.com/fluojs/fluo/commit/9735d6d560525c7e9345a7a1deb221469c56c07d) Thanks [@ayden94](https://github.com/ayden94)! - Fix non-global queue worker discovery so scoped registrations only start workers visible to the importing module graph, and roll back queue-owned BullMQ resources immediately when worker startup fails after bootstrap readiness.

- [#2110](https://github.com/fluojs/fluo/pull/2110) [`4d64d75`](https://github.com/fluojs/fluo/commit/4d64d758fb0f31c499cc5ea98cf802b8f0ec938b) Thanks [@ayden94](https://github.com/ayden94)! - Fix queue readiness snapshots so workers are only reported ready after BullMQ processors start, and expose worker start failures through lifecycle/status diagnostics.

  This is a readiness bug fix: status snapshots now distinguish worker startup failure from healthy startup and avoid reporting ready before BullMQ processors are actually running.

- Updated dependencies [[`050620e`](https://github.com/fluojs/fluo/commit/050620e22d83ccd45c35bf091a813e7445bb74ed), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/redis@1.0.2
  - @fluojs/runtime@1.1.8

## 1.0.1

### Patch Changes

- [#2025](https://github.com/fluojs/fluo/pull/2025) [`223aa65`](https://github.com/fluojs/fluo/commit/223aa65135466d7c670186e3f18a6910fcab843a) Thanks [@ayden94](https://github.com/ayden94)! - Harden messaging and realtime lifecycle contracts by documenting Slack webhook ambient fetch fallback while preserving the existing optional fetch API, preventing Socket.IO raw server recreation after shutdown starts, preserving portable Socket.IO guard request typing, and deferring Queue metadata setup until decorator execution.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b), [`b80fa9e`](https://github.com/fluojs/fluo/commit/b80fa9e22414cd7c6f55903fd999707109695017)]:
  - @fluojs/runtime@1.1.2
  - @fluojs/redis@1.0.1

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- 995a55f: Start Queue processors after the bootstrap-ready handoff, bound worker shutdown with `workerShutdownTimeoutMs`, and document the lifecycle/status options so stuck processors cannot block application shutdown indefinitely.
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
- Updated dependencies [f1a94b2]
- Updated dependencies [ea86ded]
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
  - @fluojs/redis@1.0.0

## 1.0.0-beta.5

### Patch Changes

- [#1625](https://github.com/fluojs/fluo/pull/1625) [`995a55f`](https://github.com/fluojs/fluo/commit/995a55f1571eb160fded3b0f7df0a37c672e1c94) Thanks [@ayden94](https://github.com/ayden94)! - Serialize queue shutdown with in-flight startup so queue-owned BullMQ workers, queues, and Redis duplicate connections are closed reliably during overlapping application lifecycle transitions.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`f1a94b2`](https://github.com/fluojs/fluo/commit/f1a94b2e184c8f4507294a826676d36b218a5bbb), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/redis@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.4

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- Updated dependencies [[`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299)]:
  - @fluojs/redis@1.0.0-beta.3

## 1.0.0-beta.3

### Patch Changes

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.11

## 1.0.0-beta.2

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75), [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c)]:
  - @fluojs/runtime@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3
