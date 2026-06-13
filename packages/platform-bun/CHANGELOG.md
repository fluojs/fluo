# @fluojs/platform-bun

## 1.0.7

### Patch Changes

- [#2250](https://github.com/fluojs/fluo/pull/2250) [`77445cf`](https://github.com/fluojs/fluo/commit/77445cf982821e6b823cacedfd354fabd18bb11b) Thanks [@ayden94](https://github.com/ayden94)! - Guard Bun adapter lifecycle mutations by keeping duplicate `listen()` calls bound to the original live dispatcher, rejecting realtime binding changes after startup, validating signal shutdown timeouts before registration, and documenting the synchronous fetch-handler contract.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## [Unreleased]

## 1.0.6

### Patch Changes

- [#2086](https://github.com/fluojs/fluo/pull/2086) [`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65) Thanks [@ayden94](https://github.com/ayden94)! - Keep the runtime internal HTTP adapter seam free of Node-specific console logger globals, and route platform defaults through either the transport-neutral logger or the explicit Node runtime subpath.

- [#2085](https://github.com/fluojs/fluo/pull/2085) [`3b3331a`](https://github.com/fluojs/fluo/commit/3b3331a55ad99fde975f18b5907aeba5dbc72cc7) Thanks [@ayden94](https://github.com/ayden94)! - Harden Bun adapter startup so websocket upgrade requests fall back to HTTP dispatch unless the realtime binding actually upgrades the request, and omit the native `routes` option unless safe Bun routes are concretely enabled.

- Updated dependencies [[`06f35cb`](https://github.com/fluojs/fluo/commit/06f35cbef3a0343a6745e658c120eb19d15d4480), [`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/http@1.1.1
  - @fluojs/runtime@1.1.7

## 1.0.5

### Patch Changes

- [#2038](https://github.com/fluojs/fluo/pull/2038) [`4403acd`](https://github.com/fluojs/fluo/commit/4403acdf90ed3335895c4eb43a304161476cff57) Thanks [@ayden94](https://github.com/ayden94)! - Restore generated Node starter runtime log colors by using platform startup helpers and internalizing runtime logger selection instead of accepting logger overrides in app options.

- Updated dependencies [[`4403acd`](https://github.com/fluojs/fluo/commit/4403acdf90ed3335895c4eb43a304161476cff57)]:
  - @fluojs/runtime@1.1.5

## 1.0.4

### Patch Changes

- [#2035](https://github.com/fluojs/fluo/pull/2035) [`8e3b443`](https://github.com/fluojs/fluo/commit/8e3b44385c8c3adeaef26e3b492c842d30c19def) Thanks [@ayden94](https://github.com/ayden94)! - Restore console-style logger defaults for Bun and Deno terminal startup helpers while keeping shared/root and Worker bootstrap logging transport-neutral.

- Updated dependencies [[`8e3b443`](https://github.com/fluojs/fluo/commit/8e3b44385c8c3adeaef26e3b492c842d30c19def)]:
  - @fluojs/runtime@1.1.4

## 1.0.3

### Patch Changes

- [#2028](https://github.com/fluojs/fluo/pull/2028) [`625b8d4`](https://github.com/fluojs/fluo/commit/625b8d4229a9cfceae3e58d7b8cfc525bb0a56a7) Thanks [@ayden94](https://github.com/ayden94)! - Harden platform adapter option validation, shutdown lifecycle reuse, and contract documentation for Bun, Deno, Cloudflare Workers, Express, and Fastify.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.2

### Patch Changes

- [#1860](https://github.com/fluojs/fluo/pull/1860) [`60c2782`](https://github.com/fluojs/fluo/commit/60c27823003df01d22cc0d71e4d49f63d77b225f) Thanks [@ayden94](https://github.com/ayden94)! - Reject Bun websocket upgrade attempts with the documented 503 shutdown response once adapter close begins, keeping shutdown ingress behavior consistent across HTTP and realtime paths.

- Updated dependencies [[`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/runtime@1.1.0

## 1.0.0

### Minor Changes

- 28ca2ef: Expose `Dispatcher.describeRoutes?.()` for adapter-side route introspection and let the Bun adapter pre-register semver-safe `Bun.serve({ routes })` entries for compatible static and parameter routes. Same-shape parameter routes, `ALL` handlers, older Bun runtimes, and other unsupported shapes continue to fall back to fetch-only dispatch so fluo path, error, and request-body semantics stay unchanged.

### Patch Changes

- dd33c35: Document Bun adapter API contracts and add package-local web-runtime portability conformance coverage.
- 45e0f1b: Keep fetch-style platform adapter runtime imports off the HTTP root barrel and remove eager Node built-in imports from HTTP request-id/context helpers so edge bundles can instantiate without Node built-in shims.
- 37ae1c5: Add conservative HTTP fast-path execution and native route handoff optimizations for singleton-safe routes while preserving middleware, guards, pipes, interceptors, error handling, adapter fallback, raw-body, multipart, streaming, abort, and request-scope behavior.
- 53a2b8e: Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

- c3ef937: Reuse shared Web request-response factories across adapter requests while preserving per-request body materialization and error/fallback response semantics.
- 69936b1: Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.
- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
- Updated dependencies [fa0ecca]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
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

## 1.0.0-beta.7

### Patch Changes

- [#1764](https://github.com/fluojs/fluo/pull/1764) [`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74) Thanks [@ayden94](https://github.com/ayden94)! - Keep fetch-style platform adapter runtime imports off the HTTP root barrel and remove eager Node built-in imports from HTTP request-id/context helpers so edge bundles can instantiate without Node built-in shims.

- Updated dependencies [[`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74), [`7b50db8`](https://github.com/fluojs/fluo/commit/7b50db85e95e2341f82d006f1e665c2bbcebeaa5)]:
  - @fluojs/http@1.0.0-beta.11

## 1.0.0-beta.6

### Patch Changes

- [#1480](https://github.com/fluojs/fluo/pull/1480) [`37ae1c5`](https://github.com/fluojs/fluo/commit/37ae1c594e0a2330cae10faddb350cd2a039643c) Thanks [@ayden94](https://github.com/ayden94)! - Add conservative HTTP fast-path execution and native route handoff optimizations for singleton-safe routes while preserving middleware, guards, pipes, interceptors, error handling, adapter fallback, raw-body, multipart, streaming, abort, and request-scope behavior.

- Updated dependencies [[`37ae1c5`](https://github.com/fluojs/fluo/commit/37ae1c594e0a2330cae10faddb350cd2a039643c)]:
  - @fluojs/http@1.0.0-beta.6
  - @fluojs/runtime@1.0.0-beta.8

## 1.0.0-beta.5

### Patch Changes

- [#1467](https://github.com/fluojs/fluo/pull/1467) [`c3ef937`](https://github.com/fluojs/fluo/commit/c3ef9375d83e9c3ee0e3caf52f6b3414c5b8e5d3) Thanks [@ayden94](https://github.com/ayden94)! - Reuse shared Web request-response factories across adapter requests while preserving per-request body materialization and error/fallback response semantics.

- Updated dependencies [[`c3ef937`](https://github.com/fluojs/fluo/commit/c3ef9375d83e9c3ee0e3caf52f6b3414c5b8e5d3)]:
  - @fluojs/runtime@1.0.0-beta.6

## 1.0.0-beta.4

### Patch Changes

- [#1454](https://github.com/fluojs/fluo/pull/1454) [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27) Thanks [@ayden94](https://github.com/ayden94)! - Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

- [#1459](https://github.com/fluojs/fluo/pull/1459) [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946) Thanks [@ayden94](https://github.com/ayden94)! - Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.

- Updated dependencies [[`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0), [`48a9f97`](https://github.com/fluojs/fluo/commit/48a9f9761c093e6622922719869a29a84f7d0079), [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27), [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946), [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/http@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.5

## 1.0.0-beta.3

### Minor Changes

- [#1441](https://github.com/fluojs/fluo/pull/1441) [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d) Thanks [@ayden94](https://github.com/ayden94)! - Expose `Dispatcher.describeRoutes?.()` for adapter-side route introspection and let the Bun adapter pre-register semver-safe `Bun.serve({ routes })` entries for compatible static and parameter routes. Same-shape parameter routes, `ALL` handlers, older Bun runtimes, and other unsupported shapes continue to fall back to fetch-only dispatch so fluo path, error, and request-body semantics stay unchanged.

### Patch Changes

- Updated dependencies [[`01d5e65`](https://github.com/fluojs/fluo/commit/01d5e65f053db99704d9cb30585c75b94dd38367), [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6), [`89f6379`](https://github.com/fluojs/fluo/commit/89f637935736c0fe9c52668a5b714c5c0e394af1), [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d)]:
  - @fluojs/http@1.0.0-beta.3
  - @fluojs/runtime@1.0.0-beta.4

## 1.0.0-beta.2

### Patch Changes

- [#1370](https://github.com/fluojs/fluo/pull/1370) [`dd33c35`](https://github.com/fluojs/fluo/commit/dd33c35027faec71ce004c03e17201539392f570) Thanks [@ayden94](https://github.com/ayden94)! - Document Bun adapter API contracts and add package-local web-runtime portability conformance coverage.

- Updated dependencies [[`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/runtime@1.0.0-beta.2
