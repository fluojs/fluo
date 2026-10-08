# @fluojs/react

## [Unreleased]

## 0.3.0

### Minor Changes

- [#3905](https://github.com/fluojs/fluo/pull/3905) [`6a5444b`](https://github.com/fluojs/fluo/commit/6a5444b02036d3fb9f9782c75ce0d50fb6cc841d) Thanks [@ayden94](https://github.com/ayden94)! - Add opt-in useNavigationGuard permission controls to the existing HTTP-first router.
  Dirty/pending owners can stay or proceed before destination reads, prefetch adoption
  and form cancellation. Managed same-document traversal reuses tagged history recovery;
  session revocation supersedes old decisions. Native document exits remain browser-owned.

- [#3904](https://github.com/fluojs/fluo/pull/3904) [`e75a302`](https://github.com/fluojs/fluo/commit/e75a302c7285e7d8e31f478b774402fe414a5509) Thanks [@ayden94](https://github.com/ayden94)! - Extend the existing useForm with opt-in background GET/POST, independent latest-wins
  operation state, session-owned cancellation and coalesced fresh current-page HTTP approval.
  Coalesced auth approval retains confirmed owners independently and cancels late policy
  authority when its last owner leaves. Synchronous owner cancellation settles before a late body.
  Omitted options preserve navigation POST and busy skipping. Keep native forms and stable
  domain ids; validate generated GET data with decodeRead and retain unknown handwritten data.
  Cancelled or uncertain POSTs are not rollback and are never automatically replayed.
  See docs/getting-started/migrate-react-progressive-forms.md for upgrade guidance.

- [#3899](https://github.com/fluojs/fluo/pull/3899) [`7e58131`](https://github.com/fluojs/fluo/commit/7e5813127b0cf2b9babf58708ec6efbb87ca5470) Thanks [@ayden94](https://github.com/ayden94)! - Change `useRouter().refresh()` from a document reload to fresh HTTP-approved current-page
  revalidation with a typed completion, preserved shell, and page-local reset on approval.
  Existing consumers requiring an unconditional document reload must use
  `window.location.reload()`. Generated React starters expose current-page refresh and
  retain failure/retry controls in the shared shell. See
  `docs/getting-started/migrate-react-refresh.md` for the completion and fallback boundary.

- [#3903](https://github.com/fluojs/fluo/pull/3903) [`63920ab`](https://github.com/fluojs/fluo/commit/63920ab592ec57e39c3155906b0068de26238b5a) Thanks [@ayden94](https://github.com/ayden94)! - Extend the existing React typegen workflow with compiler-derived HTTP query
  bindings, build-mapped page props, and native form field/saved-data contracts.
  Add the type-only `HttpWire<Server, Wire>` converter-input declaration and
  authoritative HTTP version-selection provenance.

  Generated artifact version 2 includes source/type-only/configuration freshness
  and limited JSON decoders. Regenerate older artifacts before enabling typegen
  checks in application typecheck and build scripts. Strict generated consumers
  must use the registered browser module/props pairs and the existing
  `useForm({ action, contract })` path rather than copied DTO interfaces or casts.

- [#3901](https://github.com/fluojs/fluo/pull/3901) [`adedc3a`](https://github.com/fluojs/fluo/commit/adedc3a1f4dcdfde8c9325d063ce36cfbb5f5d7e) Thanks [@ayden94](https://github.com/ayden94)! - Add one progressive native HTTP form path through `useForm` and the existing
  React provider, with `ReactModule.formResult` for confirmed persistence.
  Preserve native POST/303/GET, HTTP-owned DTO/auth/CSRF/status/error behavior,
  and v2 navigation build identity.

  Expose typed independent pending/dirty state, bounded safe field/form rejection,
  skipped busy activation, uncertain persistence, and separately typed post-save
  read outcomes with GET-only recovery. There is no automatic POST retry or native
  POST replay. Existing HTML error configuration and explicit refresh semantics
  remain compatible.

  Include production CRUD in the official Vite starter and runnable example.
  Upgrade the affected React/HTTP/CLI releases together; follow
  `docs/getting-started/migrate-react-progressive-forms.md` for native encoding,
  safe error projection, destination policies and recovery UI.

- [#3897](https://github.com/fluojs/fluo/pull/3897) [`73a5e03`](https://github.com/fluojs/fluo/commit/73a5e030d9dd12100dda419a34b21e78df9e1c8b) Thanks [@ayden94](https://github.com/ayden94)! - Add an opt-in React page-slot experience with pending announcements, approved-render
  error reset, request-selected bounded metadata and overridable focus/scroll effects.
  New React starters use this composition and transfer matched page metadata across SSR
  and soft navigation.

  Existing applications retain low-level provider behavior. To adopt the new defaults,
  render `ReactNavigationExperience` inside the existing provider's function child,
  pass the initial page and approved destination, and supply the matched initial
  `metadata` to `createReactRouteSnapshot`. Remove application-owned title/focus
  effects that would compete with page-owned head updates. Render reset does not
  retry transport: use the separate [#3864](https://github.com/fluojs/fluo/issues/3864) `router.retry()` for fresh HTTP approval.
  Applications adopting this composition must use React 19 and React DOM 19 for
  SSR and soft-navigation title/meta/link hoisting into `<head>`. React 18 remains
  within the package peer range for unrelated APIs, but does not provide this
  composition's head-reconciliation guarantee.

- [#3855](https://github.com/fluojs/fluo/pull/3855) [`985dcd0`](https://github.com/fluojs/fluo/commit/985dcd0e532bc63d59253bafc0a9bf8cf73781f6) Thanks [@ayden94](https://github.com/ayden94)! - Add an opt-in, HTTP-negotiated React navigation payload for matched GET pages. Browser clients can validate the server-confirmed URL and params and render an explicitly Vite-built destination while direct document requests, errors, and existing Link/router navigation remain unchanged.

- [#3900](https://github.com/fluojs/fluo/pull/3900) [`942f673`](https://github.com/fluojs/fluo/commit/942f673d34d58a9093d7012253913aec9143ff45) Thanks [@ayden94](https://github.com/ayden94)! - Require v2 React navigation payloads and build identity for production navigation; derive the identity from the complete Vite manifest and asset base. The generated React starter serves hashed same-origin assets and offers explicit recovery across deployments.

  Consumers of the previous v1 negotiation must pass the manifest-derived `navigationBuildId` to `ReactModule.forRoot(...)` and `ReactClientRouterProvider`, update their Accept handling to `v=2`, and deploy retained old-build assets before switching the manifest. Old v1 tabs use document fallback; no automatic reload or cross-origin CDN support is implied.

- [#3867](https://github.com/fluojs/fluo/pull/3867) [`8f7c69d`](https://github.com/fluojs/fluo/commit/8f7c69d3c0c50b8a0cbd6abff51dba4d08e67991) Thanks [@ayden94](https://github.com/ayden94)! - Add opt-in hover and viewport React navigation prefetch with a scoped, bounded, single-use public payload cache, and grant reuse only for explicit identity-independent pages after the HTTP response passes final credential, status, cookie, and cache-header checks. Ordinary navigation remains credentialed and fresh by default.

- [#3902](https://github.com/fluojs/fluo/pull/3902) [`00525a8`](https://github.com/fluojs/fluo/commit/00525a81b37166889cbf9d742d5a7cc0ca2b92ef) Thanks [@ayden94](https://github.com/ayden94)! - Extend the canonical progressive form path with literal-preserving saved JSON
  data, a shared generated form contract decoder, and an explicit optional
  application session outcome. Native POST/303/GET and negotiated v1 remain.
  Consumers may pass a generated `contract` to `useForm` instead of copying input
  names or casting saved data. Malformed contract data is protocol uncertainty.

  Reject Date, nonfinite numbers, classes, functions, serialization hooks/accessors,
  undefined members, sparse arrays and cycles at the root saved-data boundary rather
  than silently changing their claimed values. Native success stays 303.

- [#3863](https://github.com/fluojs/fluo/pull/3863) [`12c47ae`](https://github.com/fluojs/fluo/commit/12c47ae9a3da31bc6a6d336ccfc6f5f61d11674d) Thanks [@ayden94](https://github.com/ayden94)! - Use the existing Link and router methods to render HTTP-approved React destinations without
  reloading, with confirmed history and route hooks, fresh back/forward approval, and full-document
  fallback for unsupported or rejected responses.

  Clarify HTTP ownership of React navigation approval and history traversal in the shipped
  @fluojs/http English and Korean package documentation.

- [#3890](https://github.com/fluojs/fluo/pull/3890) [`35483c3`](https://github.com/fluojs/fluo/commit/35483c3cc6b6c4c92db43346b092528eb8cd4d97) Thanks [@ayden94](https://github.com/ayden94)! - Provide bounded, escaped initial React navigation data to application renderers and
  validate its build-mapped destination before hydration. Generate a two-page HTTP DTO
  starter with one shared SSR, hydration, and soft-navigation composition. Existing
  React apps remain supported; follow the React starter composition migration guide
  to adopt the new page slot and initial transfer.

- [#3895](https://github.com/fluojs/fluo/pull/3895) [`3866eb7`](https://github.com/fluojs/fluo/commit/3866eb7256b194aee2d31be88971dd455e7520fd) Thanks [@ayden94](https://github.com/ayden94)! - Add an opt-in client navigation failure policy with safe typed reasons, shell-preserving
  network/5xx and recoverable mapped import-failure recovery, fresh HTTP retry, explicit document
  exit, and failed history traversal restoration. Existing providers continue using full-document
  fallback without opt-in.

  Migration: Apps that want a persistent shell on transient failures should pass
  `failurePolicy={({ reason }) => reason === 'network' || reason === 'server-error' || reason === 'import-failure' ? 'preserve' : 'document'}`
  to `ReactClientRouterProvider`, render `useNavigation().failure` controls in their persistent
  shell, and call `router.retry()` or `router.openDocument()` for the user's chosen action.
  The generated `react-vite-ssr` starter selects this policy and supplies those controls by
  default; existing generated applications must make the same edits to opt in.
  Authorization, redirect, invalid payload and explicit reload continue through the normal
  HTTP document path unless the app deliberately chooses another policy.

### Patch Changes

- [#3856](https://github.com/fluojs/fluo/pull/3856) [`a34789a`](https://github.com/fluojs/fluo/commit/a34789af807b87f134feb66f756ab1242946bf05) Thanks [@ayden94](https://github.com/ayden94)! - Add a Bun-supported filesystem static asset source for the portable HTTP middleware, with contained snapshot reads and optional precompressed representation selection. Document its HTTP middleware integration and clarify that React Vite asset manifests map URLs while applications serve the bytes.

- [#3866](https://github.com/fluojs/fluo/pull/3866) [`4664fed`](https://github.com/fluojs/fluo/commit/4664fedea2d912b85f99746f3ad2050930f55263) Thanks [@ayden94](https://github.com/ayden94)! - Start generated React SSR projects directly with `fluo dev` after dependency installation. The generated `dev` script now uses the same CLI-owned restart lifecycle, which transforms the server entry and serves client modules/styles through Vite's development server without a production build or manifest.

  Grant generated Deno dev, test, and compiled applications read access to their `.env` file so the native watcher and production binary can start without unrestricted filesystem permissions.

  Update the published `@fluojs/react` English and Korean README workflow to document the generated React starter's shared CLI-owned development lifecycle without a production build or manifest.

- [#3923](https://github.com/fluojs/fluo/pull/3923) [`419b6e8`](https://github.com/fluojs/fluo/commit/419b6e8d2f97fc05e0c7cc8486e35fde3c875492) Thanks [@ayden94](https://github.com/ayden94)! - Add an authenticated process-local catalog CRUD companion to the React starter's existing HTTP session composition and ship native/enhanced product journey coverage. Existing public catalog and editor-cookie demos retain their behavior. These demo sessions and in-memory products are not production authentication or durable storage.

  Align the shipped React documentation with the product acceptance gate, preserving original numerical diagnostics and requiring authenticated correctness, lifecycle and stability evidence.

- [#3922](https://github.com/fluojs/fluo/pull/3922) [`9a3a4a7`](https://github.com/fluojs/fluo/commit/9a3a4a754c087320147ed882ba904bf7497fb301) Thanks [@ayden94](https://github.com/ayden94)! - Extend the generated React SSR starter's production browser checks to reject redundant initial navigation GETs and eagerly transferred search destinations, using the actual built manifest and HTTP request inventory.

  Document complete client-delivery traces, initial payload reuse, and the limits of unmeasured or inconclusive performance evidence.

  Avoid redundant ordinary Link renders when the provider connects, while preserving viewport prefetch connection and cleanup.

  Negotiate streaming gzip for eligible React development gateway JavaScript and CSS responses, preserving HTTP exclusions, weak validators, backpressure and disconnect cleanup.

  Transform declared React development page modules before publishing readiness so early page edits can use the client HMR graph rather than restarting the server generation.

  Reduce the Node development restart runner's default trailing-edge debounce to 50 ms while preserving explicit overrides, content-based no-op filtering and atomic-save coalescing.

  Reuse immutable production asset bytes within each generated React application's asset controller, sharing concurrent reads and discarding failed reads. Development assets remain uncached. The comparison fixture also reuses its existing gzip representation.

  Keep the generated shell counter disabled until hydration installs its interaction handler, preventing the first click from being lost during cold development startup.

- [#3907](https://github.com/fluojs/fluo/pull/3907) [`f3e6990`](https://github.com/fluojs/fluo/commit/f3e699047bfa51bbb69d9abeb2717eeb9e1871b0) Thanks [@ayden94](https://github.com/ayden94)! - Align React's documented background/session/navigation capabilities and add
  deterministic long-session verification companions. The generated React starter
  adds HTTP-selected QR/songs pages alongside its existing jukebox search and queue
  forms, with explicit test-only importer/resource barriers.

  Correctness receipts, a separate two-hour soak and physical mobile/tablet evidence
  remain distinct requirements. Source harness availability is not executed product
  acceptance, a playback guarantee or a new public diagnostics API.

- [#3902](https://github.com/fluojs/fluo/pull/3902) [`00525a8`](https://github.com/fluojs/fluo/commit/00525a81b37166889cbf9d742d5a7cc0ca2b92ef) Thanks [@ayden94](https://github.com/ayden94)! - Restore safe document exits for legacy auth rejection, consume configured auth refresh decisions through fresh GET approval, and cancel saved-form-owned session policy authority when its binding is cancelled.

- [#3889](https://github.com/fluojs/fluo/pull/3889) [`716038f`](https://github.com/fluojs/fluo/commit/716038f9c70f31e4a5f9244f99f425b28cf41509) Thanks [@ayden94](https://github.com/ayden94)! - Enable same-origin React Fast Refresh and CSS HMR in the generated Node React/Vite starter's canonical `fluo dev` path, including fresh SSR components and WebSocket cleanup. Existing generated projects must adopt the React plugin, dev entry preamble, and application-hosted Vite wiring described in `docs/getting-started/migrate-react-dev-hmr.md`; upgrades do not rewrite application files.

  Clarify the shipped `@fluojs/react` README's generated starter workflow: compatible React component edits preserve eligible state, CSS edits update in place, and server-only or config edits still restart the development child.

- [#3888](https://github.com/fluojs/fluo/pull/3888) [`f71be37`](https://github.com/fluojs/fluo/commit/f71be378fc824d6b093a25881ea1f994826c6910) Thanks [@ayden94](https://github.com/ayden94)! - Clarify the HTTP-first full-stack React product target, current navigation and development limits, and the owner and real-surface acceptance criteria for CRUD and long-lived jukebox journeys in the English and Korean package READMEs. This documents existing behavior and future work; it adds no runtime capability or new CLI command.

- [#3917](https://github.com/fluojs/fluo/pull/3917) [`75bcfcc`](https://github.com/fluojs/fluo/commit/75bcfcc06d9d8832d146c46a5f6e221c351c0f95) Thanks [@ayden94](https://github.com/ayden94)! - Clarify the Node/Fastify React shell delivery, proxy compression, slow-client cleanup, and buffered-host limitations in the package guides. No public API or runtime behavior changes.

- Updated dependencies [[`a719508`](https://github.com/fluojs/fluo/commit/a7195088aaaa787db909bcdb63e1fe31bf15bfa3), [`a34789a`](https://github.com/fluojs/fluo/commit/a34789af807b87f134feb66f756ab1242946bf05), [`00525a8`](https://github.com/fluojs/fluo/commit/00525a81b37166889cbf9d742d5a7cc0ca2b92ef), [`6320fdd`](https://github.com/fluojs/fluo/commit/6320fdd52f40a9c3d2e5dca3694e84c17a6e1dcf), [`63920ab`](https://github.com/fluojs/fluo/commit/63920ab592ec57e39c3155906b0068de26238b5a), [`adedc3a`](https://github.com/fluojs/fluo/commit/adedc3a1f4dcdfde8c9325d063ce36cfbb5f5d7e), [`985dcd0`](https://github.com/fluojs/fluo/commit/985dcd0e532bc63d59253bafc0a9bf8cf73781f6), [`942f673`](https://github.com/fluojs/fluo/commit/942f673d34d58a9093d7012253913aec9143ff45), [`8f7c69d`](https://github.com/fluojs/fluo/commit/8f7c69d3c0c50b8a0cbd6abff51dba4d08e67991), [`12c47ae`](https://github.com/fluojs/fluo/commit/12c47ae9a3da31bc6a6d336ccfc6f5f61d11674d), [`8500d74`](https://github.com/fluojs/fluo/commit/8500d74bef6e4d9efbfd79087693d6258c7ff035)]:
  - @fluojs/http@3.2.0
  - @fluojs/core@2.1.3
  - @fluojs/runtime@3.1.3

## 0.2.2

### Patch Changes

- [#3828](https://github.com/fluojs/fluo/pull/3828) [`96a0180`](https://github.com/fluojs/fluo/commit/96a0180f00f14296e9961d703de2ede386a8489a) Thanks [@ayden94](https://github.com/ayden94)! - Preserve public error classification and structured fields across compatible same-realm duplicate package copies by using validated, version-aware owner contracts at first-party package boundaries.

- [#3829](https://github.com/fluojs/fluo/pull/3829) [`5ff6861`](https://github.com/fluojs/fluo/commit/5ff686131040d9b02fdc79cfc9da849e98bb4744) Thanks [@ayden94](https://github.com/ayden94)! - Share explicit metadata, React client context identity, and request-local SSR diagnostic markers across compatible same-realm package copies without globalizing application state.

- Updated dependencies [[`862fb52`](https://github.com/fluojs/fluo/commit/862fb52acb2d2a67c4aa6667f93d8a7c4f82718d), [`96a0180`](https://github.com/fluojs/fluo/commit/96a0180f00f14296e9961d703de2ede386a8489a), [`5ff6861`](https://github.com/fluojs/fluo/commit/5ff686131040d9b02fdc79cfc9da849e98bb4744), [`c8a2906`](https://github.com/fluojs/fluo/commit/c8a29069f758341f6b9103a3419c9a194d79a6fa), [`10b121f`](https://github.com/fluojs/fluo/commit/10b121fc044fa1e348dfd95af26798c65597a631), [`f4b7257`](https://github.com/fluojs/fluo/commit/f4b72574ecf3f57ca22716fe334ce2a0629357f5)]:
  - @fluojs/http@3.1.3
  - @fluojs/runtime@3.1.2
  - @fluojs/core@2.1.2
  - @fluojs/di@3.1.2

## 0.2.1

### Patch Changes

- [#3771](https://github.com/fluojs/fluo/pull/3771) [`4617a9c`](https://github.com/fluojs/fluo/commit/4617a9c0097281603d6fb5ce97a60941b2f310d4) Thanks [@ayden94](https://github.com/ayden94)! - Make `FluoFactory.create(AppModule, { adapter })` the sole HTTP application
  creation implementation. Remove `fluoFactory` and `bootstrapApplication` from
  every runtime public entrypoint and emitted JavaScript/declaration surface.
  Factory accepts `logger` and owns common middleware composition, original-error
  preserving startup cleanup, and optional host shutdown registration.

  Migration: import `FluoFactory` instead of `fluoFactory`, replace
  `bootstrapApplication({ rootModule, ...options })` with
  `FluoFactory.create(rootModule, options)`, then call instance `app.listen()` and
  `app.close()`. Security headers now default on for direct Factory and testing
  applications; set `securityHeaders: false` to retain a header-free baseline.
  Readiness/listen/post-listen setup failure enters terminal shutdown; create a
  new application instead of retrying listen on the failed shell. A signal
  unregistration failure is retained for concurrent and later closes without
  skipping runtime teardown.

  Upgrade `@fluojs/cron` together with `@fluojs/runtime`. Cron retains its mandatory
  Runtime dependency, and these coordinated updates leave scheduling behavior unchanged.

  Node CLI HTTP and mixed starters now emit Factory creation, the explicit Node
  console logger, and Node shutdown registration. Add a direct
  `@fluojs/platform-nodejs` dependency when importing its logger or signals from a
  Fastify/Express application. Node signal registration rolls back partially
  installed handlers and attempts every removal after an individual failure.
  The additive optional `HttpApplicationAdapter.getListenTarget()` capability
  supplies startup-log metadata without requiring a socket on Fetch hosts.

  See `docs/getting-started/migrate-http-factory.md` and its Korean companion for
  defaults, ownership, cleanup errors, PublicToken inference, and the distinction
  between `app.dispatch()` admission and low-level container/dispatcher access.
  DI class identities, public constructors, instance operations, context-only
  creation, and microservice creation retain their separate contracts.

  Existing platform bootstrap/run helpers and their host-specific consumers remain
  supported through Factory until their platform migrations. Other listed package
  patches only align README imports and recipes shipped in their tarballs; they
  introduce no independent runtime behavior. Repository Docs, Book, examples, and
  test-only consumer migrations have no separate package-release effect.

- Updated dependencies [[`02678e6`](https://github.com/fluojs/fluo/commit/02678e6bd244d3c3fe51f4264365cbf73ce7c6b4), [`02678e6`](https://github.com/fluojs/fluo/commit/02678e6bd244d3c3fe51f4264365cbf73ce7c6b4), [`e0b559c`](https://github.com/fluojs/fluo/commit/e0b559c0e481c48917386e23f0a09af0532cbb1b), [`4617a9c`](https://github.com/fluojs/fluo/commit/4617a9c0097281603d6fb5ce97a60941b2f310d4), [`ed57b76`](https://github.com/fluojs/fluo/commit/ed57b760ba6f73c38e5a91a77606e4e1c1af74ca), [`78fed4b`](https://github.com/fluojs/fluo/commit/78fed4bf1fcfd8c6a00c616d87131ec7b92b1a92), [`0def58e`](https://github.com/fluojs/fluo/commit/0def58eec9c7cd78a260d80c3e7faa85fd7e7711), [`30e2295`](https://github.com/fluojs/fluo/commit/30e229563ce56fe20b82fd978883d248f57acd66), [`5ad001e`](https://github.com/fluojs/fluo/commit/5ad001ecf0bb091a1447930ede22be2e0a17078a), [`7b20f50`](https://github.com/fluojs/fluo/commit/7b20f5038f19c4d3910c5fd0bcdfdad0d5fec686), [`146d6a0`](https://github.com/fluojs/fluo/commit/146d6a072e9027a83cb908905047be2f3334d049)]:
  - @fluojs/core@2.1.1
  - @fluojs/di@3.1.1
  - @fluojs/runtime@3.1.1
  - @fluojs/http@3.1.1

## 0.2.0

### Minor Changes

- [#2848](https://github.com/fluojs/fluo/pull/2848) [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6) Thanks [@ayden94](https://github.com/ayden94)! - Add the request-local HTTP response-finalization seam used by React page rendering. Allow `@Path(...)` handlers to return one `ReactElement` through the configured application page renderer, and add stable SSR diagnostic codes and phases for HTTP pipeline failures, pre-commit shell failures, request aborts, and post-shell recoverable errors.

- [#2847](https://github.com/fluojs/fluo/pull/2847) [`5ee4516`](https://github.com/fluojs/fluo/commit/5ee4516c2309579829506ab2e4a89ad851a86557) Thanks [@ayden94](https://github.com/ayden94)! - Add an application-level `ReactPageRenderer` callback that `ReactModule.forRoot(...)` registers for shared document, provider, route-context, hydration, and recoverable-render composition through the existing `ReactServerEntry` response path.

- [#2850](https://github.com/fluojs/fluo/pull/2850) [`d29de3f`](https://github.com/fluojs/fluo/commit/d29de3fd32f3362d8ad92dd718d4187bf3dc9502) Thanks [@ayden94](https://github.com/ayden94)! - Add class- and method-level `PageLayout` and `SuspenseFallback` component-reference policies, pass resolved policies and the active request-scope container to the application page renderer, and reject invalid policy declarations during bootstrap.

  Applications that construct `ReactRenderContext` objects themselves, including custom renderer adapters and test fixtures, must now provide the active request-scope container as `container: requestContext.container` or an equivalent `Container`. Applications that receive the context from fluo's `ReactPageRenderer` callback require no migration.

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#2851](https://github.com/fluojs/fluo/pull/2851) [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2) Thanks [@ayden94](https://github.com/ayden94)! - Add immutable React page catalogs and expose compiled route kinds, effective paths, versions, and parameter names through runtime inspection, `fluo inspect`, and Studio diagnostics.

- [#2853](https://github.com/fluojs/fluo/pull/2853) [`44cb5e9`](https://github.com/fluojs/fluo/commit/44cb5e928bb634c91cfbd376fd9b5f3d2f07f753) Thanks [@ayden94](https://github.com/ayden94)! - Add deterministic path-only React page type generation with typed absolute href builders through `@fluojs/react/typegen` and `fluo typegen`.

- [#2859](https://github.com/fluojs/fluo/pull/2859) [`edf47a1`](https://github.com/fluojs/fluo/commit/edf47a1aafb764a82d5eb1b401bc8590685c1678) Thanks [@ayden94](https://github.com/ayden94)! - Generate route-bound real-anchor props and typed `push`/`replace` methods so React page ids and exact path params stay visible through declarative and programmatic HTTP-first navigation.

- [#2860](https://github.com/fluojs/fluo/pull/2860) [`b6acc33`](https://github.com/fluojs/fluo/commit/b6acc33726e380c58c49fa52a5674f348759f9ac) Thanks [@ayden94](https://github.com/ayden94)! - Add synchronous request-aware `PageMetadata` policies with deterministic title, meta, and link composition plus ordinary escaped React element helpers for application-owned page renderers.

- [#2898](https://github.com/fluojs/fluo/pull/2898) [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d) Thanks [@ayden94](https://github.com/ayden94)! - Add an HTTP-owned, content-negotiated error representation seam that preserves canonical JSON by default, optionally renders application-owned HTML for classified errors and route misses, and keeps status, headers, `HEAD`, abort, commit, and one-shot fallback behavior in the dispatcher.

  Expose runtime bootstrap wiring, a buffered React error-document provider adapter, and typed network/fetch-style portability assertions for the new representation contract.

  Preserve existing Express response `Vary` values when HTTP error representation negotiation adds `Accept`.

- [#2900](https://github.com/fluojs/fluo/pull/2900) [`ca5fb8d`](https://github.com/fluojs/fluo/commit/ca5fb8dc19da0703022d33eb07a4b8ec08bd2824) Thanks [@ayden94](https://github.com/ayden94)! - Add deterministic React typegen check and watch workflows with versioned artifact diagnostics, atomic writes, stable exit codes, and a documented consumer testing loop.

- [#3704](https://github.com/fluojs/fluo/pull/3704) [`271540e`](https://github.com/fluojs/fluo/commit/271540e9f2c1e5f6b18766291de19e056a3b669a) Thanks [@ayden94](https://github.com/ayden94)! - Allow omitted or undefined paths for HTTP verb decorators, Sse, Query, Route(method), and React Path, preserving the empty relative path and controller/router prefix. Allow Module(), ApiOperation(), and ApiBody() with the existing empty-object metadata semantics.

  Keep required semantic arguments, metadata merge and stacking behavior, React options absence, route validation, and lifecycle contracts unchanged. These fifteen conveniences add factory caller paths, not bare decorator overloads. React uses minor metadata under the current 0.x policy; Changesets combines this intent with pending releases.

### Patch Changes

- [#3402](https://github.com/fluojs/fluo/pull/3402) [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3) Thanks [@ayden94](https://github.com/ayden94)! - Add typed internal HTTP response writer and result-finalizer integration seams, plus a portable HTTP authoring entrypoint that avoids Node async-context bootstrap.

  Keep the `@fluojs/react` root free of eager Node built-ins by consuming the portable HTTP and runtime-internal authoring seams while preserving stable SSR, direct page finalization, and experimental Flight response behavior.

- [#2841](https://github.com/fluojs/fluo/pull/2841) [`5303aa7`](https://github.com/fluojs/fluo/commit/5303aa734a7ce53c77eeaea6954dc36371c60d57) Thanks [@ayden94](https://github.com/ayden94)! - Cancel unfinished SSR and experimental Flight readers when response sinks close or writes fail, releasing reader locks without masking sink errors.

- [#3507](https://github.com/fluojs/fluo/pull/3507) [`c6cc61b`](https://github.com/fluojs/fluo/commit/c6cc61b6d77685c221961f0b17bc383a745beb6f) Thanks [@ayden94](https://github.com/ayden94)! - Keep React SSR + Vite starter decorator declarations in `src/app.ts` so generated projects stay within the supported `@fluojs/vite` transform boundary while JSX remains in `.tsx` modules.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`271540e`](https://github.com/fluojs/fluo/commit/271540e9f2c1e5f6b18766291de19e056a3b669a), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`271540e`](https://github.com/fluojs/fluo/commit/271540e9f2c1e5f6b18766291de19e056a3b669a), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/http@3.0.0
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0

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
