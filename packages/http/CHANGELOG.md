# @fluojs/http

## [Unreleased]

## 3.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

### Minor Changes

- [#3562](https://github.com/fluojs/fluo/pull/3562) [`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a) Thanks [@ayden94](https://github.com/ayden94)! - Add `createAccessLogObserver(...)` for safe, structured HTTP access logging with awaited application-owned sinks, trusted client identity, header allowlisting and redaction, monotonic durations, lifecycle outcomes, and native adapter fallback parity.

- [#3319](https://github.com/fluojs/fluo/pull/3319) [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192) Thanks [@ayden94](https://github.com/ayden94)! - Add an optional request-scoped Early Hints capability with deterministic write, error, and disconnect behavior.

  Emit observable HTTP `103` responses from Node.js, Express, and Fastify without mutating or committing the independently configured final response. Keep Fetch-style Web, Bun, Deno, and Cloudflare Workers responses detectably unsupported through capability absence instead of a silent no-op.

- [#3560](https://github.com/fluojs/fluo/pull/3560) [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317) Thanks [@ayden94](https://github.com/ayden94)! - Add portable RFC single-byte-range responses with conditional `If-Range` integration, identity-byte partial delivery, and cross-adapter conformance coverage.

- [#3402](https://github.com/fluojs/fluo/pull/3402) [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3) Thanks [@ayden94](https://github.com/ayden94)! - Add typed internal HTTP response writer and result-finalizer integration seams, plus a portable HTTP authoring entrypoint that avoids Node async-context bootstrap.

  Keep the `@fluojs/react` root free of eager Node built-ins by consuming the portable HTTP and runtime-internal authoring seams while preserving stable SSR, direct page finalization, and experimental Flight response behavior.

- [#3552](https://github.com/fluojs/fluo/pull/3552) [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9) Thanks [@ayden94](https://github.com/ayden94)! - Add RFC 9110 conditional request handling with explicit representation existence, validated entity-tag and HTTP-date parsing, middleware/guard-safe evaluation, and Node.js/Express/Fastify listener plus Bun/Deno/Cloudflare fetch-adapter conformance coverage.

- [#3549](https://github.com/fluojs/fluo/pull/3549) [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea) Thanks [@ayden94](https://github.com/ayden94)! - Add `@FromFiles(fieldname?)` for binding portable multipart file arrays into request DTOs.

- [#2898](https://github.com/fluojs/fluo/pull/2898) [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d) Thanks [@ayden94](https://github.com/ayden94)! - Add an HTTP-owned, content-negotiated error representation seam that preserves canonical JSON by default, optionally renders application-owned HTML for classified errors and route misses, and keeps status, headers, `HEAD`, abort, commit, and one-shot fallback behavior in the dispatcher.

  Expose runtime bootstrap wiring, a buffered React error-document provider adapter, and typed network/fetch-style portability assertions for the new representation contract.

  Preserve existing Express response `Vary` values when HTTP error representation negotiation adds `Accept`.

- [#3554](https://github.com/fluojs/fluo/pull/3554) [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7) Thanks [@ayden94](https://github.com/ayden94)! - Expose runtime bootstrap content negotiation, deterministic formatter selection, and canonical successful `Vary: Accept` responses.

- [#3548](https://github.com/fluojs/fluo/pull/3548) [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389) Thanks [@ayden94](https://github.com/ayden94)! - Add portable response-header lookup helpers and safe `Content-Disposition` filename formatting
  with escaped ASCII fallback and deterministic UTF-8 `filename*` parameters.

- [#3534](https://github.com/fluojs/fluo/pull/3534) [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049) Thanks [@ayden94](https://github.com/ayden94)! - Add portable `setCookie` and `clearCookie` response helpers with ordered, non-folded `Set-Cookie` fields and whole-second lifetime semantics across adapters. Add response-cookie portability assertions for Node, Express, Fastify, Web, Bun, Deno, and Workers.

- [#3564](https://github.com/fluojs/fluo/pull/3564) [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a) Thanks [@ayden94](https://github.com/ayden94)! - Add portable static asset middleware backed by explicit application-owned sources. Node applications can use `createNodeFileSystemAssetSource` for root-confined files, representation-specific cache validators, byte ranges, and precompressed variants; Web and edge applications provide their own source.

- [#3300](https://github.com/fluojs/fluo/pull/3300) [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2) Thanks [@ayden94](https://github.com/ayden94)! - Add an optional, independently versioned fetch-style realtime binding installation extension while preserving the public capability version 1 contract, and expose the shared internal gateway discovery seam for protocol adapters.

  Make Socket.IO attach connection lifecycle buffering before asynchronous gateway resolution, drain accepted gateway work before clearing managed state, share one bounded attempt across runtime shutdown hooks with explicit `retryShutdown()` recovery, clean pre-listen Bun bindings after bootstrap failure, reject unsupported `serverBacked` gateways consistently, dispatch through canonical handler indexes, and align runtime manifests, migration, and bilingual option documentation.

  Existing Socket.IO gateways configured with `@WebSocketGateway({ serverBacked })` must remove that option and use the shared application listener. Consumers that require a dedicated listener must migrate that gateway to `@fluojs/websockets/node` or own a separate Socket.IO server outside this adapter.

- [#3317](https://github.com/fluojs/fluo/pull/3317) [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac) Thanks [@ayden94](https://github.com/ayden94)! - Add portable `getRequestHeader(request, name)` and `appendVaryHeader(response, ...fields)` helpers to
  `@fluojs/http`, then route DTO header binding, request-id extraction, version header reads, CORS,
  and negotiated error responses through the shared contract.

- [#3078](https://github.com/fluojs/fluo/pull/3078) [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317) Thanks [@ayden94](https://github.com/ayden94)! - Add validated uppercase custom HTTP route authoring with `Route(method, path)` and first-class RFC `Query(path)` support while preserving exact-method precedence, versioning, DTO validation, and default response semantics.

  Widen the internal route metadata method declaration so HTTP integrations can carry custom tokens, keep custom methods on Bun fetch fallback, and let Fastify wildcard fallback receive registered custom method names without creating native fluo route handoffs.

  Expose shared network and fetch-style portability assertions for body-bearing `QUERY` and extension-method routes across supported adapters.

  Require Node.js `>=24.0.0 <27` for published Node listener paths and generated Node HTTP starters so RFC `QUERY` reaches framework dispatch. This final coordinated-release policy supersedes the earlier listener-only Node floor. Bun and Deno fetch-style adapter contracts are unchanged. Cloudflare Workers' documented fetch-style contract includes body-bearing `QUERY` and extension-method dispatch through its Worker fetch handler.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Regenerated Node HTTP projects use the same Node support range. Custom-method and portability additions remain part of this one upcoming release per package.

- [#3559](https://github.com/fluojs/fluo/pull/3559) [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758) Thanks [@ayden94](https://github.com/ayden94)! - Add immutable, trust-aware HTTP connection resolution with explicit hop, CIDR, and predicate proxy policies. Node-backed adapters now snapshot portable transport metadata, and rate-limit consumers can migrate from `trustProxyHeaders` to `trustProxy`.

### Patch Changes

- [#2848](https://github.com/fluojs/fluo/pull/2848) [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6) Thanks [@ayden94](https://github.com/ayden94)! - Add the request-local HTTP response-finalization seam used by React page rendering. Allow `@Path(...)` handlers to return one `ReactElement` through the configured application page renderer, and add stable SSR diagnostic codes and phases for HTTP pipeline failures, pre-commit shell failures, request aborts, and post-shell recoverable errors.

- [#2985](https://github.com/fluojs/fluo/pull/2985) [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340) Thanks [@ayden94](https://github.com/ayden94)! - Cancel managed SSE backpressure waits on request abort or stream close so an unsettled adapter drain cannot delay iterator cleanup or request-scope disposal.

- [#2885](https://github.com/fluojs/fluo/pull/2885) [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e) Thanks [@ayden94](https://github.com/ayden94)! - Correct the public TSDoc classification for the fast-path observability symbols.

- [#3316](https://github.com/fluojs/fluo/pull/3316) [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3) Thanks [@ayden94](https://github.com/ayden94)! - Defer request success observers until application and module middleware have fully settled, so middleware failures after `next()` emit only the request error observation.

- [#3567](https://github.com/fluojs/fluo/pull/3567) [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79) Thanks [@ayden94](https://github.com/ayden94)! - Correct the README Quick Start DTO example so the documented snippet compiles with the Babel decorator configuration Fluo ships. Decorated DTO fields are now initialized instead of using a definite assignment assertion, and both READMEs state that constraint.

- [#3550](https://github.com/fluojs/fluo/pull/3550) [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d) Thanks [@ayden94](https://github.com/ayden94)! - Freeze HandlerMapping descriptors so route inspection remains synchronized with matching.

- [#3556](https://github.com/fluojs/fluo/pull/3556) [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a) Thanks [@ayden94](https://github.com/ayden94)! - Keep manual SSE dispatch active through stream close or abort. Late client aborts no longer
  emit request-success observation, custom Web response factories remain compatible without
  `responseReady`, and Cloudflare Worker ownership now waits for both response-body termination
  and dispatcher completion.

- [#3025](https://github.com/fluojs/fluo/pull/3025) [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b) Thanks [@ayden94](https://github.com/ayden94)! - Assign deterministic compiler-owned route identities and prevent distinct compiled handlers with matching display names or source from sharing rate-limit buckets.

- [#3053](https://github.com/fluojs/fluo/pull/3053) [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b) Thanks [@ayden94](https://github.com/ayden94)! - Isolate fast-path eligibility per dispatcher so shared handler mappings cannot select the wrong request pipeline, and freeze the exposed eligibility diagnostics.

- [#2974](https://github.com/fluojs/fluo/pull/2974) [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736) Thanks [@ayden94](https://github.com/ayden94)! - Preserve transient controller and dependency identity by resolving fast-path controllers through the active DI container for every dispatch.

- [#3553](https://github.com/fluojs/fluo/pull/3553) [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e) Thanks [@ayden94](https://github.com/ayden94)! - Preserve registered DTO converter resolution failures while retaining direct construction only for explicitly unregistered converter classes. Request-scoped converters now keep their container-owned lifecycle and disposal behavior during HTTP binding.

- [#2826](https://github.com/fluojs/fluo/pull/2826) [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9) Thanks [@ayden94](https://github.com/ayden94)! - Treat either request abort surface as authoritative and preserve request context through promise-returning callbacks without patching global promise continuations.

- [#3545](https://github.com/fluojs/fluo/pull/3545) [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566) Thanks [@ayden94](https://github.com/ayden94)! - Reuse the portable HTTP cookie serializer for Passport authentication cookies while preserving established defaults, attribute ordering, and append behavior. Values such as `token with spaces` now emit as `token%20with%20spaces`, and invalid cookie names or attributes fail the portable serializer's validation instead of producing malformed headers.

- [#3461](https://github.com/fluojs/fluo/pull/3461) [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409) Thanks [@ayden94](https://github.com/ayden94)! - Route HTTP and GraphQL DTO metadata reads through `@fluojs/core/request-pipeline` so first-party request processing remains on the documented integration seam.

- [#3074](https://github.com/fluojs/fluo/pull/3074) [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8) Thanks [@ayden94](https://github.com/ayden94)! - Suppress framework-managed response bodies for `HEAD` requests while preserving selected status and headers across successful, canonical JSON error, negotiated error, and `406` outcomes.

  Extend the shared HTTP adapter portability assertion to cover successful and canonical JSON `HEAD` responses across supported network and fetch-style adapters.

  Preserve Express response metadata by committing framework-suppressed `HEAD` bodies without reserializing them as empty text.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- Updated dependencies [[`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`8b63f78`](https://github.com/fluojs/fluo/commit/8b63f78b87f4cd28c040d4a5bf50bb26501b5b7d), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`4f89ac4`](https://github.com/fluojs/fluo/commit/4f89ac4dc77169badb160804d86f78d612989af4), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`758fa42`](https://github.com/fluojs/fluo/commit/758fa42f64317751123d5a9ff8e03c414fc20fb2), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`2cce586`](https://github.com/fluojs/fluo/commit/2cce58646b5b10e6fb39c4b54c1d74734e7308c5), [`5e59219`](https://github.com/fluojs/fluo/commit/5e59219c5346d9fa3d70719f7204fcf5e9f602f6), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`5dec76e`](https://github.com/fluojs/fluo/commit/5dec76e05a229b4ef52d112fd593bc167e650a3c), [`08ea346`](https://github.com/fluojs/fluo/commit/08ea346cdfb087da050f961cdb4d5841dc922e51), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0
  - @fluojs/validation@2.0.0

## 2.0.1

### Patch Changes

- [#2760](https://github.com/fluojs/fluo/pull/2760) [`c0ebd48`](https://github.com/fluojs/fluo/commit/c0ebd485d5dcd0922ab93f2e4086428a3e64cf04) Thanks [@ayden94](https://github.com/ayden94)! - Reject managed SSE async iterables when the active adapter does not expose `FrameworkResponse.stream` instead of silently reporting the stream as handled. The dispatcher now surfaces an unsupported-stream failure through the standard dispatch error path before marking the response committed, aligning managed SSE with the documented adapter contract.

## 2.0.0

### Major Changes

- [#2439](https://github.com/fluojs/fluo/pull/2439) [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff) Thanks [@ayden94](https://github.com/ayden94)! - Change the public `ResponseFormatter.format(...)` return contract from Node-specific `Buffer` to runtime-neutral `Uint8Array` bytes, preserving the root HTTP API portability guarantee. Existing Node.js formatters that return `Buffer` still satisfy the interface because `Buffer` implements `Uint8Array`; callers should use `Uint8Array` byte APIs instead of Buffer-specific methods.

### Patch Changes

- [#2638](https://github.com/fluojs/fluo/pull/2638) [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588) Thanks [@ayden94](https://github.com/ayden94)! - Await managed SSE iterator cleanup before disposing request-scoped resources, and report cleanup failures without rewriting committed responses.

- [#2381](https://github.com/fluojs/fluo/pull/2381) [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351) Thanks [@ayden94](https://github.com/ayden94)! - Harden the Fastify adapter lifecycle so shutdown cancels retrying startup before later binds can occur, refresh native route descriptor handoffs across adapter reuse, let explicit OPTIONS routes run instead of being mistaken for CORS preflight requests, and remove the adapter-local runtime-specific FrameworkRequest file type augmentation.

- [#2507](https://github.com/fluojs/fluo/pull/2507) [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb) Thanks [@ayden94](https://github.com/ayden94)! - Add the React Web Streams SSR core so React page handlers can return `ReactServerEntry` values that preserve the existing HTTP pipeline before streamed HTML finalization.

- Updated dependencies [[`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`2c09f35`](https://github.com/fluojs/fluo/commit/2c09f3541a6ffb33a26e045f531fbecbabd5dfe7), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`94f6518`](https://github.com/fluojs/fluo/commit/94f6518bf26b6bb412759c48d043e05e153ce533), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/di@2.0.0
  - @fluojs/validation@1.0.6
  - @fluojs/core@1.1.0

## 1.1.2

### Patch Changes

- [#2244](https://github.com/fluojs/fluo/pull/2244) [`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4) Thanks [@ayden94](https://github.com/ayden94)! - Preserve adapter `isAborted()` probes on dispatch request clones and keep lazy Node request context resolution isolated for overlapping promise-returning callbacks.

## 1.1.1

### Patch Changes

- [#2077](https://github.com/fluojs/fluo/pull/2077) [`06f35cb`](https://github.com/fluojs/fluo/commit/06f35cbef3a0343a6745e658c120eb19d15d4480) Thanks [@ayden94](https://github.com/ayden94)! - Guard request-context storage resolution so importing `@fluojs/http` does not crash when host `async_hooks` probes throw, while preserving lazy ALS resolution and synchronous fallback behavior.

## 1.1.0

### Minor Changes

- [#1962](https://github.com/fluojs/fluo/pull/1962) [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016) Thanks [@ayden94](https://github.com/ayden94)! - Support managed `AsyncIterable<SseMessage<T> | T>` return values from `@Sse()` handlers, including SSE framing, abort cleanup, backpressure drain handling, and documented stream error behavior without adding an RxJS dependency.

- [#1957](https://github.com/fluojs/fluo/pull/1957) [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0) Thanks [@ayden94](https://github.com/ayden94)! - Add the Phase 1 `@Sse(path)` route decorator that registers a GET route with `text/event-stream` produces metadata while keeping `SseResponse` creation in handlers.

### Patch Changes

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`45b50e6`](https://github.com/fluojs/fluo/commit/45b50e649b5f3a833555523c20b11d3bb0a07f5b), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8)]:
  - @fluojs/core@1.0.3
  - @fluojs/validation@1.0.4
  - @fluojs/di@1.0.3

## 1.0.0

### Minor Changes

- 28ca2ef: Expose `Dispatcher.describeRoutes?.()` for adapter-side route introspection and let the Bun adapter pre-register semver-safe `Bun.serve({ routes })` entries for compatible static and parameter routes. Same-shape parameter routes, `ALL` handlers, older Bun runtimes, and other unsupported shapes continue to fall back to fetch-only dispatch so fluo path, error, and request-body semantics stay unchanged.

### Patch Changes

- 01d5e65: Improve `@fluojs/http` dispatcher and route-matching hot paths by short-circuiting empty middleware/guard/interceptor/observer chains and pre-indexing static routes for faster request matching.
- 4fdb48c: Support Bun legacy decorator bundle output for HTTP route metadata while preserving the TC39 standard decorator metadata path.
- 72462e3: Reduce `@RequestDto()` binding overhead by reusing compiled HTTP DTO binding plans while preserving request-scoped converter resolution and existing validation/binding error contracts.
- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- 3f70169: Route semantically safe Express native matches through the shared dispatcher native fast path when eligible while preserving full dispatcher fallback, body materialization, error handling, and documented route fallback semantics. Synthetic dispatch requests also preserve request extension data so testing helpers can continue injecting principals into `RequestContext`.
- a625716: Allow simple `@RequestDto` routes to use the shared dispatcher fast path while preserving binding, validation, request-scope, middleware, guard, and interceptor behavior.
- 45e0f1b: Keep fetch-style platform adapter runtime imports off the HTTP root barrel and remove eager Node built-in imports from HTTP request-id/context helpers so edge bundles can instantiate without Node built-in shims.
- b82b28f: Reduce dispatcher route-param update overhead by using direct assignment for standard writable request objects while preserving descriptor-based fallback behavior for custom request shapes.
- 37ae1c5: Add conservative HTTP fast-path execution and native route handoff optimizations for singleton-safe routes while preserving middleware, guards, pipes, interceptors, error handling, adapter fallback, raw-body, multipart, streaming, abort, and request-scope behavior.
- 16420f9: Improve `@fluojs/platform-fastify` request dispatch by registering Fastify-native per-route handlers when fluo route metadata can be translated safely, while keeping wildcard fallback behavior for unmatched requests.

  Preserve fluo route semantics for params, versioning, middleware/guard/interceptor/observer lifecycle, error handling, SSE, multipart, raw body, and streaming with regression coverage for native route selection.

- 53a2b8e: Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

- e1bce3d: Reduce singleton-route dispatcher overhead by caching stable execution plans while preserving lazy request-scope promotion, route-matched middleware behavior, observer callbacks, and request-scoped DI isolation.
- 3baf5df: Improve `@RequestDto` request-pipeline throughput by skipping unnecessary validation work for DTOs without validation rules and by reducing per-request binding overhead on the common no-converter path.
- 7b50db8: Apply opt-in fast-path debug headers to adapter-native route handoffs and document explicit HTTP DTO field binding in the beginner routing guide.
- 69936b1: Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.
- 35f60fd: Skip HTTP request-scope container creation for singleton-only routes while preserving isolated request-scoped DI whenever a controller graph, middleware, guard, interceptor, observer, DTO converter, or custom binder may require it.
- Updated dependencies [4fdb48c]
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
- Updated dependencies [1911e11]
- Updated dependencies [aaab8c4]
- Updated dependencies [65a08db]
- Updated dependencies [35f60fd]
- Updated dependencies [8422e56]
  - @fluojs/core@1.0.0
  - @fluojs/di@1.0.0
  - @fluojs/validation@1.0.0

## 1.0.0-beta.11

### Patch Changes

- [#1764](https://github.com/fluojs/fluo/pull/1764) [`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74) Thanks [@ayden94](https://github.com/ayden94)! - Keep fetch-style platform adapter runtime imports off the HTTP root barrel and remove eager Node built-in imports from HTTP request-id/context helpers so edge bundles can instantiate without Node built-in shims.

- [#1815](https://github.com/fluojs/fluo/pull/1815) [`7b50db8`](https://github.com/fluojs/fluo/commit/7b50db85e95e2341f82d006f1e665c2bbcebeaa5) Thanks [@ayden94](https://github.com/ayden94)! - Apply opt-in fast-path debug headers to adapter-native route handoffs and document explicit HTTP DTO field binding in the beginner routing guide.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8

## 1.0.0-beta.10

### Patch Changes

- [#1550](https://github.com/fluojs/fluo/pull/1550) [`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3) Thanks [@ayden94](https://github.com/ayden94)! - Support Bun legacy decorator bundle output for HTTP route metadata while preserving the TC39 standard decorator metadata path.

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/validation@1.0.0-beta.3

## 1.0.0-beta.9

### Patch Changes

- [#1491](https://github.com/fluojs/fluo/pull/1491) [`b82b28f`](https://github.com/fluojs/fluo/commit/b82b28fbba8cd8bae631384757737db1bae2ff7f) Thanks [@ayden94](https://github.com/ayden94)! - Reduce dispatcher route-param update overhead by using direct assignment for standard writable request objects while preserving descriptor-based fallback behavior for custom request shapes.

## 1.0.0-beta.8

### Patch Changes

- [#1485](https://github.com/fluojs/fluo/pull/1485) [`a625716`](https://github.com/fluojs/fluo/commit/a625716f023ad18b3a6d0c6beb1fe8325612048c) Thanks [@ayden94](https://github.com/ayden94)! - Allow simple `@RequestDto` routes to use the shared dispatcher fast path while preserving binding, validation, request-scope, middleware, guard, and interceptor behavior.

## 1.0.0-beta.7

### Patch Changes

- [#1483](https://github.com/fluojs/fluo/pull/1483) [`3f70169`](https://github.com/fluojs/fluo/commit/3f70169c25e9cc04db6d01e7d4b17572d9174102) Thanks [@ayden94](https://github.com/ayden94)! - Route semantically safe Express native matches through the shared dispatcher native fast path when eligible while preserving full dispatcher fallback, body materialization, error handling, and documented route fallback semantics. Synthetic dispatch requests also preserve request extension data so testing helpers can continue injecting principals into `RequestContext`.

## 1.0.0-beta.6

### Patch Changes

- [#1480](https://github.com/fluojs/fluo/pull/1480) [`37ae1c5`](https://github.com/fluojs/fluo/commit/37ae1c594e0a2330cae10faddb350cd2a039643c) Thanks [@ayden94](https://github.com/ayden94)! - Add conservative HTTP fast-path execution and native route handoff optimizations for singleton-safe routes while preserving middleware, guards, pipes, interceptors, error handling, adapter fallback, raw-body, multipart, streaming, abort, and request-scope behavior.

## 1.0.0-beta.5

### Patch Changes

- [#1478](https://github.com/fluojs/fluo/pull/1478) [`e1bce3d`](https://github.com/fluojs/fluo/commit/e1bce3d758794b5a58704f5ccda7e0bf4aed01f0) Thanks [@ayden94](https://github.com/ayden94)! - Reduce singleton-route dispatcher overhead by caching stable execution plans while preserving lazy request-scope promotion, route-matched middleware behavior, observer callbacks, and request-scoped DI isolation.

- [#1475](https://github.com/fluojs/fluo/pull/1475) [`3baf5df`](https://github.com/fluojs/fluo/commit/3baf5dfc1e09d95f4869cd7d847b545c49609ed7) Thanks [@ayden94](https://github.com/ayden94)! - Improve `@RequestDto` request-pipeline throughput by skipping unnecessary validation work for DTOs without validation rules and by reducing per-request binding overhead on the common no-converter path.

## 1.0.0-beta.4

### Patch Changes

- [#1450](https://github.com/fluojs/fluo/pull/1450) [`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0) Thanks [@ayden94](https://github.com/ayden94)! - Reduce `@RequestDto()` binding overhead by reusing compiled HTTP DTO binding plans while preserving request-scoped converter resolution and existing validation/binding error contracts.

- [#1454](https://github.com/fluojs/fluo/pull/1454) [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27) Thanks [@ayden94](https://github.com/ayden94)! - Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

- [#1459](https://github.com/fluojs/fluo/pull/1459) [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946) Thanks [@ayden94](https://github.com/ayden94)! - Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.

- [#1458](https://github.com/fluojs/fluo/pull/1458) [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f) Thanks [@ayden94](https://github.com/ayden94)! - Skip HTTP request-scope container creation for singleton-only routes while preserving isolated request-scoped DI whenever a controller graph, middleware, guard, interceptor, observer, DTO converter, or custom binder may require it.

- Updated dependencies [[`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/di@1.0.0-beta.5

## 1.0.0-beta.3

### Minor Changes

- [#1441](https://github.com/fluojs/fluo/pull/1441) [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d) Thanks [@ayden94](https://github.com/ayden94)! - Expose `Dispatcher.describeRoutes?.()` for adapter-side route introspection and let the Bun adapter pre-register semver-safe `Bun.serve({ routes })` entries for compatible static and parameter routes. Same-shape parameter routes, `ALL` handlers, older Bun runtimes, and other unsupported shapes continue to fall back to fetch-only dispatch so fluo path, error, and request-body semantics stay unchanged.

### Patch Changes

- [#1438](https://github.com/fluojs/fluo/pull/1438) [`01d5e65`](https://github.com/fluojs/fluo/commit/01d5e65f053db99704d9cb30585c75b94dd38367) Thanks [@ayden94](https://github.com/ayden94)! - Improve `@fluojs/http` dispatcher and route-matching hot paths by short-circuiting empty middleware/guard/interceptor/observer chains and pre-indexing static routes for faster request matching.

- [#1439](https://github.com/fluojs/fluo/pull/1439) [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6) Thanks [@ayden94](https://github.com/ayden94)! - Improve `@fluojs/platform-fastify` request dispatch by registering Fastify-native per-route handlers when fluo route metadata can be translated safely, while keeping wildcard fallback behavior for unmatched requests.

  Preserve fluo route semantics for params, versioning, middleware/guard/interceptor/observer lifecycle, error handling, SSE, multipart, raw body, and streaming with regression coverage for native route selection.

- Updated dependencies [[`1911e11`](https://github.com/fluojs/fluo/commit/1911e110e7dbb5296238ccc0a2e167ed6f34df86)]:
  - @fluojs/di@1.0.0-beta.4

## 1.0.0-beta.2

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75)]:
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3
