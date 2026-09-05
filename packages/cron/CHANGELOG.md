# @fluojs/cron

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

- [#3662](https://github.com/fluojs/fluo/pull/3662) [`46625a6`](https://github.com/fluojs/fluo/commit/46625a648b487a010c8358629e030598b217174e) Thanks [@ayden94](https://github.com/ayden94)! - Declare the package-owned Node.js support range `>=24.0.0 <27` for `@fluojs/cron` in the upcoming coordinated release. The portable `@fluojs/runtime` package no longer supplies a transitive Node engine requirement. Cron 3 retains its mandatory runtime 3 dependency.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

- [#3578](https://github.com/fluojs/fluo/pull/3578) [`cebc230`](https://github.com/fluojs/fluo/commit/cebc2304da92856c1ec148401d6aa496a34163cb) Thanks [@ayden94](https://github.com/ayden94)! - Reject duplicate default and trimmed named `RedisModule.forRoot(...)` registration identities during bootstrap before a Redis client is created.

  Migration: Register the unnamed default Redis client at most once, and give every additional Redis registration a distinct trimmed `name`. Consumers using `@fluojs/cache-manager`, `@fluojs/cron`, `@fluojs/email`, `@fluojs/queue`, `@fluojs/terminus`, or `@fluojs/throttler` with Redis must use the corresponding major release.

### Patch Changes

- [#2788](https://github.com/fluojs/fluo/pull/2788) [`f481552`](https://github.com/fluojs/fluo/commit/f481552eed76c795003c93252c09c38227bb045b) Thanks [@ayden94](https://github.com/ayden94)! - Bound post-task distributed lock release and its immediate shutdown retry to one `shutdown.timeoutMs` deadline while preserving unresolved local ownership visibility.

- [#3667](https://github.com/fluojs/fluo/pull/3667) [`02132e5`](https://github.com/fluojs/fluo/commit/02132e5a146c87c398048b2b5e47c863afa5e159) Thanks [@ayden94](https://github.com/ayden94)! - Expand NestJS schedule migration guidance.

- [#3658](https://github.com/fluojs/fluo/pull/3658) [`4581e54`](https://github.com/fluojs/fluo/commit/4581e54257db19c264ad270179f2db0d08b0c523) Thanks [@ayden94](https://github.com/ayden94)! - Prevent delayed distributed lock acquisition from starting a cron task after shutdown closes tick admission.

- [#3659](https://github.com/fluojs/fluo/pull/3659) [`3c9f221`](https://github.com/fluojs/fluo/commit/3c9f22175b3501e40aa46588913598d8618f6309) Thanks [@ayden94](https://github.com/ayden94)! - Prevent subclass scheduling decorators from mutating inherited task metadata.

- [#2827](https://github.com/fluojs/fluo/pull/2827) [`88fc44a`](https://github.com/fluojs/fluo/commit/88fc44ad9ca975bd5154e4da3eaac5a7c28e194a) Thanks [@ayden94](https://github.com/ayden94)! - Prevent late ticks from entering shutdown, fence distributed releases with per-acquisition lease tokens, and keep replacement schedules inactive until their previous handles stop successfully.

- [#2780](https://github.com/fluojs/fluo/pull/2780) [`8a0639d`](https://github.com/fluojs/fluo/commit/8a0639deea1d5122b73ddd88a0ac7043dbd14c70) Thanks [@ayden94](https://github.com/ayden94)! - Retain scheduler handles when stopping a task fails so dynamic disable and removal report failure and can retry without losing lifecycle ownership.

- [#3022](https://github.com/fluojs/fluo/pull/3022) [`ba07e9b`](https://github.com/fluojs/fluo/commit/ba07e9b2ed019a8d36f2ed299830d33628bc0426) Thanks [@ayden94](https://github.com/ayden94)! - Retry retained Cron scheduler handles on the next shutdown lifecycle hook after a stop failure, clearing lifecycle ownership only once scheduler cleanup succeeds.

- [#3024](https://github.com/fluojs/fluo/pull/3024) [`039fd69`](https://github.com/fluojs/fluo/commit/039fd6940a6a876a7c95bcb6ba7105aad9d747db) Thanks [@ayden94](https://github.com/ayden94)! - Skip Redis lock release I/O after the Cron shutdown deadline expires while retaining unresolved local ownership for status reporting.

- Updated dependencies [[`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`c69aa43`](https://github.com/fluojs/fluo/commit/c69aa43c951398a34ab6593479e9785f1adf4c18), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`cebc230`](https://github.com/fluojs/fluo/commit/cebc2304da92856c1ec148401d6aa496a34163cb), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0
  - @fluojs/redis@2.0.0

## 2.0.1

### Patch Changes

- [#2758](https://github.com/fluojs/fluo/pull/2758) [`dedaf71`](https://github.com/fluojs/fluo/commit/dedaf71024b3bd7e77403a183e0e0916222554b1) Thanks [@ayden94](https://github.com/ayden94)! - Validate explicit Cron distributed `ownerId` before scheduler or Redis lifecycle setup.

  `CronModule.forRoot({ distributed: { ownerId } })` now trims the provided `ownerId` during module option normalization and rejects blank, empty, or non-string values before the scheduler or Redis distributed lock lifecycle begins. Previously, invalid or empty owner identifiers could enter Redis lock ownership state despite the distributed-lock contract. Applications that already pass a non-empty string `ownerId` are unaffected; applications relying on blank or whitespace-only `ownerId` values must now provide a valid stable owner identifier or omit `ownerId` to keep the platform-neutral default.

- Updated dependencies [[`65cc3a2`](https://github.com/fluojs/fluo/commit/65cc3a28457d58b75858ed33ab7280b09900db36)]:
  - @fluojs/runtime@2.0.1

## 2.0.0

### Major Changes

- [#2399](https://github.com/fluojs/fluo/pull/2399) [`c646d44`](https://github.com/fluojs/fluo/commit/c646d44cbfe7f34aa77505ba8c6948fc1c9e1481) Thanks [@ayden94](https://github.com/ayden94)! - Reject blank decorator scheduling task names, normalize distributed Redis client names, and cover cron lifecycle/status regression paths.

  Migration notes:

  - Replace blank decorator `name` values with stable non-empty names, and move any scheduled static methods behind public instance methods.
  - Remove leading or trailing whitespace from `distributed.clientName` and register the Redis client under that trimmed name, or omit `clientName` to keep using the default Redis registration.

- [#2481](https://github.com/fluojs/fluo/pull/2481) [`32f3a60`](https://github.com/fluojs/fluo/commit/32f3a609a2bb061fb4aebfddbb6545ca8a342212) Thanks [@ayden94](https://github.com/ayden94)! - Preserve distributed lock lifecycle contracts by validating enabled lock TTLs before Redis I/O, bounding shutdown lock release attempts, retaining local ownership when release I/O times out, and returning immutable scheduling descriptor snapshots.

  Migration notes:

  - Configure every enabled module-level `distributed.lockTtlMs` and enabled task-level `lockTtlMs` as an integer of at least `1_000ms` before module registration.
  - Treat values from `SchedulingRegistry.get()` and `getAll()` as immutable snapshots. Use `enable()`, `disable()`, `remove()`, `updateCronExpression()`, or `updateIntervalMs()` instead of mutating descriptors or scheduler handles.
  - Review `shutdown.timeoutMs` against expected Redis latency. Owned-lock release I/O now stops waiting at that boundary and preserves local ownership visibility when the release cannot be confirmed in time.

### Patch Changes

- [#2304](https://github.com/fluojs/fluo/pull/2304) [`d4d2af3`](https://github.com/fluojs/fluo/commit/d4d2af3b3c99c63dbc8561ffdd5ba52d10914148) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Redis distributed cron locks during startup rollback until active bootstrap-time ticks can drain and release ownership.

- [#2622](https://github.com/fluojs/fluo/pull/2622) [`aa0fd73`](https://github.com/fluojs/fluo/commit/aa0fd737e36e116a566fbd8a1122e211cb62dbbd) Thanks [@ayden94](https://github.com/ayden94)! - Make dynamic cron expression and interval cadence replacements roll back when the previous scheduler handle cannot be stopped, cleaning up the provisional replacement before restoring the prior descriptor and handle.

- [#2612](https://github.com/fluojs/fluo/pull/2612) [`26855dc`](https://github.com/fluojs/fluo/commit/26855dc3e19730bc4b5a9e4563d4e656e4efc00e) Thanks [@ayden94](https://github.com/ayden94)! - Ignore inactive task lock TTL overrides when distributed locking is disabled and call `unref()` on lock renewal timers so bounded shutdown can allow the Node.js process to exit.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/core@1.1.0

## 1.1.0

### Minor Changes

- [#2243](https://github.com/fluojs/fluo/pull/2243) [`a8594c6`](https://github.com/fluojs/fluo/commit/a8594c694d1674be80f407978a64155b2ab990cb) Thanks [@ayden94](https://github.com/ayden94)! - Add `SchedulingRegistry.updateIntervalMs(name, ms)` for rollback-safe runtime interval cadence updates.

### Patch Changes

- [#2124](https://github.com/fluojs/fluo/pull/2124) [`ae7a414`](https://github.com/fluojs/fluo/commit/ae7a4149b2b903e9f73a7428194804060635f191) Thanks [@ayden94](https://github.com/ayden94)! - Honor `options.name` as the registry key, scheduler metadata name, and default distributed lock key for dynamically registered cron, interval, and timeout tasks.

- [#2240](https://github.com/fluojs/fluo/pull/2240) [`1ee8874`](https://github.com/fluojs/fluo/commit/1ee8874317678e0a5dc41443456463a959e8be89) Thanks [@ayden94](https://github.com/ayden94)! - Harden distributed lock readiness and shutdown retry semantics so Redis lock I/O outages no longer report ready/healthy and timed-out task lock releases can be retried after the task settles.

- Updated dependencies [[`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/runtime@1.1.8

## 1.0.3

### Patch Changes

- [#2076](https://github.com/fluojs/fluo/pull/2076) [`035b94d`](https://github.com/fluojs/fluo/commit/035b94d2091cdb1e6cafda7cf0e4ae3288357111) Thanks [@ayden94](https://github.com/ayden94)! - Make Redis a distributed-lock-only dependency for `@fluojs/cron`. Non-distributed scheduling no longer loads the Redis peer during import, registration, bootstrap, or status snapshot creation.

- Updated dependencies [[`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/runtime@1.1.7

## 1.0.2

### Patch Changes

- [#1852](https://github.com/fluojs/fluo/pull/1852) [`a8aa3b1`](https://github.com/fluojs/fluo/commit/a8aa3b1ca99e26be9c094e00987ff0828f8fc1dd) Thanks [@ayden94](https://github.com/ayden94)! - Make dynamic cron registration and cron expression updates rollback-safe when scheduler startup fails, and document scheduler dependency ownership plus public registry/type contracts.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 240be94: Use platform-neutral default distributed lock owner IDs, retain local lock ownership after Redis release failures so shutdown can retry, and document cron expression portability plus distributed-lock drift/fencing caveats.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- d05ee13: Preserve active distributed cron locks when bounded shutdown times out so another node cannot start the same job while the original task is still running.
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

## 1.0.0-beta.6

### Patch Changes

- [#1632](https://github.com/fluojs/fluo/pull/1632) [`240be94`](https://github.com/fluojs/fluo/commit/240be9456a80759dc543eeeee93b4b453287630e) Thanks [@ayden94](https://github.com/ayden94)! - Use platform-neutral default distributed lock owner IDs, retain local lock ownership after Redis release failures so shutdown can retry, and document cron expression portability plus distributed-lock drift/fencing caveats.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`f1a94b2`](https://github.com/fluojs/fluo/commit/f1a94b2e184c8f4507294a826676d36b218a5bbb), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/redis@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.5

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- Updated dependencies [[`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299)]:
  - @fluojs/redis@1.0.0-beta.3

## 1.0.0-beta.4

### Patch Changes

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.11

## 1.0.0-beta.3

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75), [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c)]:
  - @fluojs/runtime@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#1352](https://github.com/fluojs/fluo/pull/1352) [`d05ee13`](https://github.com/fluojs/fluo/commit/d05ee1326a9e76ed97104d74c2751950aeecd8fb) Thanks [@ayden94](https://github.com/ayden94)! - Preserve active distributed cron locks when bounded shutdown times out so another node cannot start the same job while the original task is still running.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/redis@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
