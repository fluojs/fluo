# @fluojs/metrics

## [Unreleased]

### Patch Changes

- No pending runtime changes.

## 3.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3538](https://github.com/fluojs/fluo/pull/3538) [`170f673`](https://github.com/fluojs/fluo/commit/170f673fb278cf007de53a85580e1fc8449a6d19) Thanks [@ayden94](https://github.com/ayden94)! - Declare the package-owned Node.js support range `>=24.0.0 <27` for `@fluojs/metrics` in the upcoming coordinated release. The portable `@fluojs/runtime` package no longer supplies a transitive Node engine requirement.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

### Minor Changes

- [#3542](https://github.com/fluojs/fluo/pull/3542) [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639) Thanks [@ayden94](https://github.com/ayden94)! - Configure a shared Prometheus registry through the public `METRICS_REGISTRY`
  bootstrap provider so each application bootstrap owns its metrics registry. Bootstrap
  registry provenance is available to runtime integrations through the narrow internal
  provider-token seam.

- [#3543](https://github.com/fluojs/fluo/pull/3543) [`31aecbd`](https://github.com/fluojs/fluo/commit/31aecbd0ea7634b16324e7ceab277fc8e778e9f9) Thanks [@ayden94](https://github.com/ayden94)! - Add configurable duration histogram buckets for built-in HTTP metrics.

### Patch Changes

- [#3541](https://github.com/fluojs/fluo/pull/3541) [`9bde590`](https://github.com/fluojs/fluo/commit/9bde590711ea65940564611cc7bb20372766ea59) Thanks [@ayden94](https://github.com/ayden94)! - Clarify that applications importing `prom-client` directly must install it as a direct dependency instead of relying on its transitive installation through `@fluojs/metrics`.

- [#3544](https://github.com/fluojs/fluo/pull/3544) [`0138dec`](https://github.com/fluojs/fluo/commit/0138dec01b4333068d4bec132c8b316d45950a44) Thanks [@ayden94](https://github.com/ayden94)! - Align consumer-facing `@fluojs/metrics` documentation with existing behavior: clarify `MetricsService` visibility, bootstrap-owned shared registry mode, and HTTP duration histogram bucket configuration.

- [#3539](https://github.com/fluojs/fluo/pull/3539) [`019e062`](https://github.com/fluojs/fluo/commit/019e0622e2268e4756ce1ae29004f07f9af0d8d3) Thanks [@ayden94](https://github.com/ayden94)! - Correct the registry-mode gauge documentation to distinguish module configuration from scrape-time registry sharing.

- [#3557](https://github.com/fluojs/fluo/pull/3557) [`f2b5468`](https://github.com/fluojs/fluo/commit/f2b5468bcd0b7b19d3941a6992f548ff112523f3) Thanks [@ayden94](https://github.com/ayden94)! - Document `HttpMetricsMiddleware` constructor parameters and configuration errors in published declarations.

- [#3558](https://github.com/fluojs/fluo/pull/3558) [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230) Thanks [@ayden94](https://github.com/ayden94)! - Drain queued telemetry scrapes and remove framework-owned platform telemetry from
  a shared Registry after its final metrics module registration closes. Delay platform
  component shutdown until module teardown, including telemetry scrape draining, completes.

- [#3546](https://github.com/fluojs/fluo/pull/3546) [`e46f5b5`](https://github.com/fluojs/fluo/commit/e46f5b5ba0c3bedd10a9b05e6d2d1cd127ef688c) Thanks [@ayden94](https://github.com/ayden94)! - Preflight active `prom-client` default-collector collisions before registration can
  trigger side effects, and roll back collectors from unexpected registration failures
  so a later clean bootstrap can retry the registry.

- [#3555](https://github.com/fluojs/fluo/pull/3555) [`3cbce23`](https://github.com/fluojs/fluo/commit/3cbce23bf37445cbc5b1439328809d88c20657d0) Thanks [@ayden94](https://github.com/ayden94)! - Serialize each platform telemetry refresh and Prometheus render as one complete
  scrape snapshot when concurrent callers share a registry.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/http@3.0.0
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0

## 2.0.0

### Major Changes

- [#2377](https://github.com/fluojs/fluo/pull/2377) [`8cb5ef0`](https://github.com/fluojs/fluo/commit/8cb5ef0c409abc6757593c3a6e00463ffb93cde2) Thanks [@ayden94](https://github.com/ayden94)! - Validate shared-registry HTTP collector path-label configuration before reuse and keep platform telemetry stale-series ownership scoped to the reused registry.

  Migration note: applications that pass the same Prometheus registry to multiple `MetricsModule.forRoot(...)` calls must now use matching HTTP path-label configuration for framework-owned collectors. Align `pathLabelMode`, reuse the same `pathLabelNormalizer` function reference when a custom normalizer is configured, and keep `unknownPathLabel` consistent across module instances before sharing a registry. If different HTTP path-label policies are required, use separate registries for those module instances.

### Patch Changes

- [#2464](https://github.com/fluojs/fluo/pull/2464) [`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439) Thanks [@ayden94](https://github.com/ayden94)! - Refresh runtime platform telemetry from the active registry collect path so advanced shared-registry scrapers observe fresh component readiness and health series.

- [#2337](https://github.com/fluojs/fluo/pull/2337) [`3dc00db`](https://github.com/fluojs/fluo/commit/3dc00db1b56554d153df5742a81ee67a5a73fc31) Thanks [@ayden94](https://github.com/ayden94)! - Harden platform telemetry scrapes so missing platform-shell registration uses container presence checks, registered shell resolution failures still surface, and component ids or kinds containing separator-like text keep distinct Prometheus series.

- [#2691](https://github.com/fluojs/fluo/pull/2691) [`e43c3ac`](https://github.com/fluojs/fluo/commit/e43c3ac9c7682ab18a94631ea91b6ba799c525d2) Thanks [@ayden94](https://github.com/ayden94)! - Release shared Registry telemetry scrape wrappers on application shutdown and restore the original `metrics()` function after the last metrics module closes.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/core@1.1.0

## 1.0.4

### Patch Changes

- [#2159](https://github.com/fluojs/fluo/pull/2159) [`c57e4d0`](https://github.com/fluojs/fluo/commit/c57e4d0106cb1d9ac061f7d36f86d17d5da2bda9) Thanks [@ayden94](https://github.com/ayden94)! - Harden metrics lifecycle ownership so isolated registries, services, meter providers, and platform telemetry are created at application bootstrap boundaries instead of dynamic module definition time, while preserving shared-registry scrape collision guards.

- [#2114](https://github.com/fluojs/fluo/pull/2114) [`23eeea1`](https://github.com/fluojs/fluo/commit/23eeea1c0276e8dd9696215f5be35bbd67c7ad06) Thanks [@ayden94](https://github.com/ayden94)! - Ensure `endpointMiddleware` remains bound when `MetricsModule.forRoot({ path: '' })` exposes an empty-string metrics endpoint.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## 1.0.3

### Patch Changes

- [#1993](https://github.com/fluojs/fluo/pull/1993) [`d27a381`](https://github.com/fluojs/fluo/commit/d27a3810f7a0053ff490c21564f419af9f80e33f) Thanks [@ayden94](https://github.com/ayden94)! - Align Terminus Redis diagnostics and Metrics option responsibility contracts with lifecycle-aware tests, public documentation, and TSDoc coverage.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0

## 1.0.2

### Patch Changes

- [#1865](https://github.com/fluojs/fluo/pull/1865) [`d7f03ff`](https://github.com/fluojs/fluo/commit/d7f03ff4de383bfa322ef6bac958fb9970949ca0) Thanks [@ayden94](https://github.com/ayden94)! - Record metrics endpoint middleware failures in built-in HTTP instrumentation and validate framework-owned HTTP collector label schemas before shared-registry reuse.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0

## 1.0.0

### Patch Changes

- 616189f: Clear stale runtime platform telemetry series when `PLATFORM_SHELL` becomes unavailable after a prior scrape, and align the documented metrics public surface with exported contracts.
- 2513723: Reuse built-in HTTP metrics when multiple MetricsModule instances intentionally share one registry, while documenting that HTTP instrumentation requires the explicit `http` option.
- e55065e: Reject app-owned platform telemetry gauge name collisions in shared registries and reuse only framework-owned gauges with the expected label schema.
- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
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
  - @fluojs/http@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.4

### Patch Changes

- [#1624](https://github.com/fluojs/fluo/pull/1624) [`e55065e`](https://github.com/fluojs/fluo/commit/e55065e0a563f778b5227dadd6f7d1a4a12a2ee6) Thanks [@ayden94](https://github.com/ayden94)! - Reject app-owned platform telemetry gauge name collisions in shared registries and reuse only framework-owned gauges with the expected label schema.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.3

### Patch Changes

- [#1509](https://github.com/fluojs/fluo/pull/1509) [`2513723`](https://github.com/fluojs/fluo/commit/2513723dfe09ebbc4018104f5461c8f1fcd28920) Thanks [@ayden94](https://github.com/ayden94)! - Reuse built-in HTTP metrics when multiple MetricsModule instances intentionally share one registry, while documenting that HTTP instrumentation requires the explicit `http` option.

- Updated dependencies [[`1d43614`](https://github.com/fluojs/fluo/commit/1d4361416e56ec935d67da096ba8b72d3886f7ee), [`f086fa5`](https://github.com/fluojs/fluo/commit/f086fa58827617bda8bdef50e0b694bd5e85dfaa), [`f8d05fa`](https://github.com/fluojs/fluo/commit/f8d05fac610bd5a58c27f84e764338ee718c0a67), [`6b8e8a9`](https://github.com/fluojs/fluo/commit/6b8e8a9d2c6123d9a1ca2ec805ef4fde97d1f199)]:
  - @fluojs/di@1.0.0-beta.6
  - @fluojs/runtime@1.0.0-beta.9

## 1.0.0-beta.2

### Patch Changes

- [#1366](https://github.com/fluojs/fluo/pull/1366) [`616189f`](https://github.com/fluojs/fluo/commit/616189ff76227bf574226ecd32134584e193efdc) Thanks [@ayden94](https://github.com/ayden94)! - Clear stale runtime platform telemetry series when `PLATFORM_SHELL` becomes unavailable after a prior scrape, and align the documented metrics public surface with exported contracts.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
