# @fluojs/socket.io

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#2776](https://github.com/fluojs/fluo/pull/2776) [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995) Thanks [@ayden94](https://github.com/ayden94)! - Require Socket.IO 4.8.3 or newer. Consumers using an older Socket.IO v4 release must upgrade the peer and refresh their lockfile so the patched Engine.IO WebSocket chain is installed; the fluo adapter API is unchanged.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

- [#3300](https://github.com/fluojs/fluo/pull/3300) [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2) Thanks [@ayden94](https://github.com/ayden94)! - Add an optional, independently versioned fetch-style realtime binding installation extension while preserving the public capability version 1 contract, and expose the shared internal gateway discovery seam for protocol adapters.

  Make Socket.IO attach connection lifecycle buffering before asynchronous gateway resolution, drain accepted gateway work before clearing managed state, share one bounded attempt across runtime shutdown hooks with explicit `retryShutdown()` recovery, clean pre-listen Bun bindings after bootstrap failure, reject unsupported `serverBacked` gateways consistently, dispatch through canonical handler indexes, and align runtime manifests, migration, and bilingual option documentation.

  Existing Socket.IO gateways configured with `@WebSocketGateway({ serverBacked })` must remove that option and use the shared application listener. Consumers that require a dedicated listener must migrate that gateway to `@fluojs/websockets/node` or own a separate Socket.IO server outside this adapter.

### Patch Changes

- [#3012](https://github.com/fluojs/fluo/pull/3012) [`d4fcf20`](https://github.com/fluojs/fluo/commit/d4fcf207718e3f519cb0e07a4f23cf53eb91ab90) Thanks [@ayden94](https://github.com/ayden94)! - Honor configured Socket.IO transport restrictions on the Bun engine path so they match Node-backed runtimes.

- [#2821](https://github.com/fluojs/fluo/pull/2821) [`be9caf0`](https://github.com/fluojs/fluo/commit/be9caf064594199f9801fddb03ea2349534eaf49) Thanks [@ayden94](https://github.com/ayden94)! - Serialize Bun Socket.IO server initialization, publish the server only after realtime binding succeeds, and clean partial resources so failed initialization can be retried safely.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`f676c3a`](https://github.com/fluojs/fluo/commit/f676c3ae78ff0d919db485845225ec8f72ea951d), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4f21688`](https://github.com/fluojs/fluo/commit/4f21688c515d65cdf30165a1395efc6377c00eb9), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`d6a9918`](https://github.com/fluojs/fluo/commit/d6a9918f6b38ed8979c6b0c3dc9204d707a5816a), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`2fa8b29`](https://github.com/fluojs/fluo/commit/2fa8b298a546f8c9009cfdd52639b8d5286bd2d2), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`89e99c7`](https://github.com/fluojs/fluo/commit/89e99c70a96db6bd6663afc17b1aef4e7a78d1bf), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/http@3.0.0
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0
  - @fluojs/websockets@2.0.0

## 1.0.8

### Patch Changes

- [#2342](https://github.com/fluojs/fluo/pull/2342) [`a3c8b92`](https://github.com/fluojs/fluo/commit/a3c8b92f38b53aa5dcb21fed8dbf28257434a63b) Thanks [@ayden94](https://github.com/ayden94)! - Align Socket.IO guard and runtime-boundary contracts by documenting `void`/`undefined` guard returns as accepted, keeping the root `SocketIoHandshakeRequest` export runtime-neutral instead of importing `node:http` directly, and adding regression coverage for explicit ACK callbacks plus shutdown retry cleanup.

- [#2468](https://github.com/fluojs/fluo/pull/2468) [`b8e647a`](https://github.com/fluojs/fluo/commit/b8e647ae4d585e84e90b5bc9b094ff34ac831294) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Socket.IO connection bookkeeping across recoverable socket error events and surface Web-standard Bun handshake requests to guard and handler contexts.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`0c06086`](https://github.com/fluojs/fluo/commit/0c06086a90336ccf8e4dfe613b6fd45a5e8be5cd), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896), [`d114295`](https://github.com/fluojs/fluo/commit/d11429536bbc9e25ce1aad8965d6343eb4df1319), [`8de6b9b`](https://github.com/fluojs/fluo/commit/8de6b9b1cf796c5a547e510d9dff4a30301d0d47)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/core@1.1.0
  - @fluojs/websockets@1.0.8

## 1.0.7

### Patch Changes

- [#2111](https://github.com/fluojs/fluo/pull/2111) [`b3e5ec4`](https://github.com/fluojs/fluo/commit/b3e5ec456f038c6a65fd26586df44be6a717920a) Thanks [@ayden94](https://github.com/ayden94)! - Republish the Socket.IO runtime and declaration contract so generated package output preserves fail-fast positive-integer option validation, the portable `SocketIoHandshakeRequest` request union, and bounded shutdown force-disconnect/retry semantics.

- [#2229](https://github.com/fluojs/fluo/pull/2229) [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed) Thanks [@ayden94](https://github.com/ayden94)! - Align Socket.IO lifecycle internals and documentation with the audited runtime contracts: defer Node async-context loading until gateway invocation, route provider-scope metadata through the runtime integration seam, document explicit ACK/raw-server migration paths, and add deterministic Bun CORS/test coverage.

- Updated dependencies [[`957444b`](https://github.com/fluojs/fluo/commit/957444b02069fb9396d872439edf3a25e38babe4), [`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/websockets@1.0.7
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## 1.0.6

### Patch Changes

- [#2082](https://github.com/fluojs/fluo/pull/2082) [`894b20c`](https://github.com/fluojs/fluo/commit/894b20ccc1ac14d7c89262f37074ea4fb675d104) Thanks [@ayden94](https://github.com/ayden94)! - Fail fast when unsupported realtime adapters bootstrap Socket.IO without discovered gateways, while preserving the Bun binding installation path before listen.

- Updated dependencies [[`06f35cb`](https://github.com/fluojs/fluo/commit/06f35cbef3a0343a6745e658c120eb19d15d4480), [`3c89876`](https://github.com/fluojs/fluo/commit/3c89876ab785d03dbaf14c16713d5b45b9407b8d), [`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/http@1.1.1
  - @fluojs/websockets@1.0.6
  - @fluojs/runtime@1.1.7

## 1.0.5

### Patch Changes

- [#2058](https://github.com/fluojs/fluo/pull/2058) [`2cd954a`](https://github.com/fluojs/fluo/commit/2cd954a7c2841d0c18ac9d30520c4110fde6d7d2) Thanks [@ayden94](https://github.com/ayden94)! - Reject invalid explicit Socket.IO numeric configuration and make shutdown timeout cleanup deterministic by force-disconnecting managed clients before lifecycle state is cleared.

- [#2061](https://github.com/fluojs/fluo/pull/2061) [`df7197b`](https://github.com/fluojs/fluo/commit/df7197bf7f5b254029652811ce94c6a381bc0828) Thanks [@ayden94](https://github.com/ayden94)! - Defer the Bun engine dependency load until the Bun Socket.IO bootstrap path is actually selected, preventing Node server-backed applications from crashing during package import.

- [#2052](https://github.com/fluojs/fluo/pull/2052) [`f4220a5`](https://github.com/fluojs/fluo/commit/f4220a59f222630b3f7d3efb832d277b47383bf2) Thanks [@ayden94](https://github.com/ayden94)! - Tighten fetch-style websocket runtime contracts by exposing `Request`-typed upgrade guards, pre-index gateway handlers to avoid hot-path dispatch filtering, keep Socket.IO descriptor handling aligned with the shared indexed handler contract, drain Node shutdown handlers once across attachments, and add close-code regression coverage for oversized fetch-style payloads.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1), [`f4220a5`](https://github.com/fluojs/fluo/commit/f4220a59f222630b3f7d3efb832d277b47383bf2)]:
  - @fluojs/di@1.1.0
  - @fluojs/runtime@1.1.6
  - @fluojs/websockets@1.0.5

## 1.0.4

### Patch Changes

- [#2025](https://github.com/fluojs/fluo/pull/2025) [`223aa65`](https://github.com/fluojs/fluo/commit/223aa65135466d7c670186e3f18a6910fcab843a) Thanks [@ayden94](https://github.com/ayden94)! - Harden messaging and realtime lifecycle contracts by documenting Slack webhook ambient fetch fallback while preserving the existing optional fetch API, preventing Socket.IO raw server recreation after shutdown starts, preserving portable Socket.IO guard request typing, and deferring Queue metadata setup until decorator execution.

- Updated dependencies [[`b611545`](https://github.com/fluojs/fluo/commit/b6115450a8fbfcb00ace38ab5616c0c6130f71da), [`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b), [`76600fc`](https://github.com/fluojs/fluo/commit/76600fc9e435b8024760c86ebc627ba271c09776)]:
  - @fluojs/websockets@1.0.4
  - @fluojs/runtime@1.1.2

## 1.0.3

### Patch Changes

- [#1982](https://github.com/fluojs/fluo/pull/1982) [`14f9570`](https://github.com/fluojs/fluo/commit/14f95706cd45900158a9ef18ce5fe1580f9f4736) Thanks [@ayden94](https://github.com/ayden94)! - Harden WebSocket and Socket.IO protocol-adapter conformance around Bun binary payload handling and Socket.IO namespace teardown.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`14f9570`](https://github.com/fluojs/fluo/commit/14f95706cd45900158a9ef18ce5fe1580f9f4736), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0
  - @fluojs/websockets@1.0.3

## 1.0.2

### Patch Changes

- [#1850](https://github.com/fluojs/fluo/pull/1850) [`1f74b2c`](https://github.com/fluojs/fluo/commit/1f74b2c84f8c3bc9c0ff021a05dc16f1e06dc550) Thanks [@ayden94](https://github.com/ayden94)! - Honor explicit namespace paths for Socket.IO room helper joins and leaves even when the same socket id is already registered in another namespace, and configure Bun raw-server bindings before listen when no gateways are discovered.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`c02342c`](https://github.com/fluojs/fluo/commit/c02342c758a1bab8a8361fa1dc9c0d956e4d8fc7), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986), [`8e18b6b`](https://github.com/fluojs/fluo/commit/8e18b6bc24da15c947ba6b0d8817c99ae851efa5)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/websockets@1.0.1
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- 0e7f485: Fix namespace, shutdown, and payload limit behavioral contract risks:
  - Set `cleanupEmptyChildNamespaces: false` to ensure Socket.IO v4 defaults don't prematurely clean up statically defined gateway namespaces.
  - Detach the underlying HTTP server from the Socket.IO instance before calling `io.close()` during shutdown so Socket.IO cleans up clients without closing adapter-owned/shared HTTP listeners.
  - Forward `engine.maxHttpBufferSize` to the Bun engine binding so both HTTP body limits and WebSocket payload limits are correctly bounded under `@fluojs/platform-bun`.
- 00f4d90: Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

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
- Updated dependencies [53d3fbb]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [a124d8c]
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
- Updated dependencies [57d61c0]
- Updated dependencies [ac77310]
  - @fluojs/http@1.0.0
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0
  - @fluojs/websockets@1.0.0

## 1.0.0-beta.4

### Patch Changes

- [#1641](https://github.com/fluojs/fluo/pull/1641) [`0e7f485`](https://github.com/fluojs/fluo/commit/0e7f485e4bf4651d48edd0e6079517dc051a6524) Thanks [@ayden94](https://github.com/ayden94)! - Fix namespace, shutdown, and payload limit behavioral contract risks:
  - Set `cleanupEmptyChildNamespaces: false` to ensure Socket.IO v4 defaults don't prematurely clean up statically defined gateway namespaces.
  - Detach the underlying HTTP server from the Socket.IO instance before calling `io.close()` during shutdown so Socket.IO cleans up clients without closing adapter-owned/shared HTTP listeners.
  - Forward `engine.maxHttpBufferSize` to the Bun engine binding so both HTTP body limits and WebSocket payload limits are correctly bounded under `@fluojs/platform-bun`.
- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f), [`57d61c0`](https://github.com/fluojs/fluo/commit/57d61c0ade9112be48455c48f8ed86d11e46c726), [`ac77310`](https://github.com/fluojs/fluo/commit/ac7731044ea42347eafe5d2cc7a5c88af5dcda9d)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12
  - @fluojs/websockets@1.0.0-beta.6

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

## 1.0.0-beta.2

### Patch Changes

- [#1349](https://github.com/fluojs/fluo/pull/1349) [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a) Thanks [@ayden94](https://github.com/ayden94)! - Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
