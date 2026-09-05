# @fluojs/websockets

## [Unreleased]

### Minor Changes

- Expose connection IDs to message handlers and add opt-in event-envelope replies while preserving ignored returns by default.

### Patch Changes

- Raise the package-owned Node.js `ws` runtime to `^8.21.0`.
- Preserve fetch-style host binding ownership and terminal disconnect cleanup, and isolate inherited handler metadata.

## 2.0.0

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

### Minor Changes

- [#3301](https://github.com/fluojs/fluo/pull/3301) [`d6a9918`](https://github.com/fluojs/fluo/commit/d6a9918f6b38ed8979c6b0c3dc9204d707a5816a) Thanks [@ayden94](https://github.com/ayden94)! - Preserve fetch-style host bindings through shutdown, close and settle sockets after terminal errors or failed room sends, isolate inherited gateway metadata, expose socket IDs to message handlers, and add opt-in event-envelope handler replies while preserving ignored returns by default.

- [#3300](https://github.com/fluojs/fluo/pull/3300) [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2) Thanks [@ayden94](https://github.com/ayden94)! - Add an optional, independently versioned fetch-style realtime binding installation extension while preserving the public capability version 1 contract, and expose the shared internal gateway discovery seam for protocol adapters.

  Make Socket.IO attach connection lifecycle buffering before asynchronous gateway resolution, drain accepted gateway work before clearing managed state, share one bounded attempt across runtime shutdown hooks with explicit `retryShutdown()` recovery, clean pre-listen Bun bindings after bootstrap failure, reject unsupported `serverBacked` gateways consistently, dispatch through canonical handler indexes, and align runtime manifests, migration, and bilingual option documentation.

  Existing Socket.IO gateways configured with `@WebSocketGateway({ serverBacked })` must remove that option and use the shared application listener. Consumers that require a dedicated listener must migrate that gateway to `@fluojs/websockets/node` or own a separate Socket.IO server outside this adapter.

### Patch Changes

- [#3017](https://github.com/fluojs/fluo/pull/3017) [`f676c3a`](https://github.com/fluojs/fluo/commit/f676c3ae78ff0d919db485845225ec8f72ea951d) Thanks [@ayden94](https://github.com/ayden94)! - Close the Node upgrade admission race at shutdown and keep queued disconnect cleanup inside the bounded drain across supported runtimes.

- [#3421](https://github.com/fluojs/fluo/pull/3421) [`4f21688`](https://github.com/fluojs/fluo/commit/4f21688c515d65cdf30165a1395efc6377c00eb9) Thanks [@ayden94](https://github.com/ayden94)! - Expose Cloudflare Workers WebSocket binding installation through the versioned realtime capability and use it from the first-party WebSocket integration.

- [#3065](https://github.com/fluojs/fluo/pull/3065) [`2fa8b29`](https://github.com/fluojs/fluo/commit/2fa8b298a546f8c9009cfdd52639b8d5286bd2d2) Thanks [@ayden94](https://github.com/ayden94)! - Ignore room joins for unknown or already closed socket identifiers across the Node.js, Bun, Deno, and Cloudflare Workers runtime services.

- [#2818](https://github.com/fluojs/fluo/pull/2818) [`89e99c7`](https://github.com/fluojs/fluo/commit/89e99c70a96db6bd6663afc17b1aef4e7a78d1bf) Thanks [@ayden94](https://github.com/ayden94)! - Keep Bun room broadcasts independent from the Node-only backpressure policy and clarify the lifecycle-service token exported by each WebSocket entrypoint.

- [#2776](https://github.com/fluojs/fluo/pull/2776) [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995) Thanks [@ayden94](https://github.com/ayden94)! - Raise the package-owned `ws` dependency to 8.21.0 or newer for the Node.js WebSocket runtime. Refresh consumer lockfiles when upgrading so the patched runtime is installed.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/http@3.0.0
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0

## 1.0.8

### Patch Changes

- [#2336](https://github.com/fluojs/fluo/pull/2336) [`0c06086`](https://github.com/fluojs/fluo/commit/0c06086a90336ccf8e4dfe613b6fd45a5e8be5cd) Thanks [@ayden94](https://github.com/ayden94)! - Harden the root WebSocket import boundary so plain `@fluojs/websockets` imports preserve the existing Node default export names without eagerly resolving the concrete Node `ws` implementation until runtime module provider resolution.

- [#2398](https://github.com/fluojs/fluo/pull/2398) [`d114295`](https://github.com/fluojs/fluo/commit/d11429536bbc9e25ce1aad8965d6343eb4df1319) Thanks [@ayden94](https://github.com/ayden94)! - Tighten the Bun websocket binding boundary so raw websocket bindings receive only an upgrade-capable host instead of the adapter-owned Bun server lifecycle/fetch handle, and add Bun adapter regressions for shutdown failure reporting, stale native handoff rematching, custom fetch multipart parsing, and websocket response short-circuit behavior.

  This remains a patch-level boundary tightening because the low-level Bun websocket binding seam has no known external consumers yet. New binding code should depend only on `BunWebSocketUpgradeHost.upgrade(...)`; keep direct `server.fetch(...)` or `server.stop()` usage in the Bun platform adapter lifecycle/fetch integration instead of the websocket binding seam.

- [#2405](https://github.com/fluojs/fluo/pull/2405) [`8de6b9b`](https://github.com/fluojs/fluo/commit/8de6b9b1cf796c5a547e510d9dff4a30301d0d47) Thanks [@ayden94](https://github.com/ayden94)! - Stabilize Cloudflare Workers adapter lifecycle boundaries by rejecting live websocket binding mutation, preserving shutdown JSON responses for websocket upgrades during drains, and allowing lazy entrypoints to bootstrap again after a timed-out close eventually settles.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/core@1.1.0

## 1.0.7

### Patch Changes

- [#2194](https://github.com/fluojs/fluo/pull/2194) [`957444b`](https://github.com/fluojs/fluo/commit/957444b02069fb9396d872439edf3a25e38babe4) Thanks [@ayden94](https://github.com/ayden94)! - Align websocket runtime contracts by keeping shared root types runtime-neutral, tightening Node upgrade guard typing to `IncomingMessage`, documenting room service and payload normalization behavior, and adding package-local regression coverage for room operations, bounded shutdown cleanup, heartbeat opt-out, and under-limit text payload dispatch.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## 1.0.6

### Patch Changes

- [#2078](https://github.com/fluojs/fluo/pull/2078) [`3c89876`](https://github.com/fluojs/fluo/commit/3c89876ab785d03dbaf14c16713d5b45b9407b8d) Thanks [@ayden94](https://github.com/ayden94)! - Expose shared gateway decorators and metadata helpers from websocket runtime subpaths so fetch-style Bun, Deno, and Cloudflare Workers users can author gateways without importing the root Node.js-backed entrypoint.

- Updated dependencies [[`06f35cb`](https://github.com/fluojs/fluo/commit/06f35cbef3a0343a6745e658c120eb19d15d4480), [`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/http@1.1.1
  - @fluojs/runtime@1.1.7

## 1.0.5

### Patch Changes

- [#2052](https://github.com/fluojs/fluo/pull/2052) [`f4220a5`](https://github.com/fluojs/fluo/commit/f4220a59f222630b3f7d3efb832d277b47383bf2) Thanks [@ayden94](https://github.com/ayden94)! - Tighten fetch-style websocket runtime contracts by exposing `Request`-typed upgrade guards, pre-index gateway handlers to avoid hot-path dispatch filtering, keep Socket.IO descriptor handling aligned with the shared indexed handler contract, drain Node shutdown handlers once across attachments, and add close-code regression coverage for oversized fetch-style payloads.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1)]:
  - @fluojs/di@1.1.0
  - @fluojs/runtime@1.1.6

## 1.0.4

### Patch Changes

- [#2009](https://github.com/fluojs/fluo/pull/2009) [`b611545`](https://github.com/fluojs/fluo/commit/b6115450a8fbfcb00ace38ab5616c0c6130f71da) Thanks [@ayden94](https://github.com/ayden94)! - Deduplicate fetch-style runtime boundary validation for Bun, Deno, and Cloudflare Workers websocket adapters while preserving existing runtime diagnostics and lifecycle behavior.

- [#2030](https://github.com/fluojs/fluo/pull/2030) [`76600fc`](https://github.com/fluojs/fluo/commit/76600fc9e435b8024760c86ebc627ba271c09776) Thanks [@ayden94](https://github.com/ayden94)! - Allow server-backed WebSocket gateways to use port 0 for atomic ephemeral listener allocation and harden network tests against reserve-then-listen races.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.3

### Patch Changes

- [#1982](https://github.com/fluojs/fluo/pull/1982) [`14f9570`](https://github.com/fluojs/fluo/commit/14f95706cd45900158a9ef18ce5fe1580f9f4736) Thanks [@ayden94](https://github.com/ayden94)! - Harden WebSocket and Socket.IO protocol-adapter conformance around Bun binary payload handling and Socket.IO namespace teardown.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0

## 1.0.2

### Patch Changes

- [#1838](https://github.com/fluojs/fluo/pull/1838) [`c02342c`](https://github.com/fluojs/fluo/commit/c02342c758a1bab8a8361fa1dc9c0d956e4d8fc7) Thanks [@ayden94](https://github.com/ayden94)! - Ensure Node WebSocket shutdown rejects in-flight async upgrades and waits for bounded disconnect cleanup before clearing connection state.

- [#1872](https://github.com/fluojs/fluo/pull/1872) [`8e18b6b`](https://github.com/fluojs/fluo/commit/8e18b6bc24da15c947ba6b0d8817c99ae851efa5) Thanks [@ayden94](https://github.com/ayden94)! - Harden the WebSockets public docs, API overview, package metadata, and fetch-style runtime conformance coverage so consumers can rely on the documented Node, Bun, Deno, and Cloudflare Workers websocket subpath contracts.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1

## 1.0.0

### Patch Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 53d3fbb: Close active Bun, Deno, and Cloudflare Workers websocket clients during application shutdown and wait up to `shutdown.timeoutMs` for `@OnDisconnect()` cleanup to drain before teardown completes.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- a124d8c: Fix Deno and Cloudflare Workers websocket payload limit checks so string frames no longer depend on Node's `Buffer` global before runtime handlers run.
- 57d61c0: Normalize WebSocket binary payload limits across supported runtimes (Deno, Bun, Cloudflare Workers, Node). Size calculations for array buffers and typed arrays now correctly count bytes instead of falling through to `undefined` or `0`, fixing an issue where standard binary frames could prematurely trigger "Payload too large" disconnects or bypass limits.
- ac77310: Normalize Deno websocket binary frames across `ArrayBuffer`, typed array, and `Blob` hosts so gateway message dispatch and payload limits match the documented cross-runtime contract.
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
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
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
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.6

### Patch Changes

- [#1621](https://github.com/fluojs/fluo/pull/1621) [`57d61c0`](https://github.com/fluojs/fluo/commit/57d61c0ade9112be48455c48f8ed86d11e46c726) Thanks [@ayden94](https://github.com/ayden94)! - Normalize WebSocket binary payload limits across supported runtimes (Deno, Bun, Cloudflare Workers, Node). Size calculations for array buffers and typed arrays now correctly count bytes instead of falling through to `undefined` or `0`, fixing an issue where standard binary frames could prematurely trigger "Payload too large" disconnects or bypass limits.

- [#1623](https://github.com/fluojs/fluo/pull/1623) [`ac77310`](https://github.com/fluojs/fluo/commit/ac7731044ea42347eafe5d2cc7a5c88af5dcda9d) Thanks [@ayden94](https://github.com/ayden94)! - Normalize Deno websocket binary frames across `ArrayBuffer`, typed array, and `Blob` hosts so gateway message dispatch and payload limits match the documented cross-runtime contract.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.5

### Patch Changes

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5), [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/http@1.0.0-beta.10
  - @fluojs/runtime@1.0.0-beta.11

## 1.0.0-beta.4

### Patch Changes

- [#1435](https://github.com/fluojs/fluo/pull/1435) [`53d3fbb`](https://github.com/fluojs/fluo/commit/53d3fbb2475d43a12c148e078dc6b7942a1edc6d) Thanks [@ayden94](https://github.com/ayden94)! - Close active Bun, Deno, and Cloudflare Workers websocket clients during application shutdown and wait up to `shutdown.timeoutMs` for `@OnDisconnect()` cleanup to drain before teardown completes.

- Updated dependencies [[`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0), [`48a9f97`](https://github.com/fluojs/fluo/commit/48a9f9761c093e6622922719869a29a84f7d0079), [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27), [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946), [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/http@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.5
  - @fluojs/di@1.0.0-beta.5

## 1.0.0-beta.3

### Patch Changes

- [#1412](https://github.com/fluojs/fluo/pull/1412) [`a124d8c`](https://github.com/fluojs/fluo/commit/a124d8c4a072d05d2e0dab1f0e8ad90bceecea4f) Thanks [@ayden94](https://github.com/ayden94)! - Fix Deno and Cloudflare Workers websocket payload limit checks so string frames no longer depend on Node's `Buffer` global before runtime handlers run.

- Updated dependencies [[`01d5e65`](https://github.com/fluojs/fluo/commit/01d5e65f053db99704d9cb30585c75b94dd38367), [`1911e11`](https://github.com/fluojs/fluo/commit/1911e110e7dbb5296238ccc0a2e167ed6f34df86), [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6), [`89f6379`](https://github.com/fluojs/fluo/commit/89f637935736c0fe9c52668a5b714c5c0e394af1), [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d)]:
  - @fluojs/http@1.0.0-beta.3
  - @fluojs/di@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.4

## 1.0.0-beta.2

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75), [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c)]:
  - @fluojs/runtime@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/http@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3
