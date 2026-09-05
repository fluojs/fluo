# @fluojs/runtime

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

- [#3050](https://github.com/fluojs/fluo/pull/3050) [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b) Thanks [@ayden94](https://github.com/ayden94)! - Preserve the documented application lifecycle state transitions and terminal operation gate, reject provider and child microservice operations once shutdown starts, and resume incomplete adapter or lifecycle-hook stages without repeating completed runtime phases.

  Application and application-context close delegate container teardown to `Container.dispose()`, so runtime consumers inherit the `@fluojs/di` 3.x retryable failed-hook contract. In 2.x, a failed container-managed `onDestroy()` hook was attempted once. After upgrading, a later explicit application or context `close()` retries only the hooks that failed, while hooks that completed successfully remain exactly-once. Consumers must make failing cleanup hooks safe to attempt again.

  Migration: Before upgrading from 2.x, make each container-managed `onDestroy()` hook idempotent or otherwise safe to retry. If a hook can fail after partially releasing resources, preserve enough state for a later `close()` call to resume the remaining cleanup without repeating completed side effects. Do not rely on a failed hook being skipped after its first attempt. Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

- [#2883](https://github.com/fluojs/fluo/pull/2883) [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846) Thanks [@ayden94](https://github.com/ayden94)! - Replace uncoordinated PlatformShell lifecycle overlap with strict exclusive transitions. Every overlapping `start()` or `stop()` now rejects immediately with `PlatformLifecycleConflictError` and structured `PLATFORM_LIFECYCLE_CONFLICT` metadata.

  In 2.x, overlapping `start()` calls could start the same components more than once, and `stop()` called during an in-flight startup could return before startup settled and leave resources running. Consumers must now give one application boundary ownership of each transition, wait for that owned promise to settle, and retry explicitly when a rejected operation is still required. Lifecycle callbacks receive the same typed conflict after synchronous or arbitrarily awaited reentry.

- [#3078](https://github.com/fluojs/fluo/pull/3078) [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317) Thanks [@ayden94](https://github.com/ayden94)! - Add validated uppercase custom HTTP route authoring with `Route(method, path)` and first-class RFC `Query(path)` support while preserving exact-method precedence, versioning, DTO validation, and default response semantics.

  Widen the internal route metadata method declaration so HTTP integrations can carry custom tokens, keep custom methods on Bun fetch fallback, and let Fastify wildcard fallback receive registered custom method names without creating native fluo route handoffs.

  Expose shared network and fetch-style portability assertions for body-bearing `QUERY` and extension-method routes across supported adapters.

  Require Node.js `>=24.0.0 <27` for published Node listener paths and generated Node HTTP starters so RFC `QUERY` reaches framework dispatch. This final coordinated-release policy supersedes the earlier listener-only Node floor. Bun and Deno fetch-style adapter contracts are unchanged. Cloudflare Workers' documented fetch-style contract includes body-bearing `QUERY` and extension-method dispatch through its Worker fetch handler.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Regenerated Node HTTP projects use the same Node support range. Custom-method and portability additions remain part of this one upcoming release per package.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

### Minor Changes

- [#3319](https://github.com/fluojs/fluo/pull/3319) [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192) Thanks [@ayden94](https://github.com/ayden94)! - Add an optional request-scoped Early Hints capability with deterministic write, error, and disconnect behavior.

  Emit observable HTTP `103` responses from Node.js, Express, and Fastify without mutating or committing the independently configured final response. Keep Fetch-style Web, Bun, Deno, and Cloudflare Workers responses detectably unsupported through capability absence instead of a silent no-op.

- [#3560](https://github.com/fluojs/fluo/pull/3560) [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317) Thanks [@ayden94](https://github.com/ayden94)! - Add portable RFC single-byte-range responses with conditional `If-Range` integration, identity-byte partial delivery, and cross-adapter conformance coverage.

- [#3402](https://github.com/fluojs/fluo/pull/3402) [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3) Thanks [@ayden94](https://github.com/ayden94)! - Add typed internal HTTP response writer and result-finalizer integration seams, plus a portable HTTP authoring entrypoint that avoids Node async-context bootstrap.

  Keep the `@fluojs/react` root free of eager Node built-ins by consuming the portable HTTP and runtime-internal authoring seams while preserving stable SSR, direct page finalization, and experimental Flight response behavior.

- [#3552](https://github.com/fluojs/fluo/pull/3552) [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9) Thanks [@ayden94](https://github.com/ayden94)! - Add RFC 9110 conditional request handling with explicit representation existence, validated entity-tag and HTTP-date parsing, middleware/guard-safe evaluation, and Node.js/Express/Fastify listener plus Bun/Deno/Cloudflare fetch-adapter conformance coverage.

- [#3675](https://github.com/fluojs/fluo/pull/3675) [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32) Thanks [@ayden94](https://github.com/ayden94)! - Add explicit `graphNodeId` correlation to Runtime-produced Studio route descriptors and consume it in the Studio route panel without changing existing graph node IDs. Studio continues to parse persisted legacy route descriptors that omit the field by materializing the previous route-node ID convention at the wire boundary.

- [#3440](https://github.com/fluojs/fluo/pull/3440) [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa) Thanks [@ayden94](https://github.com/ayden94)! - Expose Node.js plain HTTP `ServerOptions` through the raw Node adapter and reject configurations that combine them with HTTPS options.

- [#3686](https://github.com/fluojs/fluo/pull/3686) [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58) Thanks [@ayden94](https://github.com/ayden94)! - Bound module graph compile cache retention and allow application-owned caches to release retained snapshots on disposal.

- [#2851](https://github.com/fluojs/fluo/pull/2851) [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2) Thanks [@ayden94](https://github.com/ayden94)! - Add immutable React page catalogs and expose compiled route kinds, effective paths, versions, and parameter names through runtime inspection, `fluo inspect`, and Studio diagnostics.

- [#2898](https://github.com/fluojs/fluo/pull/2898) [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d) Thanks [@ayden94](https://github.com/ayden94)! - Add an HTTP-owned, content-negotiated error representation seam that preserves canonical JSON by default, optionally renders application-owned HTML for classified errors and route misses, and keeps status, headers, `HEAD`, abort, commit, and one-shot fallback behavior in the dispatcher.

  Expose runtime bootstrap wiring, a buffered React error-document provider adapter, and typed network/fetch-style portability assertions for the new representation contract.

  Preserve existing Express response `Vary` values when HTTP error representation negotiation adds `Accept`.

- [#3502](https://github.com/fluojs/fluo/pull/3502) [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835) Thanks [@ayden94](https://github.com/ayden94)! - Expose the transport-neutral Studio bridge subpath and allow host-owned bridges during runtime bootstrap.

- [#3554](https://github.com/fluojs/fluo/pull/3554) [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7) Thanks [@ayden94](https://github.com/ayden94)! - Expose runtime bootstrap content negotiation, deterministic formatter selection, and canonical successful `Vary: Accept` responses.

- [#3564](https://github.com/fluojs/fluo/pull/3564) [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a) Thanks [@ayden94](https://github.com/ayden94)! - Add portable static asset middleware backed by explicit application-owned sources. Node applications can use `createNodeFileSystemAssetSource` for root-confined files, representation-specific cache validators, byte ranges, and precompressed variants; Web and edge applications provide their own source.

- [#3689](https://github.com/fluojs/fluo/pull/3689) [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758) Thanks [@ayden94](https://github.com/ayden94)! - Add DI-backed route-scoped middleware options for generated health and readiness endpoints.

- [#3561](https://github.com/fluojs/fluo/pull/3561) [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c) Thanks [@ayden94](https://github.com/ayden94)! - Add portable `parseMultipartStream(...)` multipart consumption with typed field/file parts, bounded streaming limits, cancellation propagation, eager single-consumer protection, deterministic source cleanup, and Node.js/Express/Fastify/Web application opt-in through `multipart.strategy: 'stream'`. Buffered `parseMultipart(...)` restores valid token-form `Content-Disposition` name and filename parameters and correctly handles escaped quoted parameters while retaining its existing defaults unless limits are explicitly configured, so existing buffered consumers need no migration. Runtime route dispatch automatically returns route-owned iterators after handler completion to release active request resources; standalone `parseMultipartStream(...)` consumers must consume to completion or call `return()` themselves.

- [#3559](https://github.com/fluojs/fluo/pull/3559) [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758) Thanks [@ayden94](https://github.com/ayden94)! - Add immutable, trust-aware HTTP connection resolution with explicit hop, CIDR, and predicate proxy policies. Node-backed adapters now snapshot portable transport metadata, and rate-limit consumers can migrate from `trustProxyHeaders` to `trustProxy`.

### Patch Changes

- [#3683](https://github.com/fluojs/fluo/pull/3683) [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58) Thanks [@ayden94](https://github.com/ayden94)! - Add `TerminusModule.forRoot({ imports })` so DI-backed Prisma, Drizzle, and named Redis indicator providers can resolve dependency tokens owned by ordinary sibling modules. Terminus registers `indicatorProviders` in its own module scope, so a dependency module imported only into the surrounding application module is invisible to the indicators. `@fluojs/runtime` now preserves that module isolation for optional tokens: an optional token is `undefined` only when no provider registers it anywhere in the bootstrap graph; an existing but inaccessible sibling token fails module-graph validation with `MODULE_VISIBILITY_ERROR`. A missing required named Redis token and an existing but unimported optional Prisma or Drizzle owner token therefore fail bootstrap, while absent optional Prisma or Drizzle owner modules still let the application bootstrap and report the corresponding indicator as `down` at health-check request time.

- [#3633](https://github.com/fluojs/fluo/pull/3633) [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b) Thanks [@ayden94](https://github.com/ayden94)! - Wait for application-owned asynchronous runtime cleanup callbacks before `close()` or bootstrap-failure cleanup settles. Cleanup remains best-effort: later callbacks run after failures, close aggregates failures for explicit retry, and bootstrap preserves the original bootstrap error.

- [#3542](https://github.com/fluojs/fluo/pull/3542) [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639) Thanks [@ayden94](https://github.com/ayden94)! - Configure a shared Prometheus registry through the public `METRICS_REGISTRY`
  bootstrap provider so each application bootstrap owns its metrics registry. Bootstrap
  registry provenance is available to runtime integrations through the narrow internal
  provider-token seam.

- [#2990](https://github.com/fluojs/fluo/pull/2990) [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1) Thanks [@ayden94](https://github.com/ayden94)! - Bound repeated PlatformShell readiness, health, and snapshot probe diagnostics to the latest failure per component and probe phase while preserving distinct lifecycle failures.

- [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84) Thanks [@ayden94](https://github.com/ayden94)! - Reject oversized Web multipart request bodies immediately without waiting for
  another chunk, while preventing late producer work from becoming an unhandled
  rejection.

- [#2973](https://github.com/fluojs/fluo/pull/2973) [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd) Thanks [@ayden94](https://github.com/ayden94)! - Cancel pending raw Node `EADDRINUSE` listen retries during adapter shutdown so a closed listener cannot bind again after close completes.

- [#2783](https://github.com/fluojs/fluo/pull/2783) [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e) Thanks [@ayden94](https://github.com/ayden94)! - Reject new microservice `send()` and `emit()` calls as soon as shutdown begins, including while `listen()` is still pending, before runtime or transport handoff.

- [#3666](https://github.com/fluojs/fluo/pull/3666) [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438) Thanks [@ayden94](https://github.com/ayden94)! - Make microservice shutdown terminally idempotent, including synchronous shutdown-marker failures and reentry, wait for already-admitted inbound handlers before transport cleanup, and preserve failed close results without retrying teardown.

- [#3558](https://github.com/fluojs/fluo/pull/3558) [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230) Thanks [@ayden94](https://github.com/ayden94)! - Drain queued telemetry scrapes and remove framework-owned platform telemetry from
  a shared Registry after its final metrics module registration closes. Delay platform
  component shutdown until module teardown, including telemetry scrape draining, completes.

- [#3687](https://github.com/fluojs/fluo/pull/3687) [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573) Thanks [@ayden94](https://github.com/ayden94)! - Drop the unused `@fluojs/config` production dependency from `@fluojs/runtime` and correct the `@fluojs/config` README guidance. Runtime source never imported the config package: configuration still enters through explicit bootstrap options and injected providers, so no import path or public export changes.

  Installing `@fluojs/runtime` no longer pulls `@fluojs/config` transitively. Applications that call `ConfigModule.forRoot(...)` or inject `ConfigService` must declare `@fluojs/config` as their own direct dependency; consumers that already list it explicitly are unaffected.

- [#3581](https://github.com/fluojs/fluo/pull/3581) [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea) Thanks [@ayden94](https://github.com/ayden94)! - Stop platform startup when a component validation result reports `ok: false`, retaining a stable diagnostic when the component provides no issues.

- [#3629](https://github.com/fluojs/fluo/pull/3629) [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c) Thanks [@ayden94](https://github.com/ayden94)! - Reject new `Application.dispatch()` calls once `Application.close()` starts, before they enter the HTTP dispatcher. Requests admitted before shutdown retain their dispatcher-owned drain behavior.

  Migration: application-owned direct dispatch callers must finish admission before initiating close. A dispatch attempted after close starts now rejects consistently while teardown is pending, after a failed close, and after successful close.

- [#3556](https://github.com/fluojs/fluo/pull/3556) [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a) Thanks [@ayden94](https://github.com/ayden94)! - Keep manual SSE dispatch active through stream close or abort. Late client aborts no longer
  emit request-success observation, custom Web response factories remain compatible without
  `responseReady`, and Cloudflare Worker ownership now waits for both response-body termination
  and dispatcher completion.

- [#2781](https://github.com/fluojs/fluo/pull/2781) [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4) Thanks [@ayden94](https://github.com/ayden94)! - Capture CLI-injected Studio configuration once as a validated, immutable runtime bridge snapshot.

- [#2886](https://github.com/fluojs/fluo/pull/2886) [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9) Thanks [@ayden94](https://github.com/ayden94)! - Enforce Web JSON request body limits while streaming even when Content-Length appears safe, settle oversized cloned streams without waiting for cancellation, preserve HTTP 413 when cancellation rejects, and deprecate the compatibility-only `preferNativeJsonBodyReader` option.

- [#3598](https://github.com/fluojs/fluo/pull/3598) [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab) Thanks [@ayden94](https://github.com/ayden94)! - Add the internal contribution-resolution seam used by framework packages while keeping index-based contribution resolution off the root `Container` API. Run lifecycle hooks for every eligible singleton `multi: true` provider contribution in provider order, with reverse contribution order during shutdown and bootstrap rollback. Make testing-module lifecycle compilation report the canonical DI scope and circular-dependency errors.

- [#3575](https://github.com/fluojs/fluo/pull/3575) [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33) Thanks [@ayden94](https://github.com/ayden94)! - Reject non-finite, negative, and fractional `maxBodySize` values at Web request factory boundaries.

- [#3646](https://github.com/fluojs/fluo/pull/3646) [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685) Thanks [@ayden94](https://github.com/ayden94)! - Resolve `@fluojs/runtime` from the inspected project's dependency tree at the `inspect` command boundary, preflight its availability before importing the application module, and preserve command-scoped missing-runtime guidance across the CLI's documented Node.js `>=20.0.0` range.

- [#3502](https://github.com/fluojs/fluo/pull/3502) [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88) Thanks [@ayden94](https://github.com/ayden94)! - Redact raw request-observation exception details from Studio failed-request events.

- [#3634](https://github.com/fluojs/fluo/pull/3634) [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5) Thanks [@ayden94](https://github.com/ayden94)! - Make the Studio live wire schema the single type contract used by Runtime producers, and expose normalized parsed route descriptor types without narrowing legacy wire inputs.

- [#3680](https://github.com/fluojs/fluo/pull/3680) [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617) Thanks [@ayden94](https://github.com/ayden94)! - Correct Node shutdown-signal ownership and NestJS lifecycle migration guidance.

- [#3516](https://github.com/fluojs/fluo/pull/3516) [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c) Thanks [@ayden94](https://github.com/ayden94)! - Reject module provider aliases whose targets are not locally owned, exported by an imported module, or visible through a global module.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`0a18afc`](https://github.com/fluojs/fluo/commit/0a18afc70589c33fa7d0d4974336125f330cc07e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`4772475`](https://github.com/fluojs/fluo/commit/4772475b02ce84ee7ad532581f5827383fdc5c1b), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`7e04a10`](https://github.com/fluojs/fluo/commit/7e04a106aec8e1ce2d722c2800c293a2d335102e), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`e33e11f`](https://github.com/fluojs/fluo/commit/e33e11f15d9fcfe19fb4b89637102bc022885f8e), [`ad48313`](https://github.com/fluojs/fluo/commit/ad4831301994dd61c0b01e409424b889db8d2db2), [`c9de01b`](https://github.com/fluojs/fluo/commit/c9de01b9c896657581d40e575339bcd0e6600fc0), [`a981ca4`](https://github.com/fluojs/fluo/commit/a981ca40c51ab6ba5b57d47a9e3c5e33d6dc2c9a), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`93e91a6`](https://github.com/fluojs/fluo/commit/93e91a6fd9625fbc62212b443f7ac38fe06f00ff), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`482af10`](https://github.com/fluojs/fluo/commit/482af10b73f50ffa08953782450729db15f2a86b), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`29437ff`](https://github.com/fluojs/fluo/commit/29437ffc91db6f1d904b15bdce5c3236fa6f100e), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/http@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0
  - @fluojs/studio@2.0.0

## 2.0.1

### Patch Changes

- [#2759](https://github.com/fluojs/fluo/pull/2759) [`65cc3a2`](https://github.com/fluojs/fluo/commit/65cc3a28457d58b75858ed33ab7280b09900db36) Thanks [@ayden94](https://github.com/ayden94)! - Remove the abort listener registered by `raceWithAbort(fn, signal)` even when `fn` throws synchronously before returning a promise. The synchronous throw is now converted into a settled rejection so the cleanup-dependent `finally` flow still runs and the listener is not leaked across repeated failed operations.

- Updated dependencies [[`c0ebd48`](https://github.com/fluojs/fluo/commit/c0ebd485d5dcd0922ab93f2e4086428a3e64cf04)]:
  - @fluojs/http@2.0.1

## 2.0.0

### Major Changes

- [#2649](https://github.com/fluojs/fluo/pull/2649) [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4) Thanks [@ayden94](https://github.com/ayden94)! - Remove the Node.js `Buffer` dependency from Web multipart parsing and expose uploaded file payloads as runtime-neutral `Uint8Array` values.

  Preserve Buffer-backed multipart file payloads at the Express Node adapter boundary.

  Node-only consumers that use Buffer-specific methods must convert explicitly at their application boundary with `Buffer.from(file.buffer)`.

### Minor Changes

- [#2473](https://github.com/fluojs/fluo/pull/2473) [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67) Thanks [@ayden94](https://github.com/ayden94)! - Expose the runtime health module readiness-registration contract and harden Terminus health/readiness optional-peer regression coverage for consumer-visible readiness composition seams.

### Patch Changes

- [#2464](https://github.com/fluojs/fluo/pull/2464) [`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439) Thanks [@ayden94](https://github.com/ayden94)! - Refresh runtime platform telemetry from the active registry collect path so advanced shared-registry scrapers observe fresh component readiness and health series.

- [#2665](https://github.com/fluojs/fluo/pull/2665) [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff) Thanks [@ayden94](https://github.com/ayden94)! - Normalize malformed provider `inject` arrays, dependency wrappers, and `scope` values to structured `InvalidProviderError` failures during direct registration and module-graph compilation while preserving class `@Inject(...)` metadata fallback for omitted or `undefined` `inject` values.

- [#2648](https://github.com/fluojs/fluo/pull/2648) [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925) Thanks [@ayden94](https://github.com/ayden94)! - Restore the governed `Unreleased` changelog placeholder for foundation packages and preserve it when Changesets generates future package versions.

- Updated dependencies [[`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`344cec0`](https://github.com/fluojs/fluo/commit/344cec07b828af4d405efea3767302840edde19e), [`ec8ffb6`](https://github.com/fluojs/fluo/commit/ec8ffb605cf4b128fb2f7786a2a606b613530164), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/config@1.0.4
  - @fluojs/core@1.1.0

## 1.1.8

### Patch Changes

- [#2172](https://github.com/fluojs/fluo/pull/2172) [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451) Thanks [@ayden94](https://github.com/ayden94)! - Harden `overrideModule()` so testing module replacements preserve authored module identities without mutating source module metadata, add the runtime module replacement compile seam used by testing, and document the testing module, `createTestApp`, Vitest entrypoint, and NestJS migration contracts.

- [#2229](https://github.com/fluojs/fluo/pull/2229) [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed) Thanks [@ayden94](https://github.com/ayden94)! - Align Socket.IO lifecycle internals and documentation with the audited runtime contracts: defer Node async-context loading until gateway invocation, route provider-scope metadata through the runtime integration seam, document explicit ACK/raw-server migration paths, and add deterministic Bun CORS/test coverage.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4)]:
  - @fluojs/http@1.1.2

## 1.1.7

### Patch Changes

- [#2086](https://github.com/fluojs/fluo/pull/2086) [`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65) Thanks [@ayden94](https://github.com/ayden94)! - Keep the runtime internal HTTP adapter seam free of Node-specific console logger globals, and route platform defaults through either the transport-neutral logger or the explicit Node runtime subpath.

- Updated dependencies [[`06f35cb`](https://github.com/fluojs/fluo/commit/06f35cbef3a0343a6745e658c120eb19d15d4480), [`f3f6d54`](https://github.com/fluojs/fluo/commit/f3f6d54916485cf62047c164d624af7628ef3130)]:
  - @fluojs/http@1.1.1
  - @fluojs/config@1.0.3

## 1.1.6

### Patch Changes

- [#2053](https://github.com/fluojs/fluo/pull/2053) [`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1) Thanks [@ayden94](https://github.com/ayden94)! - Add an explicit DI container resolution-state introspection seam for framework testing helpers, remove HTTP portability startup-log assertions from global console monkey-patching, cache Vitest workspace alias scans per repository root, and harden testing package documentation and regression coverage.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1)]:
  - @fluojs/di@1.1.0

## 1.1.5

### Patch Changes

- [#2038](https://github.com/fluojs/fluo/pull/2038) [`4403acd`](https://github.com/fluojs/fluo/commit/4403acdf90ed3335895c4eb43a304161476cff57) Thanks [@ayden94](https://github.com/ayden94)! - Restore generated Node starter runtime log colors by using platform startup helpers and internalizing runtime logger selection instead of accepting logger overrides in app options.

## 1.1.4

### Patch Changes

- [#2035](https://github.com/fluojs/fluo/pull/2035) [`8e3b443`](https://github.com/fluojs/fluo/commit/8e3b44385c8c3adeaef26e3b492c842d30c19def) Thanks [@ayden94](https://github.com/ayden94)! - Restore console-style logger defaults for Bun and Deno terminal startup helpers while keeping shared/root and Worker bootstrap logging transport-neutral.

## 1.1.3

### Patch Changes

- [#2032](https://github.com/fluojs/fluo/pull/2032) [`439d93e`](https://github.com/fluojs/fluo/commit/439d93eb1caa850574410811bac31e8668651192) Thanks [@ayden94](https://github.com/ayden94)! - Add the runtime-connected Studio devtool path with `fluo dev --studio`, a local sidecar live event bridge, runtime snapshot/request instrumentation, and a React/FSD Studio UI while preserving static report compatibility.

## 1.1.2

### Patch Changes

- [#2024](https://github.com/fluojs/fluo/pull/2024) [`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b) Thanks [@ayden94](https://github.com/ayden94)! - Keep root runtime bootstrap defaults transport-neutral while preserving Node-specific logger behavior on `@fluojs/runtime/node`, and add regression coverage for documented Node shutdown and lifecycle failure contracts.

## 1.1.1

### Patch Changes

- [#1988](https://github.com/fluojs/fluo/pull/1988) [`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629) Thanks [@ayden94](https://github.com/ayden94)! - Align foundation package contracts with their documented public surfaces and lifecycle diagnostics guidance.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0

## 1.1.0

### Minor Changes

- [#1854](https://github.com/fluojs/fluo/pull/1854) [`d23049a`](https://github.com/fluojs/fluo/commit/d23049a59a49bdaea110a5f542ae18606c782db8) Thanks [@ayden94](https://github.com/ayden94)! - Keep Web runtime multipart uploads portable across Web-standard hosts by returning `Uint8Array` file buffers, and make Node adapter listen retries cancellable during shutdown.

  This release treats the multipart buffer portability change as part of the 1.x feature line for this train. Consumers that need Node-specific Buffer APIs can wrap uploaded file buffers with `Buffer.from(file.buffer)`.

### Patch Changes

- [#1856](https://github.com/fluojs/fluo/pull/1856) [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2) Thanks [@ayden94](https://github.com/ayden94)! - Harden the Node.js platform contract by validating lifecycle retry/shutdown options, preserving `x-correlation-id` as the request ID fallback on Node-backed requests, and documenting package-local coverage for listen retry and keep-alive shutdown behavior.

- Updated dependencies [[`34c840f`](https://github.com/fluojs/fluo/commit/34c840f3a1cd15e0399aa91467201d5b8f85a988), [`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/config@1.0.1
  - @fluojs/di@1.0.1
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- da003a1: Defer Node and Web request body materialization to the dispatch boundary while preserving synchronous `FrameworkRequest.body` and `rawBody` values for application code.
- 93fc34b: Add `HealthModule.forRoot(...)` as the application-facing runtime health facade and update generated starters to use it while preserving the deprecated `createHealthModule(...)` compatibility helper.
- f8d05fa: Add an opt-in module graph compile-result cache for repeated bootstrap flows while keeping failed compilations uncached and cached graph snapshots isolated from caller mutation.
- f28a8c8: Add configurable runtime console logger modes and level filtering, and add CLI lifecycle reporter controls for quieter interactive dev output while preserving raw passthrough for CI and debugging.
- 6b8e8a9: Harden runtime microservice ownership by cascading parent application shutdown to connected microservices, rolling back started children when `startAllMicroservices()` fails, and preserving original microservice bootstrap errors when cleanup also fails.

  The root `@fluojs/runtime` entrypoint no longer exports `renderRuntimeDiagnosticsMermaid`; Mermaid rendering is Studio-owned, so consumers that need Mermaid output should migrate to the Studio contract path and call `renderMermaid(snapshot)` from `@fluojs/studio/contracts`.

### Patch Changes

- 1b0a68a: Optimize Node-backed request shell creation so Express, Fastify, and raw Node adapters reuse host-parsed request data where possible without changing query, body, raw body, multipart, or native route handoff behavior.
- 37ae1c5: Add conservative HTTP fast-path execution and native route handoff optimizations for singleton-safe routes while preserving middleware, guards, pipes, interceptors, error handling, adapter fallback, raw-body, multipart, streaming, abort, and request-scope behavior.
- 48a9f97: Fix the raw Node adapter to recognize mixed-case JSON and multipart content types, and fail fast when `maxBodySize` is configured with a non-numeric value instead of byte-count input.
- 53a2b8e: Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

- 005d3d7: Optimize Web runtime request materialization so fetch-style adapters avoid extra request cloning and eager query/header snapshots while preserving rawBody, multipart, and portability semantics.
- b74832f: Serialize runtime startup against shutdown, expose the internal runtime cleanup registration seam during bootstrap, and make custom HTTP adapter shutdown registration cleanup exception-safe.
- 4333cee: Reset runtime health readiness markers as soon as application or context shutdown begins so `/ready` leaves traffic rotation before cleanup hooks and remains unavailable even when shutdown fails.
- 89f6379: Reduce request/response normalization overhead for common adapter hot paths by skipping empty-body materialization and deferring stream/compression helper setup until requests actually use them.
- f0dce1f: Reduce runtime coupling to peer package internal subpaths by isolating the remaining core/http integration points behind runtime-owned seams.
- c509e27: Reduce runtime hot-path overhead by memoizing request metadata materialization, safe direct root singleton context lookups, and independent bootstrap lifecycle provider resolution.
- c3ef937: Reuse shared Web request-response factories across adapter requests while preserving per-request body materialization and error/fallback response semantics.
- 69936b1: Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.
- 35f60fd: Skip HTTP request-scope container creation for singleton-only routes while preserving isolated request-scoped DI whenever a controller graph, middleware, guard, interceptor, observer, DTO converter, or custom binder may require it.
- d3504c6: Make Terminus Drizzle health checks lifecycle-aware by resolving the public Drizzle wrapper token before raw ping fallback, so shutdown and stopped Drizzle integrations now report unavailable health/readiness.

  Expose the `/ready` request context to runtime health readiness checks so integrations can resolve public runtime status providers without importing runtime internals.

- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [c5aebdf]
- Updated dependencies [aa80042]
- Updated dependencies [372a80d]
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
- Updated dependencies [e430e58]
- Updated dependencies [aaab8c4]
- Updated dependencies [a625716]
- Updated dependencies [45e0f1b]
- Updated dependencies [b82b28f]
- Updated dependencies [37ae1c5]
- Updated dependencies [16420f9]
- Updated dependencies [53a2b8e]
- Updated dependencies [e1bce3d]
- Updated dependencies [3baf5df]
- Updated dependencies [7b50db8]
- Updated dependencies [00f4d90]
- Updated dependencies [69936b1]
- Updated dependencies [35f60fd]
- Updated dependencies [28ca2ef]
- Updated dependencies [d4b7d48]
- Updated dependencies [dc8fff1]
- Updated dependencies [1f312e0]
  - @fluojs/http@1.0.0
  - @fluojs/core@1.0.0
  - @fluojs/config@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.12

### Patch Changes

- [#1705](https://github.com/fluojs/fluo/pull/1705) [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44) Thanks [@ayden94](https://github.com/ayden94)! - Serialize runtime startup against shutdown, expose the internal runtime cleanup registration seam during bootstrap, and make custom HTTP adapter shutdown registration cleanup exception-safe.

- [#1664](https://github.com/fluojs/fluo/pull/1664) [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294) Thanks [@ayden94](https://github.com/ayden94)! - Reduce runtime coupling to peer package internal subpaths by isolating the remaining core/http integration points behind runtime-owned seams.

- [#1704](https://github.com/fluojs/fluo/pull/1704) [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f) Thanks [@ayden94](https://github.com/ayden94)! - Make Terminus Drizzle health checks lifecycle-aware by resolving the public Drizzle wrapper token before raw ping fallback, so shutdown and stopped Drizzle integrations now report unavailable health/readiness.

  Expose the `/ready` request context to runtime health readiness checks so integrations can resolve public runtime status providers without importing runtime internals.

- Updated dependencies [[`372a80d`](https://github.com/fluojs/fluo/commit/372a80d337f8b806f05693ed33ca45d6e4289115), [`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0)]:
  - @fluojs/config@1.0.0-beta.8
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5

## 1.0.0-beta.11

### Minor Changes

- [#1554](https://github.com/fluojs/fluo/pull/1554) [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0) Thanks [@ayden94](https://github.com/ayden94)! - Add `HealthModule.forRoot(...)` as the application-facing runtime health facade and update generated starters to use it while preserving the deprecated `createHealthModule(...)` compatibility helper.

### Patch Changes

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/http@1.0.0-beta.10

## 1.0.0-beta.10

### Minor Changes

- [#1539](https://github.com/fluojs/fluo/pull/1539) [`f28a8c8`](https://github.com/fluojs/fluo/commit/f28a8c8e01a2dea8906c1d0b47ed60c4966b8081) Thanks [@ayden94](https://github.com/ayden94)! - Add configurable runtime console logger modes and level filtering, and add CLI lifecycle reporter controls for quieter interactive dev output while preserving raw passthrough for CI and debugging.

### Patch Changes

- Updated dependencies [[`1f312e0`](https://github.com/fluojs/fluo/commit/1f312e02ff7123a82c63d86d022ec9d3bb8c92eb)]:
  - @fluojs/config@1.0.0-beta.6

## 1.0.0-beta.9

### Minor Changes

- [#1520](https://github.com/fluojs/fluo/pull/1520) [`f8d05fa`](https://github.com/fluojs/fluo/commit/f8d05fac610bd5a58c27f84e764338ee718c0a67) Thanks [@ayden94](https://github.com/ayden94)! - Add an opt-in module graph compile-result cache for repeated bootstrap flows while keeping failed compilations uncached and cached graph snapshots isolated from caller mutation.

- [#1507](https://github.com/fluojs/fluo/pull/1507) [`6b8e8a9`](https://github.com/fluojs/fluo/commit/6b8e8a9d2c6123d9a1ca2ec805ef4fde97d1f199) Thanks [@ayden94](https://github.com/ayden94)! - Harden runtime microservice ownership by cascading parent application shutdown to connected microservices, rolling back started children when `startAllMicroservices()` fails, and preserving original microservice bootstrap errors when cleanup also fails.

  The root `@fluojs/runtime` entrypoint no longer exports `renderRuntimeDiagnosticsMermaid`; Mermaid rendering is Studio-owned, so consumers that need Mermaid output should migrate to the Studio contract path and call `renderMermaid(snapshot)` from `@fluojs/studio/contracts`.

### Patch Changes

- Updated dependencies [[`c5aebdf`](https://github.com/fluojs/fluo/commit/c5aebdfe141bda72a6701516c48ace0f5caf5ee2), [`1d43614`](https://github.com/fluojs/fluo/commit/1d4361416e56ec935d67da096ba8b72d3886f7ee), [`f086fa5`](https://github.com/fluojs/fluo/commit/f086fa58827617bda8bdef50e0b694bd5e85dfaa), [`e430e58`](https://github.com/fluojs/fluo/commit/e430e589d2bee458bf42199acbd50cbb25ea76c9)]:
  - @fluojs/core@1.0.0-beta.3
  - @fluojs/di@1.0.0-beta.6
  - @fluojs/config@1.0.0-beta.5

## 1.0.0-beta.8

### Patch Changes

- [#1480](https://github.com/fluojs/fluo/pull/1480) [`37ae1c5`](https://github.com/fluojs/fluo/commit/37ae1c594e0a2330cae10faddb350cd2a039643c) Thanks [@ayden94](https://github.com/ayden94)! - Add conservative HTTP fast-path execution and native route handoff optimizations for singleton-safe routes while preserving middleware, guards, pipes, interceptors, error handling, adapter fallback, raw-body, multipart, streaming, abort, and request-scope behavior.

- Updated dependencies [[`37ae1c5`](https://github.com/fluojs/fluo/commit/37ae1c594e0a2330cae10faddb350cd2a039643c)]:
  - @fluojs/http@1.0.0-beta.6

## 1.0.0-beta.7

### Patch Changes

- [#1477](https://github.com/fluojs/fluo/pull/1477) [`1b0a68a`](https://github.com/fluojs/fluo/commit/1b0a68a1537ebd508f7dcefac92be97cbd20b84b) Thanks [@ayden94](https://github.com/ayden94)! - Optimize Node-backed request shell creation so Express, Fastify, and raw Node adapters reuse host-parsed request data where possible without changing query, body, raw body, multipart, or native route handoff behavior.

- [#1474](https://github.com/fluojs/fluo/pull/1474) [`005d3d7`](https://github.com/fluojs/fluo/commit/005d3d78dd490ee9278bb5a736572d327ab7d3dc) Thanks [@ayden94](https://github.com/ayden94)! - Optimize Web runtime request materialization so fetch-style adapters avoid extra request cloning and eager query/header snapshots while preserving rawBody, multipart, and portability semantics.

- Updated dependencies [[`e1bce3d`](https://github.com/fluojs/fluo/commit/e1bce3d758794b5a58704f5ccda7e0bf4aed01f0), [`3baf5df`](https://github.com/fluojs/fluo/commit/3baf5dfc1e09d95f4869cd7d847b545c49609ed7)]:
  - @fluojs/http@1.0.0-beta.5

## 1.0.0-beta.6

### Patch Changes

- [#1467](https://github.com/fluojs/fluo/pull/1467) [`c3ef937`](https://github.com/fluojs/fluo/commit/c3ef9375d83e9c3ee0e3caf52f6b3414c5b8e5d3) Thanks [@ayden94](https://github.com/ayden94)! - Reuse shared Web request-response factories across adapter requests while preserving per-request body materialization and error/fallback response semantics.

## 1.0.0-beta.5

### Patch Changes

- [#1452](https://github.com/fluojs/fluo/pull/1452) [`48a9f97`](https://github.com/fluojs/fluo/commit/48a9f9761c093e6622922719869a29a84f7d0079) Thanks [@ayden94](https://github.com/ayden94)! - Fix the raw Node adapter to recognize mixed-case JSON and multipart content types, and fail fast when `maxBodySize` is configured with a non-numeric value instead of byte-count input.

- [#1454](https://github.com/fluojs/fluo/pull/1454) [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27) Thanks [@ayden94](https://github.com/ayden94)! - Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

- [#1459](https://github.com/fluojs/fluo/pull/1459) [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946) Thanks [@ayden94](https://github.com/ayden94)! - Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.

- [#1458](https://github.com/fluojs/fluo/pull/1458) [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f) Thanks [@ayden94](https://github.com/ayden94)! - Skip HTTP request-scope container creation for singleton-only routes while preserving isolated request-scoped DI whenever a controller graph, middleware, guard, interceptor, observer, DTO converter, or custom binder may require it.

- Updated dependencies [[`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0), [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27), [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946), [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/http@1.0.0-beta.4
  - @fluojs/di@1.0.0-beta.5

## 1.0.0-beta.4

### Patch Changes

- [#1437](https://github.com/fluojs/fluo/pull/1437) [`89f6379`](https://github.com/fluojs/fluo/commit/89f637935736c0fe9c52668a5b714c5c0e394af1) Thanks [@ayden94](https://github.com/ayden94)! - Reduce request/response normalization overhead for common adapter hot paths by skipping empty-body materialization and deferring stream/compression helper setup until requests actually use them.

- Updated dependencies [[`01d5e65`](https://github.com/fluojs/fluo/commit/01d5e65f053db99704d9cb30585c75b94dd38367), [`1911e11`](https://github.com/fluojs/fluo/commit/1911e110e7dbb5296238ccc0a2e167ed6f34df86), [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6), [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d)]:
  - @fluojs/http@1.0.0-beta.3
  - @fluojs/di@1.0.0-beta.4

## 1.0.0-beta.3

### Minor Changes

- [#1386](https://github.com/fluojs/fluo/pull/1386) [`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301) Thanks [@ayden94](https://github.com/ayden94)! - Defer Node and Web request body materialization to the dispatch boundary while preserving synchronous `FrameworkRequest.body` and `rawBody` values for application code.

### Patch Changes

- [#1382](https://github.com/fluojs/fluo/pull/1382) [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c) Thanks [@ayden94](https://github.com/ayden94)! - Reduce runtime hot-path overhead by memoizing request metadata materialization, safe direct root singleton context lookups, and independent bootstrap lifecycle provider resolution.

- Updated dependencies [[`aa80042`](https://github.com/fluojs/fluo/commit/aa80042038de9dbdf062c3938710041d937b4631), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75)]:
  - @fluojs/config@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/http@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#1360](https://github.com/fluojs/fluo/pull/1360) [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f) Thanks [@ayden94](https://github.com/ayden94)! - Reset runtime health readiness markers as soon as application or context shutdown begins so `/ready` leaves traffic rotation before cleanup hooks and remains unavailable even when shutdown fails.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/config@1.0.0-beta.2
