# @fluojs/react

## [Unreleased]

## 0.1.0

### Minor Changes

- [#2722](https://github.com/fluojs/fluo/pull/2722) [`2c42784`](https://github.com/fluojs/fluo/commit/2c427842f5f5cdbbe2e358a109d544f308d82c6a) Thanks [@ayden94](https://github.com/ayden94)! - Prototype signed, bounded experimental Server Functions on `@fluojs/react/experimental/rsc` while preserving ordinary fluo HTTP dispatch, guards, middleware, interceptors, request scopes, and error semantics.

- [#2704](https://github.com/fluojs/fluo/pull/2704) [`f024dbe`](https://github.com/fluojs/fluo/commit/f024dbe86fc0658c14954a1f3b7d56cbe9e851cc) Thanks [@ayden94](https://github.com/ayden94)! - Add the `@fluojs/react/client` subpath with progressive links, HTTP-first browser navigation, hydration-safe route snapshots, and URL/navigation state hooks.

- [#2503](https://github.com/fluojs/fluo/pull/2503) [`2871c6f`](https://github.com/fluojs/fluo/commit/2871c6fab63966e7b71e5965baf16c5ba40ad685) Thanks [@ayden94](https://github.com/ayden94)! - Introduce the runtime-neutral `@fluojs/react` package scaffold as the planned first `0.1.0` public React integration surface, with root import boundary tests, README placeholders, and React peer dependency policy.

- [#2720](https://github.com/fluojs/fluo/pull/2720) [`6ae880c`](https://github.com/fluojs/fluo/commit/6ae880c80132f4d41b367cd46c709bba888622fd) Thanks [@ayden94](https://github.com/ayden94)! - Add the explicitly unstable `@fluojs/react/experimental/rsc` subpath with exact React version diagnostics, client-reference and server-to-client module mapping seams, and Flight payload responses that stay inside the existing fluo HTTP dispatch lifecycle.

- [#2508](https://github.com/fluojs/fluo/pull/2508) [`82e9947`](https://github.com/fluojs/fluo/commit/82e9947ab728d0f86683b67ec02968febb726be9) Thanks [@ayden94](https://github.com/ayden94)! - Add explicit React hydration asset options for Web Streams SSR, including bootstrap scripts/modules, trusted inline bootstrap content, CSP nonce, identifier prefix, and trusted asset map snapshots.

- [#2505](https://github.com/fluojs/fluo/pull/2505) [`439f9fe`](https://github.com/fluojs/fluo/commit/439f9fe008d4d706004e6c3375de9ca841b6d37c) Thanks [@ayden94](https://github.com/ayden94)! - Add `ReactModule.forRoot({ controllers: [...] })` so React routers register through the existing fluo module and HTTP handler metadata path without introducing a separate React URL matcher.

- [#2504](https://github.com/fluojs/fluo/pull/2504) [`ccc842f`](https://github.com/fluojs/fluo/commit/ccc842f5ff3c0ca450d726fdaad778443deae336) Thanks [@ayden94](https://github.com/ayden94)! - Add `@Router(...)` and `@Path(...)` decorators that write existing HTTP controller and `GET` route metadata while recording React-specific marker and render metadata for diagnostics and future rendering integration.

- [#2510](https://github.com/fluojs/fluo/pull/2510) [`77cc23f`](https://github.com/fluojs/fluo/commit/77cc23fb94430051ed06156a52d40c67629aaa61) Thanks [@ayden94](https://github.com/ayden94)! - Ship the `0.1.0` stable SSR MVP release metadata for `@fluojs/react`, covering HTTP-owned React routing facades, DTO-bound path and search params, Web Streams SSR, explicit hydration asset options, and examples/docs that keep RSC, Server Functions, Vite assets, and client navigation outside the stable root contract.

- [#2511](https://github.com/fluojs/fluo/pull/2511) [`35a7ce3`](https://github.com/fluojs/fluo/commit/35a7ce3d1f8235f2ea500de1c9c2134a74d60f8d) Thanks [@ayden94](https://github.com/ayden94)! - Add the `@fluojs/react/vite` subpath for parsing Vite server/client entry manifests into deterministic CSS, JavaScript bootstrap assets, asset maps, trusted bootstrap data, CSP nonce propagation, and diagnostics that feed the existing React hydration asset contract.

- [#2507](https://github.com/fluojs/fluo/pull/2507) [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb) Thanks [@ayden94](https://github.com/ayden94)! - Add the React Web Streams SSR core so React page handlers can return `ReactServerEntry` values that preserve the existing HTTP pipeline before streamed HTML finalization.

### Patch Changes

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/core@1.1.0
