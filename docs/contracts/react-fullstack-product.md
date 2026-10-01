# HTTP-First React Full-Stack Product Contract

<p><strong><kbd>English</kbd></strong> <a href="./react-fullstack-product.ko.md"><kbd>한국어</kbd></a></p>

## Scope and acceptance boundary

This is the product contract for an operations CRUD app (authenticated list, search, detail, edit, save and sign-out) and a bar jukebox (a long-lived shell resource across songs, QR, search and queue management). It specifies **target** user outcomes, not newly shipped behavior. The completed [#2489 roadmap](https://github.com/fluojs/fluo/issues/2489) records historical API milestones; [#3869](https://github.com/fluojs/fluo/issues/3869) tracks this additional product gate. Roadmap order is not a release version or approval of 1.0. A green API test or an exported hook alone does not pass an end-to-end journey: the consumer must finish the task without writing a second renderer, router, cache or request-race framework. [#3879](https://github.com/fluojs/fluo/issues/3879) closes the product gate only when every required journey passes on the official starter in real dev and production browsers.

**Prerequisites and public entrypoints.** The generated Node.js + Fastify app uses `fluo new my-react-app --starter react-vite-ssr`, `pnpm dev`, and its production `build`/`start` scripts. Register HTTP page handlers through `ReactModule.forRoot({ controllers, renderPage })` from `@fluojs/react`; use `@Router`/`@Path`, ordinary `@fluojs/http` DTOs and `@Post`, `@fluojs/react/client` `Link`/`useRouter()`/`ReactClientRouterProvider`, and `@fluojs/react/vite` for an application-loaded build manifest. See the [React API owner](../../packages/react/README.md) and [CLI API owner](../../packages/cli/README.md) for exact imports and configuration. #3871 supplies a two-page starter composition with an escaped, bounded HTTP-selected initial payload and build-produced destination imports; it does not imply that the remaining product journeys are complete.

`@fluojs/http` alone owns URL matching, DTO binding and validation, middleware, guards, interceptors, request scopes, status, headers, errors, abort and the HTTP request/response lifecycle. A page GET may render an application-composed React document or opt into the existing negotiated destination, but there is no client matcher, second action router or primary file-routing API. The framework's **target** official composition builds one request-owned page shell, SSR/hydration assets, HTTP-approved navigation and failure/retry presentation from the existing module/provider/router and native form paths; the application still authors pages, domain DTOs, providers, mutation policy, identity-dependent data and hosting. Public creation/configuration stays on the existing `ReactModule.forRoot(...)` class-static registration and existing capability-specific entrypoints, not duplicate wrappers. The stable root stays runtime-neutral; browser and Vite integrations stay on their subpaths. RSC/Server Functions remain experimental until the separate [graduation gate](./react-rsc-graduation.md).

The framework is responsible for preserving the stated navigation/history/failure and cancellation boundaries, validating payloads before commits, and making the official composition usable. The application is responsible for music licensing/player SDKs, queue semantics, persistence, idempotency, session/CSRF rules, authorization decisions, focus policy where not included in the future official composition, and asset/CDN deployment. No framework guarantee extends playback across an explicit logout teardown, forced reload, actual tab close or OS discard.

## Journey acceptance map

The table separates current capabilities from whole-product acceptance still requiring execution. Closed prerequisites are not reclassified as missing implementations. **Shipped** names the scoped capability in existing owning contracts/tests; #3886 source harnesses are not run evidence. Every row needs #3879 exact-head integration. S/F/C is success/failure/cancellation, never rollback of a dispatched POST.

### Background interaction scope

The existing `useForm` now has additive background GET/POST, independent stable-id
state, latest-wins ownership, session revocation and coalesced fresh same-page HTTP
approval. `/catalog/background` in the official example and packaged starter uses
an actual song datasource, independent search/widget reads and queue row writes.
Its source/types/dispatcher and deterministic listener/browser fixtures exercise
reversed responses, two held writes, isolated failure, unmount and native GET/
POST303GET. These fixtures are a scoped correctness surface, not #3879's complete
CRUD/jukebox gate, #3886 soak, measured framework parity or a MusicKit claim.
The [form owner](./react-progressive-forms.md) defines the exact shipped semantics.

| User journey | Observable S / F / C target | Current evidence and classification | Owner and real verification surface |
| --- | --- | --- | --- |
| First run | S: scaffold, install, `pnpm dev`, first HTTP page; F: actionable bootstrap/asset error, no false ready; C: stop child/watchers and close app. | **Shipped scoped two-page composition**, not complete CRUD. `packages/cli/src/new/templates/react-vite-ssr/` and generated app dev/production browser cover direct GET, hydration and native anchors. | [#3871](https://github.com/fluojs/fluo/issues/3871), #3879; generated app dev browser and production startup. |
| Add a page | S: add explicit HTTP `@Path` and build-mapped browser destination through one documented composition; F: invalid/duplicate route or absent module fails clearly; C: interrupted request cannot commit a partial page. | **Shipped scoped authoring path.** A third-page generated consumer changed page/handler/DTO, an optional link and no renderer/entry/manifest/store file. Missing module fails before HTML commit; the same #3880 typegen connects query wire inputs, module props and saved data. Packaged dev/production consumer proof remains required. | #3871, [#3880](https://github.com/fluojs/fluo/issues/3880); consumer compile fixture, actual dispatcher and generated-app browser. |
| SSR | S: first GET streams the HTTP-matched shell and content; F: pre-commit error retains HTTP status/error ownership and abort releases resources; C: request abort cancels unfinished stream. | **Shipped baseline; verification gap** for delivered shell, slow client and resource budget. `packages/react/README.md`, `examples/react-vite-ssr/src/app.test.ts`. | [#3885](https://github.com/fluojs/fluo/issues/3885); production HTTP socket/slow-client and #3879 browser. |
| Hydration | S: server URL/params and built assets hydrate one interactive shell without warnings; F: missing assets/mismatch is diagnosable, not silently accepted; C: unmount cleans browser subscriptions. | **Shipped scoped composition.** Generated app passes dev/production browser without hydration diagnostics, retains shell and resets page state; #3884 owns measured bottlenecks, not another authoring path. | #3871, [#3884](https://github.com/fluojs/fluo/issues/3884); production browser and bundle trace. |
| Navigation | S: HTTP approves destination before URL/params commit and keeps shell/resource identity; F: transient network/5xx and recoverable mapped import failure retain committed view, show actionable retry and never auto-blank or destroy the jukebox shell; C: superseded request cannot commit or fall back. | **Shipped** official network/5xx/mapped-import-failure default and low-level opt-in; generated starter and production example failure browsers verify resource identity, operation/ack and mount/cleanup. | [#3864](https://github.com/fluojs/fluo/issues/3864), #3871; injected network/5xx/import-failure production browser and generated composition. |
| History and unsaved edits | S: back/forward obtains fresh HTTP approval and approved URL/view agree; F: failed traversal restores coherent history/view; C: opted-in dirty edit can decline push/replace/back/forward without losing input or creating a duplicate entry. | **Scoped opt-in permission** through `useNavigationGuard` in the existing store and tagged same-document recovery; untagged/cross-document entries retain native boundaries. `packages/react/src/client-navigation-guard.test.ts`, `examples/react-vite-ssr/tests/navigation-guard.spec.ts`. | #3864, [#3882](https://github.com/fluojs/fluo/issues/3882); production and packaged dev/production back/forward, dirty-form and session races. |
| Error and retry | S: transient failure presents a retry that makes a **fresh** HTTP request and commits only its approved result; F: repeated failure keeps current shell/page and an actionable error, not blank/unhandled UI; C: cancel clears pending UI without fallback. | **Shipped** official network/5xx/mapped-import-failure recovery controls and low-level opt-in, **verification gap** for extended soak. `packages/react/src/client/store.ts`, generated starter and example failure browser tests. | #3864, [#3872](https://github.com/fluojs/fluo/issues/3872), [#3886](https://github.com/fluojs/fluo/issues/3886); failure-injected production browser and repeated resource probes. |
| Reads and search | S: HTTP DTO-validated list/detail and independent search get current data with separate pending/results; F: validation/auth/transport results stay distinct and one failed widget cannot blank another; C: latest request wins, teardown cancels its own work. | **Shipped** independent background GET/POST through the existing `useForm`, latest-wins owners and coalesced save approval. `client-background-form.test.ts` and actual jukebox fixtures own these seams; whole-product acceptance stays separate. | [#3881](https://github.com/fluojs/fluo/issues/3881), #3880; dispatcher plus production browser with reversed responses. |
| Form submission | S: native POST traverses HTTP DTO/guard/interceptor and 303/GET without JS, enhanced form shows pending; F: invalid input retains editable fields and safe errors, auth refusal is not success; C: stopping browser wait never claims to undo a server mutation. | **Shipped** native POST/303/GET and the existing progressive `useForm` pending/field-error path; generated input/saved inference uses that same path, with packaged browser verification still required. `examples/react-vite-ssr/src/app.ts`, `src/app.test.ts`, `tests/production-hydration.spec.ts`. | [#3874](https://github.com/fluojs/fluo/issues/3874), #3880, #3881; dispatcher and JS-on/off production browser. |
| Post-save freshness | S: approved new data appears without destroying the shell for enhanced saves; F: stale result cannot overwrite a newer save and failure remains actionable; C: cancelled revalidation keeps last committed view. | **Shipped** explicit HTTP-approved refresh with typed completion; the existing #3874 form path adds automatic follow-up approval with separate saved/read outcomes. `invalidate()` clears prefetch/pending; native 303/GET remains shipped. | [#3873](https://github.com/fluojs/fluo/issues/3873), #3874, #3881; dispatcher plus production browser after save. |
| Auth transition | S: session epoch changes before further soft navigation, protected data/resources respect app policy; F: 401/403 is not treated as transient retry or a public cached success; C: old-session pending work cannot commit after sign-out. | **Shipped** provider session/saved-session barriers, fresh credentialed 401/403 revocation and app-owned cleanup composition. `client-session.test.ts` and `tests/session-transition.spec.ts` record these boundaries. | [#3875](https://github.com/fluojs/fluo/issues/3875), #3881; guarded dispatcher and production browser login/logout races. |
| Development edits | S: React/CSS edits update predictably, server/shared edits restart safely and config follows its documented boundary; F: syntax/bootstrap failure surfaces and recovery works after correction; C: interrupted restart shuts child and middleware down. | **Shipped** scoped Node React Fast Refresh/CSS HMR and restart baseline; **verification gap** for #3877's general server/shared/config drain and recovery. `packages/cli/src/dev-runner/react-vite-dev-app.ts`, `docs/architecture/dev-reload-architecture.md`. | [#3876](https://github.com/fluojs/fluo/issues/3876), [#3877](https://github.com/fluojs/fluo/issues/3877); generated-app dev browser edits/recovery. |
| Deployment transition | S: built A tab navigating after B deploy resolves to compatible approved destination; F: missing/old chunks show recoverable UI or explicit document upgrade without infinite retry/blank view; C: stale import cannot commit after newer intent. | **Scoped v2 build identity and deployment recipe**: the complete Vite manifest and `/assets/` base identify each build, and mismatch is rejected before import with an explicit update option. Independent A→B browser evidence is required; this row does not claim the final product gate. | [#3878](https://github.com/fluojs/fluo/issues/3878), #3884; two-build production browser with pinned tab and host assets. |
| Long session | S: repeated jukebox operations keep one usable shell resource and bounded live listeners/requests; F: injected recoverable errors never produce blank/unhandled UI; C: explicit logout/reload/tab termination is honored instead of simulated preservation. | **Execution verification required.** `tests/long-session.spec.ts`, a separate soak and physical-device handoff now exist as source. This is not an executed two-hour result or a reproduced leak/MusicKit failure. | #3886; deterministic 1,000-action browser loop and separate extended soak, then #3879 gate. |

## Failure and freshness defaults

Dirty/pending protection is opt-in through one existing-provider `useNavigationGuard`
owner. Permission precedes ordinary GET, prefetch adoption and obsolete navigation
form cancellation; staying is not transport failure. Session revocation supersedes
the decision before abort/policy. Tagged history recovery does not promise protection
of untagged or cross-document entries. See the
[owning navigation contract](./react-navigation-payload.md#navigation-permission).
This scoped capability is not the complete #3879 product or #3886 soak gate.

**#3872's opt-in official composition:** `ReactNavigationExperience` keeps pending status
outside the page slot, treats an approved destination render throw as a local page-boundary
failure, and offers a reset that neither issues HTTP nor changes history. A throwing
application error view reaches an outer diagnostic surface while the shared shell stays
usable. Matched `@PageMetadata(...)` accompanies the HTTP-approved payload through SSR and
soft navigation, with bounded page-owned head updates and removal. Live-region, focus and
scroll defaults can be replaced through `onApprovedNavigation`; an unrecoverable root/browser
failure cannot be recovered by a page boundary. #3864 still owns transient transport policy,
fresh `router.retry()`, explicit `router.openDocument()`, and failed-history recovery.
The official retry and document controls live in the persistent shell outside the page slot.

**Current** low-level `ReactClientRouterProvider` retains document fallback unless the application
supplies `failurePolicy`. That opt-in can preserve network/5xx failures, expose a safe failure
through `useNavigation()`, and offer fresh `router.retry()` or explicit `router.openDocument()`.
The production Vite example demonstrates an operational resource surviving failure and retry.
The official generated composition explicitly wires network/5xx and recoverable mapped import-failure preservation and actionable
controls in the persistent shell. Failed `popstate` traverses back to a tagged approved
history entry. Stale results and cancellation never commit. HTTP authorization rejection
(401/403), redirects, 404, invalid DTO/payload, absent importer keys and deployment skew
are not silently transient. The app may tear down protected UI on sign-out; native anchors,
modified clicks, new tabs, JavaScript-disabled requests and forced reload remain document paths.
The production starter also preserves `incompatible-build` while showing an explicit
document update; its `/assets/` release ordering and asset retention belong to the
[production deployment recipe](../guides/react-production-deployment.md).
Actual tab close/OS discard is not a preservation promise. A recoverable jukebox navigation
failure that destroys its shell, leaves a blank view or raises an unhandled error fails the
product gate.

**Current** `router.refresh()` returns a typed outcome after fresh HTTP-approved same-page revalidation, retaining the shell and history while resetting approved page-local state. It initiates document reload only without a soft destination or by failure policy; `window.location.reload()` is the explicit unconditional document operation. `router.invalidate()` clears the provider's bounded single-use *public* prefetch and pending work; it does not fetch fresh page data. The application must change `prefetchScope` and/or invalidate after relevant mutations/auth transitions before the next in-document navigation. See the [refresh migration](../getting-started/migrate-react-refresh.md); #3874/#3875 integrate saves and sessions. No general/private loader cache or automatic cache policy is shipped.

## Development and deployment boundary

### Session composition boundary

Use the existing provider's `session` option and
`router.sessionChanged({ epoch, reason })` for application-confirmed login,
logout and permission changes. Repeated epoch labels advance internal ownership.
The barrier revokes approved page/head/retained form data, including the initial
SSR fallback, before asynchronous policy or old abort listeners run. Fresh
credentialed 401 selects signed-out and 403 selects forbidden without discarding
identity; anonymous speculation cannot terminate a credentialed session.

An explicit saved `ReactModule.formResult({ ..., session, data })` enters that
same boundary. Only its initiating confirmed continuation survives for fresh
GET approval; GET retry never resends POST. App-owned protected resources use
existing React subtree/effect cleanup, not a framework teardown registry.
External HttpOnly cookie changes are not an immediate notification channel.
The [session migration](../getting-started/migrate-react-session-composition.md)
and owning navigation/forms contracts define the exact defaults and overrides.
Production example and packaged starter session journeys provide scoped evidence,
not #3879's complete product gate or #3886's extended soak.

| Edit class | Current mechanism and outcome | Target owner and failure/recovery boundary |
| --- | --- | --- |
| React component (`.tsx`) | On the official Node React/Vite client graph, `fluo dev` applies Fast Refresh without replacing the app child; SSR page modules reload for direct HTTP requests after DTO validation. State is retained only for compatible component boundaries. | #3876 owns this scoped behavior and syntax-error correction; #3877 owns general shared/server restart and drain policy. |
| CSS | Vite updates the browser stylesheet over the app-origin WebSocket without replacing the app child or document. | #3876 owns this scoped behavior; raw native watch remains a process-restart escape hatch. |
| Server-only code | Child/process restart, fresh bootstrap; active work needs orderly drain and browser recovery. | #3877 owns shutdown, stale SSR and failure/restart recovery; no in-place server module swap guarantee. |
| Shared server/client code | Vite-transformed `.tsx` page/document components receive browser HMR and current SSR module loads; other shared source follows supervisor restart and may lose state. | #3877 owns general shared dependency restart/drain policy rather than promising universal state preservation. |
| Config | Watched env inputs may replace a validated `@fluojs/config` snapshot with `watch: true`; source/Vite config changes still follow the CLI restart path. | #3877 separates explicit config snapshot reload and error rollback from restart-required config/build changes. |

Evidence: `packages/cli/src/dev-runner/react-vite-dev-app.ts` creates middleware Vite with an application-hosted WebSocket; `packages/cli/src/dev-runner/node-restart-runner.ts` supervises non-HMR child restarts; [dev reload architecture](../architecture/dev-reload-architecture.md) records the boundaries. Production build manifest loading and static asset/CDN publishing remain application/host responsibilities; #3878 owns A→B compatibility and recovery, not automatic deployment.

## Issue ownership and completion gates

This dependency graph is directed from prerequisite to consumer. #3870 fixes this document **before** feature/benchmark implementation; it does not wait for #3883's measurements. #3883 fixes executable environment, workloads and numeric budgets **before** #3884/#3885 optimization; #3879 alone waits for all feature, measurement and reliability gates. Starting fixture work for #3879/#3886 may proceed in parallel with prerequisites, but their final sign-off cannot.

| Child | Unique ownership and completion gate |
| --- | --- |
| [#3870](https://github.com/fluojs/fluo/issues/3870) | This EN/KO contract, journey map and comparison; docs/release metadata validation, **not** runtime product PASS. |
| [#3871](https://github.com/fluojs/fluo/issues/3871) | One official starter/SSR/hydration/navigation composition; generated-consumer browser journey. |
| [#3872](https://github.com/fluojs/fluo/issues/3872) | Navigation pending, render-error/head and accessibility behavior; production browser. |
| [#3864](https://github.com/fluojs/fluo/issues/3864) | Transient failure/retry, shell and history/resource identity; failure-injected production browser. |
| [#3873](https://github.com/fluojs/fluo/issues/3873) | Current-page soft revalidation and `refresh()` migration; after-save browser. |
| [#3874](https://github.com/fluojs/fluo/issues/3874) | Native-progressive form pending/errors and save integration; DTO/guard dispatcher and JS-on/off browser. |
| [#3875](https://github.com/fluojs/fluo/issues/3875) | Auth/session/mutation invalidation coordination; protected dispatcher and sign-out browser. |
| [#3876](https://github.com/fluojs/fluo/issues/3876) | React Fast Refresh and CSS HMR; real dev-browser file edits. |
| [#3877](https://github.com/fluojs/fluo/issues/3877) | Server/shared/config safe restart, drain and recovery; real dev-browser failure/correction. |
| [#3878](https://github.com/fluojs/fluo/issues/3878) | Build A→B asset/navigation compatibility and recovery; two-build production browser. |
| [#3880](https://github.com/fluojs/fluo/issues/3880) | One typed route/query/page-props/mutation projection, not a second generator; negative consumer compile and HTTP round trip. |
| [#3881](https://github.com/fluojs/fluo/issues/3881) | Non-navigation search/row jobs and independent races via the same interaction path as #3874; browser reversed-response tests. |
| [#3882](https://github.com/fluojs/fluo/issues/3882) | Opt-in pre-request dirty-edit approval/cancellation via #3864 history recovery, not a second router; browser back/forward races. |
| [#3883](https://github.com/fluojs/fluo/issues/3883) | Pinned same-app benchmarks, environment/workload and numeric baseline budgets; reproducible measurement and regression gate. |
| [#3884](https://github.com/fluojs/fluo/issues/3884) | Measured client JS/hydration/navigation bottlenecks against #3883 budgets; production trace/browser. |
| [#3885](https://github.com/fluojs/fluo/issues/3885) | Measured SSR shell/slow-client/abort resource bottlenecks against #3883 budgets; real production socket. |
| [#3886](https://github.com/fluojs/fluo/issues/3886) | Repeated jukebox resource bounds and recovery, not a second retry implementation; deterministic browser and soak. |
| [#3879](https://github.com/fluojs/fluo/issues/3879) | Final generated-app integration, every journey's real-surface acceptance and umbrella closure; cannot go green on API existence alone. |

No child owns an alternative public matcher/action path: #3874 owns submit behavior, #3881 extends its non-navigation mode, #3880 owns types, #3864 owns failure/history mechanism, #3882 uses it for pre-request user intent, and #3886 tests repeated lifetimes. #3879 integrates rather than recreates these mechanisms. Neither #3870 nor #3883 depends on #3879.

## Same-app comparison, not API imitation

Compare authenticated CRUD and a long-lived jukebox under equivalent authentication, data size, native forms, failures and production assets. The entries below are **official documentation evidence of mechanisms**, not executed Fluo/competitor benchmarks, measured speed, security equivalence or claims that a particular feature is always automatic. Exact official URLs and source behavior follow each row.

| Framework and documented feature | Consumer authoring cost and type boundary | Performance evidence and stability boundary |
| --- | --- | --- |
| **Fluo, current stable**: explicit HTTP handler/DTO plus application renderer; approved payload soft navigation, native POST/303/GET, bounded public-only prefetch. | Low first-page cost in the starter; **assembly burden** remains for complete CRUD/jukebox integration; the existing compiler projection now connects path/query/page props/form data within its limited JSON contract. This is not whole-product acceptance. See the journey map above. | **Unmeasured** same-app latency/bytes/resource budget; #3883 establishes numeric targets. Stable root is runtime-neutral; RSC/Server Functions are experimental and excluded from the stable comparison. |
| **Next.js App Router**: a `loading.js` file wraps its page in Suspense and shows a layout while data renders ([official fetching guide](https://nextjs.org/docs/app/getting-started/fetching-data)); `router.refresh()` requests the server again and merges updated RSC payload without losing unaffected client React state, but does **not** invalidate the server-side cache ([official useRouter reference](https://nextjs.org/docs/app/api-reference/functions/use-router)). | Documented route/segment and component convention reduces manual layout/loading composition; actual form DTO, auth and type constraints remain app-specific and are not assumed equivalent to Fluo's HTTP pipeline. | Docs establish the refresh mechanism, **not a measured advantage**. Compare stable documented behavior only; no canary/experimental feature is counted as baseline. |
| **React Router Framework Mode**: server `loader` runs for SSR and automatic client-navigation fetches ([official data-loading guide](https://reactrouter.com/start/framework/data-loading)); a route `action` completion revalidates page loaders, with non-navigation `<fetcher.Form>` available ([official actions guide](https://reactrouter.com/start/framework/actions)). | Co-located `loader`/`action` and generated `Route.ComponentProps` reduce handwritten wiring and connect loader data types. Each app still authors auth/domain logic and chooses revalidation policy. | No benchmark here. Its [deployment guide](https://reactrouter.com/start/framework/deploying) documents full-stack or static hosting; this does not prove deployment-skew recovery. |
| **TanStack Start**: `createServerFn()` calls are server-side with client invocations and framework serialization ([official server-functions guide](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)); colocated file-based server routes handle raw HTTP endpoints ([official server-routes guide](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)). | Server-function input/output is checked for serializability and can use validators; raw server routes remain a distinct endpoint choice. This is not a proposal to add a Fluo RPC/action router or file routes. | No measured performance claim. The guide explicitly marks custom `generateFunctionId` **experimental**; do not count it as a stable baseline or equate all Start internals with Fluo's HTTP-owned contract. |

Feature availability, authoring cost and type-safety entries are source-backed or explicitly inferred from the described wiring; none proves the same CRUD/jukebox task passes in a browser. [#3883](https://github.com/fluojs/fluo/issues/3883) pins stable versions, equivalent workload/cache policy, desktop/low-end environment and numeric absolute/relative budgets **before** optimization. #3884/#3885 measure and fix client/server paths, and #3886/#3879 gate long-lived correctness. Do not call this roadmap competitor API parity or graduation to 1.0.

## Evidence and verification limits

Source seams: `packages/react/src/client/store.ts`, `packages/react/src/client/navigation-payload.ts`, `packages/react/src/module.ts`, `packages/cli/src/dev-runner/react-vite-dev-app.ts`, `examples/react-vite-ssr/src/app.ts`. Existing tests: `packages/react/src/client.test.ts`, `examples/react-vite-ssr/src/app.test.ts`, `examples/react-vite-ssr/tests/production-hydration.spec.ts`; the [navigation payload contract](./react-navigation-payload.md) contains additional HTTP/prefetch coverage. These are **existing** behavior records, not newly executed browser or performance results. The example models a native form and a short-lived shell counter, not an actual licensed player or the future product gate. Documentation validation checks links/structure and EN/KO pairing, not future runtime success. The affected FluoBlog chapter 17 and FluoShop chapter 4 companions apply the typed contract alongside their unchanged native exercises; manuscript validation is not their DB/browser execution evidence.


## Typed contract acceptance

The [end-to-end types contract](./react-end-to-end-types.md) owns the one frozen
compiler/HTTP projection, actual shared tsconfig/bootstrap options, wire aliases
and converter inputs, URI selection provenance, module registry and limited JSON
props/saved data. The same generator/check/watch lifecycle must include type-only
and compiler/configuration freshness. Existing `--check` gates ordinary
typecheck/build without silent regeneration. Strict negative consumers, real HTTP
query/POST round trips and clean generated dev/production browser journeys are
required; focused type tests alone do not pass #3880 or #3879. No generated GET
decoder (#3881), second form/provider, erased-type recovery, performance or soak
claim follows from the presence of these contracts.

## Progressive native HTTP forms

The [progressive form contract](./react-progressive-forms.md) connects `useForm` in the existing
provider with root `ReactModule.formResult` through one native HTTP path. HTTP
still owns DTO/guard/interceptor, request scope, status and errors; native
POST/303/GET remains. Distinguish confirmed `saved` from a failed follow-up read,
and validation/auth from uncertain persistence. `retryRead()` repeats only GET.
Busy activation is skipped; no POST is automatically retried or replayed.
Automatic form refresh retains unrelated form input/errors/focus and the shell;
existing explicit `useRouter().refresh()` still resets page state after approval.
