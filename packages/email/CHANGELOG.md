# @fluojs/email

## [Unreleased]

## 3.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3578](https://github.com/fluojs/fluo/pull/3578) [`cebc230`](https://github.com/fluojs/fluo/commit/cebc2304da92856c1ec148401d6aa496a34163cb) Thanks [@ayden94](https://github.com/ayden94)! - Reject duplicate default and trimmed named `RedisModule.forRoot(...)` registration identities during bootstrap before a Redis client is created.

  Migration: Register the unnamed default Redis client at most once, and give every additional Redis registration a distinct trimmed `name`. Consumers using `@fluojs/cache-manager`, `@fluojs/cron`, `@fluojs/email`, `@fluojs/queue`, `@fluojs/terminus`, or `@fluojs/throttler` with Redis must use the corresponding major release.

- [#2776](https://github.com/fluojs/fluo/pull/2776) [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995) Thanks [@ayden94](https://github.com/ayden94)! - Require Nodemailer 9.0.1 or newer for the Node SMTP subpath. Upgrade Nodemailer 6, 7, or 8 consumers to `nodemailer@^9.0.1`, refresh the application lockfile, and validate provider-specific SMTP options before adopting this release; the fluo transport factory API is unchanged.

### Patch Changes

- [#3647](https://github.com/fluojs/fluo/pull/3647) [`0fe627e`](https://github.com/fluojs/fluo/commit/0fe627ee726c98f33a0fac36c7c7b3cb22357469) Thanks [@ayden94](https://github.com/ayden94)! - Correct EmailModule and EmailLifecycleError TSDoc to match existing provider visibility and lifecycle failure contracts.

- [#3665](https://github.com/fluojs/fluo/pull/3665) [`fef6b19`](https://github.com/fluojs/fluo/commit/fef6b196c726f534c42ec654c57827f352d4f877) Thanks [@ayden94](https://github.com/ayden94)! - Add atomic ordered `enqueueMany(...)` batches to Queue and use them for built-in email notification batches, preserving each notification identity as its backing-queue deduplication key.

- [#3660](https://github.com/fluojs/fluo/pull/3660) [`4a12c8b`](https://github.com/fluojs/fluo/commit/4a12c8b209782d8184dba20e54395fea021c26ee) Thanks [@ayden94](https://github.com/ayden94)! - Publish the optional Nodemailer declaration peer required by `@fluojs/email/node` and document the complete Node SMTP installation command.

- [#3654](https://github.com/fluojs/fluo/pull/3654) [`7e58352`](https://github.com/fluojs/fluo/commit/7e583527f8688fb8bcc4d19b1de79a0956c552cf) Thanks [@ayden94](https://github.com/ayden94)! - Document the NestJS mailer migration path for explicit transport ownership and
  direct or template-backed delivery. Choose a portable transport, a
  factory-owned Node SMTP transporter, or a caller-owned existing transporter;
  use `EmailService.send(...)` for pre-rendered messages and
  `sendNotification(...)` with `payload.templateData` for renderer-backed
  notifications.

- [#3648](https://github.com/fluojs/fluo/pull/3648) [`d0c52e6`](https://github.com/fluojs/fluo/commit/d0c52e6ab8ddfbba8d50e637a3ef5922628e01d5) Thanks [@ayden94](https://github.com/ayden94)! - Preserve structured Nodemailer recipient identities in accepted, pending, and rejected delivery receipts.

- [#3655](https://github.com/fluojs/fluo/pull/3655) [`976b757`](https://github.com/fluojs/fluo/commit/976b757de636aa0f27889d3fd371b4e2e2fd7899) Thanks [@ayden94](https://github.com/ayden94)! - Preserve deterministic notification queue identities through the built-in email queue adapter and Queue's BullMQ-safe deduplication mapping.

- [#3650](https://github.com/fluojs/fluo/pull/3650) [`bdea71e`](https://github.com/fluojs/fluo/commit/bdea71ee6b181b88477e384c868ebfdd157c0499) Thanks [@ayden94](https://github.com/ayden94)! - Serialize factory-owned email transport cleanup across bootstrap verification failure and application shutdown so each transport closes at most once.

- [#3088](https://github.com/fluojs/fluo/pull/3088) [`3bb6c02`](https://github.com/fluojs/fluo/commit/3bb6c029eb4a3221e55976cad5b0d573c4fd3651) Thanks [@ayden94](https://github.com/ayden94)! - Validate email messages before acquiring lazy transports so invalid delivery input cannot initialize provider resources.

- Updated dependencies [[`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`976b757`](https://github.com/fluojs/fluo/commit/976b757de636aa0f27889d3fd371b4e2e2fd7899), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`fef6b19`](https://github.com/fluojs/fluo/commit/fef6b196c726f534c42ec654c57827f352d4f877), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`a7223a1`](https://github.com/fluojs/fluo/commit/a7223a198e5d893557c5e04c8ef1ed53c6063723), [`51a8bc7`](https://github.com/fluojs/fluo/commit/51a8bc761a750dc4229713284e786dbf3618f5f8), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`0c977f1`](https://github.com/fluojs/fluo/commit/0c977f164a650e33e058b18489e9d37ba44ea298), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`3c7e09d`](https://github.com/fluojs/fluo/commit/3c7e09d470d7a8d2de99db00a10015354cc4fb5a), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`65e1b87`](https://github.com/fluojs/fluo/commit/65e1b87934b8351ea0e860085a63f147b47b7ef7), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`97f20bb`](https://github.com/fluojs/fluo/commit/97f20bbc7ca3af01f6738ab38ad554f9e9bb664e), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`dbd704e`](https://github.com/fluojs/fluo/commit/dbd704ed981a4de99aa705e0a276bfef8429ac73), [`cfc9fcf`](https://github.com/fluojs/fluo/commit/cfc9fcfc016c2fbb12e7b1c3ab26311282f3eb21), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`0ed3cc0`](https://github.com/fluojs/fluo/commit/0ed3cc041f656e2a1b3b0912b898feb063d2dc0c), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`1256356`](https://github.com/fluojs/fluo/commit/125635679674043739faf4da17edb5cfe649bf1f), [`90631a8`](https://github.com/fluojs/fluo/commit/90631a83b50209ab317af04fe6ea415282a9d7de), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`3ce24b7`](https://github.com/fluojs/fluo/commit/3ce24b720f1ddfc52afbf499d3ad800c00e435b4), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`cebc230`](https://github.com/fluojs/fluo/commit/cebc2304da92856c1ec148401d6aa496a34163cb), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`0d1aca9`](https://github.com/fluojs/fluo/commit/0d1aca91d45db68861821481c36327e155f829f7), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`7255c0d`](https://github.com/fluojs/fluo/commit/7255c0dc96d465d61eead1a3d6c30f5a2e1fadce), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/runtime@3.0.0
  - @fluojs/queue@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0
  - @fluojs/notifications@2.0.0

## 2.0.0

### Major Changes

- [#2649](https://github.com/fluojs/fluo/pull/2649) [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4) Thanks [@ayden94](https://github.com/ayden94)! - Bump major in lockstep with `@fluojs/runtime@2.0.0`, `@fluojs/di@2.0.0`, and `@fluojs/queue@2.0.0` because `@fluojs/email` depends on those packages' public contracts. The email package itself has no breaking API changes; consumers upgrading from `@fluojs/email@1.x` should follow the migration notes for `@fluojs/runtime` (multipart file payloads are now runtime-neutral `Uint8Array`), `@fluojs/di` (introspection state is read-only), and `@fluojs/queue` (scoped queue module discovery and dead-letter drain semantics).

### Patch Changes

- [#2617](https://github.com/fluojs/fluo/pull/2617) [`5c9246c`](https://github.com/fluojs/fluo/commit/5c9246ca684137051d2ac43f92104e2a9cb9fce9) Thanks [@ayden94](https://github.com/ayden94)! - Make repeated and concurrent Email service shutdown calls share one cleanup operation so owned transports close at most once.

- [#2402](https://github.com/fluojs/fluo/pull/2402) [`90f2a82`](https://github.com/fluojs/fluo/commit/90f2a820aadf6bdb5b4da59afee22d84ea86af23) Thanks [@ayden94](https://github.com/ayden94)! - Keep root email status snapshots transport-agnostic by omitting queue worker metadata unless callers provide it explicitly, and add regression coverage for caller-owned shutdown, notification payload forwarding, and lifecycle public exports.

- [#2305](https://github.com/fluojs/fluo/pull/2305) [`df24a8f`](https://github.com/fluojs/fluo/commit/df24a8f2ef4c38bf8ff454e3ed899f181f3a89da) Thanks [@ayden94](https://github.com/ayden94)! - Normalize lazy email transport factory failures so send-triggered initialization rejects with `EmailLifecycleError` and clears rejected transport state before shutdown.

- [#2614](https://github.com/fluojs/fluo/pull/2614) [`3fb32b8`](https://github.com/fluojs/fluo/commit/3fb32b87483f95d9d40203481ce5e967e13a4149) Thanks [@ayden94](https://github.com/ayden94)! - Reject queued notifications whose channel does not match the configured email channel before calling the email transport.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`471c923`](https://github.com/fluojs/fluo/commit/471c92379dcb55946b6ae6b2522f9544a14d9a52), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`7045978`](https://github.com/fluojs/fluo/commit/7045978594af410de6e14a638205084d3a30b465), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a1dcd40`](https://github.com/fluojs/fluo/commit/a1dcd401e72c1a9b15400c0e55b578bb48a32d3b), [`1f8896a`](https://github.com/fluojs/fluo/commit/1f8896a632932d968c988f77dbcdf6629adca81f), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/queue@2.0.0
  - @fluojs/core@1.1.0
  - @fluojs/notifications@1.0.3

## 1.0.2

### Patch Changes

- [#2261](https://github.com/fluojs/fluo/pull/2261) [`50330a6`](https://github.com/fluojs/fluo/commit/50330a64491adea44655df16d3285dca9c113007) Thanks [@ayden94](https://github.com/ayden94)! - Drain in-flight transport verify and send operations before closing owned email transports during shutdown.

- Updated dependencies [[`78a7ade`](https://github.com/fluojs/fluo/commit/78a7adea4a6dc5e5996af6ca1244c789dab377af), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/notifications@1.0.2
  - @fluojs/runtime@1.1.8

## 1.0.1

### Patch Changes

- [#1983](https://github.com/fluojs/fluo/pull/1983) [`e0c855e`](https://github.com/fluojs/fluo/commit/e0c855eee03d8b59e19420ea1c22ee73ef66fe44) Thanks [@ayden94](https://github.com/ayden94)! - Align notification provider delivery semantics by closing owned email transports when bootstrap verification fails, documenting Slack abort/retry handling and Discord direct batch fan-out boundaries, and strengthening notification dependency diagnostics coverage.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`e0c855e`](https://github.com/fluojs/fluo/commit/e0c855eee03d8b59e19420ea1c22ee73ef66fe44)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/notifications@1.0.1

## 1.0.0

### Minor Changes

- 7db5223: Add lifecycle-gated email and Slack delivery failures once shutdown begins so factory-owned notification transports are not reused or recreated during teardown, and expose lifecycle error classes for callers that handle send/shutdown races.
- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- e2fb7ca: Require verified email transports to finish bootstrap readiness before delivery, allow rejected async option factories to retry, and validate Nodemailer display-name address handoff.
- 35043e1: Reject blank email recipients before transport handoff, honor aborted sends before rendering or provider delivery, and preserve lifecycle provider errors as diagnostic causes.
- 10431ae: Restore the email package's optional queue boundary by keeping queue workers behind the `@fluojs/email/queue` subpath and make queued email notification workers fail incomplete provider deliveries so retry/dead-letter handling can run.
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
- Updated dependencies [995a55f]
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
  - @fluojs/queue@1.0.0
  - @fluojs/notifications@1.0.0

## 1.0.0-beta.5

### Minor Changes

- [#1761](https://github.com/fluojs/fluo/pull/1761) [`7db5223`](https://github.com/fluojs/fluo/commit/7db522316b8204f80631e2594afbe9d6f9093382) Thanks [@ayden94](https://github.com/ayden94)! - Add lifecycle-gated email and Slack delivery failures once shutdown begins so factory-owned notification transports are not reused or recreated during teardown, and expose lifecycle error classes for callers that handle send/shutdown races.

### Patch Changes

- [#1825](https://github.com/fluojs/fluo/pull/1825) [`e2fb7ca`](https://github.com/fluojs/fluo/commit/e2fb7cac6da379070f12d6f1f62d3da6f9aaad73) Thanks [@ayden94](https://github.com/ayden94)! - Require verified email transports to finish bootstrap readiness before delivery, allow rejected async option factories to retry, and validate Nodemailer display-name address handoff.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`512bfd7`](https://github.com/fluojs/fluo/commit/512bfd7edabd1d906e1964c0ecf5d7041d2f0477)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8
  - @fluojs/notifications@1.0.0-beta.5

## 1.0.0-beta.4

### Patch Changes

- [#1646](https://github.com/fluojs/fluo/pull/1646) [`35043e1`](https://github.com/fluojs/fluo/commit/35043e1a737b7ca54c4a15f9a83321891e7168dd) Thanks [@ayden94](https://github.com/ayden94)! - Reject blank email recipients before transport handoff, honor aborted sends before rendering or provider delivery, and preserve lifecycle provider errors as diagnostic causes.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`3785a42`](https://github.com/fluojs/fluo/commit/3785a42a2206104fe3f799394446fd99ef9fb7d2), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`8fb13ad`](https://github.com/fluojs/fluo/commit/8fb13ad86cdb78d4a7a0316c68aa75d6b317b69a), [`995a55f`](https://github.com/fluojs/fluo/commit/995a55f1571eb160fded3b0f7df0a37c672e1c94), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/notifications@1.0.0-beta.4
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/queue@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- Updated dependencies [[`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299)]:
  - @fluojs/notifications@1.0.0-beta.3
  - @fluojs/queue@1.0.0-beta.4

## 1.0.0-beta.2

### Patch Changes

- [#1356](https://github.com/fluojs/fluo/pull/1356) [`10431ae`](https://github.com/fluojs/fluo/commit/10431ae95edc84d922e5f4672fc2133825377e93) Thanks [@ayden94](https://github.com/ayden94)! - Restore the email package's optional queue boundary by keeping queue workers behind the `@fluojs/email/queue` subpath and make queued email notification workers fail incomplete provider deliveries so retry/dead-letter handling can run.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/notifications@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
