# book-docs-ssot-audit-advanced

## Part Metadata
- Part: `advanced`
- Execution order slot: `3`
- SSOT snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Report path: `docs/audits/book-docs-ssot-audit/advanced.md`
- Assigned chapter list: `book/advanced/ch00-introduction.ko.md` through `book/advanced/ch17-contributing.ko.md` (`18` chapters)
- Chapter inventory: `book/advanced/ch00-introduction.ko.md`, `book/advanced/ch01-decorator-history.ko.md`, `book/advanced/ch02-metadata.ko.md`, `book/advanced/ch03-custom-decorators.ko.md`, `book/advanced/ch04-provider-resolution.ko.md`, `book/advanced/ch05-scopes.ko.md`, `book/advanced/ch06-circular-deps.ko.md`, `book/advanced/ch07-dynamic-modules.ko.md`, `book/advanced/ch08-module-graph.ko.md`, `book/advanced/ch09-app-context.ko.md`, `book/advanced/ch10-runtime-branching.ko.md`, `book/advanced/ch11-request-pipeline.ko.md`, `book/advanced/ch12-execution-chain.ko.md`, `book/advanced/ch13-custom-adapter.ko.md`, `book/advanced/ch14-portability-testing.ko.md`, `book/advanced/ch15-studio.ko.md`, `book/advanced/ch16-custom-package.ko.md`, `book/advanced/ch17-contributing.ko.md`
- Excluded surfaces: `book/README*`, `book/*/toc*`, English `book/**/ch*.md`, Korean `docs/**` authority inputs, hubs, indexes, navigation aids
- Aggregate chapter status counts: `mixed=0`, `real_issue=0`, `insufficient_ssot=18`, `false_positive=0`, `no_issues=0`
- Mapping source note: `Frozen before reviewer fan-out per chapter.`
- Accepted finding field schema: `Canonical Title:`, `Severity:`, `Book:`, `Docs:`, `Problem:`, `Rationale:`.
- Accepted finding lint status: `0 accepted findings currently remain in this advanced report; any future accepted finding in this snapshot must expose the explicit field schema above or be downgraded out of Accepted Findings.`

## Chapter Inventory
- `book/advanced/ch00-introduction.ko.md`
- `book/advanced/ch01-decorator-history.ko.md`
- `book/advanced/ch02-metadata.ko.md`
- `book/advanced/ch03-custom-decorators.ko.md`
- `book/advanced/ch04-provider-resolution.ko.md`
- `book/advanced/ch05-scopes.ko.md`
- `book/advanced/ch06-circular-deps.ko.md`
- `book/advanced/ch07-dynamic-modules.ko.md`
- `book/advanced/ch08-module-graph.ko.md`
- `book/advanced/ch09-app-context.ko.md`
- `book/advanced/ch10-runtime-branching.ko.md`
- `book/advanced/ch11-request-pipeline.ko.md`
- `book/advanced/ch12-execution-chain.ko.md`
- `book/advanced/ch13-custom-adapter.ko.md`
- `book/advanced/ch14-portability-testing.ko.md`
- `book/advanced/ch15-studio.ko.md`
- `book/advanced/ch16-custom-package.ko.md`
- `book/advanced/ch17-contributing.ko.md`

## Chapter Reports

### `book/advanced/ch00-introduction.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/CONTEXT.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/decorators-and-metadata.md`, `docs/contracts/behavioral-contract-policy.md`, `docs/reference/glossary-and-mental-model.md`, `docs/reference/package-surface.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 insufficient_ssot candidate; example-code=no_issues; coverage/edge-case=1 insufficient_ssot candidate; adjudication=1 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Advanced intro depends on repo-internal source-tour and tooling claims beyond the frozen docs set`
  - Book: `book/advanced/ch00-introduction.ko.md:12-16`, `book/advanced/ch00-introduction.ko.md:22-27`, `book/advanced/ch00-introduction.ko.md:95-99`, `book/advanced/ch00-introduction.ko.md:137-150`
  - Docs: `docs/architecture/architecture-overview.md:9-12`, `docs/architecture/architecture-overview.md:17-22`; `docs/architecture/decorators-and-metadata.md:37-46`; `docs/reference/package-surface.md:32-36`; `docs/contracts/behavioral-contract-policy.md:5-14`
  - Rationale: The frozen English docs confirm the high-level core/runtime boundaries, behavioral-contract framing, and metadata-helper ownership, but they do not document the chapter's repo-internal path:line walkthrough promises, named internal helper/store tour, CLI debug or Studio workflow guidance, or chapter-level implementation itinerary strongly enough to clear the intro as `no_issues`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch01-decorator-history.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/architecture/decorators-and-metadata.md`, `docs/contracts/nestjs-parity-gaps.md`, `docs/getting-started/migrate-from-nestjs.md`, `docs/architecture/di-and-modules.md`, `docs/reference/package-surface.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=no_issues; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Decorator-history timeline and adoption narrative exceeds the current decorator contract authority`
  - Book: `book/advanced/ch01-decorator-history.ko.md:21-30`, `book/advanced/ch01-decorator-history.ko.md:34-45`, `book/advanced/ch01-decorator-history.ko.md:171-177`
  - Docs: `docs/architecture/decorators-and-metadata.md:5-18`, `docs/architecture/decorators-and-metadata.md:48-62`; `docs/contracts/nestjs-parity-gaps.md:32-34`; `docs/getting-started/migrate-from-nestjs.md:24-27`
  - Rationale: The mapped English docs define the current standard-vs-legacy baseline, the explicit-token migration rule, and the intentional rejection of legacy decorator flags, but they do not publish the chapter's 2015/2022/2023 timeline, Stage progression chronology, or ecosystem-adoption history strongly enough for a dual-citation contradiction or clearance decision.
- `Benchmark and future-capability claims outrun the frozen decorator authority`
  - Book: `book/advanced/ch01-decorator-history.ko.md:87-104`, `book/advanced/ch01-decorator-history.ko.md:148-161`, `book/advanced/ch01-decorator-history.ko.md:179-184`
  - Docs: `docs/architecture/decorators-and-metadata.md:37-46`, `docs/architecture/decorators-and-metadata.md:59-62`; `docs/architecture/di-and-modules.md:24-27`; `docs/reference/package-surface.md:32-36`
  - Rationale: The frozen English docs are strong enough to confirm explicit `@Inject(...)`, metadata-helper ownership, and the removal of legacy reflection-driven wiring, but they stay silent on the chapter's `30-50%` memory claim, Stage 4 timing, native browser/runtime rollout, private-member injection, static-block integration, and similar forward-looking capability statements, so the chapter must remain fail-closed as `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch02-metadata.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/architecture/decorators-and-metadata.md`, `docs/architecture/architecture-overview.md`, `docs/reference/package-surface.md`, `docs/reference/glossary-and-mental-model.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=no_issues; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Reflect API and metadata-inspection walkthrough exceeds the published metadata contract`
  - Book: `book/advanced/ch02-metadata.ko.md:21-38`, `book/advanced/ch02-metadata.ko.md:78-100`, `book/advanced/ch02-metadata.ko.md:145-156`
  - Docs: `docs/architecture/decorators-and-metadata.md:37-46`; `docs/reference/glossary-and-mental-model.md:23-31`
  - Rationale: The frozen English docs define fluo-owned metadata helpers, `Symbol.metadata` or the polyfill anchor, cloned read/write boundaries, and explicit injection terminology, but they do not document `Reflect.get`, `Reflect.set`, `Reflect.construct`, `Reflect.getOwnPropertyDescriptor`, `Reflect.ownKeys`, `@fluojs/core/internal` debug helpers, or manual metadata-bag inspection as a governed English authority surface.
- `Metadata engine internals and future roadmap outrun the frozen authority set`
  - Book: `book/advanced/ch02-metadata.ko.md:120-145`, `book/advanced/ch02-metadata.ko.md:169-191`, `book/advanced/ch02-metadata.ko.md:285-291`
  - Docs: `docs/architecture/decorators-and-metadata.md:37-46`; `docs/architecture/architecture-overview.md:17-20`; `docs/reference/package-surface.md:32-36`
  - Rationale: The mapped English docs confirm that `@fluojs/core` owns metadata helpers and that `@fluojs/runtime` compiles modules and coordinates runtime orchestration, but they do not publish the chapter's custom-provider registry model, contextual injection behavior, `WeakRef` / `FinalizationRegistry` / `ShadowRealm` exploration, metadata versioning, or hot-reloading integration strongly enough for a safe contradiction or `no_issues` adjudication.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch03-custom-decorators.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/architecture/decorators-and-metadata.md`, `docs/architecture/di-and-modules.md`, `docs/architecture/openapi.md`, `docs/architecture/architecture-overview.md`, `docs/reference/package-surface.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Custom decorator helper APIs and example decorators exceed the published decorator contract`
  - Book: `book/advanced/ch03-custom-decorators.ko.md:21-44`, `book/advanced/ch03-custom-decorators.ko.md:45-120`
  - Docs: `docs/architecture/decorators-and-metadata.md:20-47`; `docs/architecture/di-and-modules.md:24-30`; `docs/architecture/openapi.md:17-29`
  - Rationale: The frozen English docs confirm only the standard decorator model, `context.metadata`/helper ownership, explicit `@Inject(...)` token rules, and the shipped OpenAPI decorator surface such as `@ApiOperation(...)`, `@ApiResponse(...)`, and related metadata readers. They do not publish `StandardDecoratorFn` / `StandardParameterDecoratorFn`, `defineInjectionMetadata`, `@CurrentUser()`, `@Roles()`, `@ApiDoc()`, or other helper-level extension APIs strongly enough for a contradiction-grade or clearance-grade decision.
- `Decorator composition, internal-debugging helpers, and future-extension claims outrun the frozen authority set`
  - Book: `book/advanced/ch03-custom-decorators.ko.md:121-174`, `book/advanced/ch03-custom-decorators.ko.md:175-264`
  - Docs: `docs/architecture/decorators-and-metadata.md:22-47`, `docs/architecture/decorators-and-metadata.md:48-62`; `docs/architecture/architecture-overview.md:17-25`; `docs/reference/package-surface.md:32-44`
  - Rationale: The mapped English docs are explicit about fluo-owned decorator categories, metadata helper ownership, and package responsibilities, but they stay silent on `applyDecorators`, `@fluojs/core/internal` testing/debug readers, concrete custom-composition utilities, and forward-looking extension-roadmap claims, so the chapter must remain fail-closed as `insufficient_ssot` instead of speculating that those helpers are either valid or invalid authority surfaces.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch04-provider-resolution.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/architecture/di-and-modules.md`, `docs/architecture/decorators-and-metadata.md`, `docs/architecture/architecture-overview.md`, `docs/reference/glossary-and-mental-model.md`, `docs/contracts/behavioral-contract-policy.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Normalized-provider internals and registration-conflict algorithms exceed the published DI contract`
  - Book: `book/advanced/ch04-provider-resolution.ko.md:21-115`
  - Docs: `docs/architecture/di-and-modules.md:5-20`, `docs/architecture/di-and-modules.md:36-57`; `docs/architecture/decorators-and-metadata.md:22-30`
  - Rationale: The frozen English docs are explicit about supported provider forms, explicit token injection, default/request/transient scope rules, `forwardRef(...)`, `optional(...)`, duplicate registration failure, and module visibility. They do not publish `normalizeProvider()`, `normalizeInjectToken()`, ancestor-conflict helpers, registration-array internals, alias-effective-provider walkers, or other record-shape and conflict-resolution internals strongly enough to adjudicate the manuscript's deeper normalization walkthrough as a verified mismatch or a verified no-issue chapter.
- `Resolution-chain, cache, and recovery-oriented error walkthroughs outrun the current English authority`
  - Book: `book/advanced/ch04-provider-resolution.ko.md:117-290`
  - Docs: `docs/architecture/di-and-modules.md:22-57`; `docs/reference/glossary-and-mental-model.md:11-16`, `docs/reference/glossary-and-mental-model.md:42-50`; `docs/contracts/behavioral-contract-policy.md:5-14`
  - Rationale: The mapped English docs confirm the high-level resolution contract, error classes for missing/request-scope/circular failures, and the general lifecycle framing, but they do not document chain-tracking helpers, per-provider cache keys, alias-cycle internals, targeted invalidation, internal lifecycle events, or the manuscript's benchmark-grade hot-path claims strongly enough for dual-citation contradiction findings.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch05-scopes.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/architecture/di-and-modules.md`, `docs/architecture/decorators-and-metadata.md`, `docs/architecture/lifecycle-and-shutdown.md`, `docs/architecture/http-runtime.md`, `docs/architecture/architecture-overview.md`, `docs/reference/glossary-and-mental-model.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Cache-shape, override-eviction, and stale-disposal mechanics exceed the published scope model`
  - Book: `book/advanced/ch05-scopes.ko.md:21-315`
  - Docs: `docs/architecture/di-and-modules.md:15-16`, `docs/architecture/di-and-modules.md:36-48`; `docs/architecture/decorators-and-metadata.md:29-30`; `docs/reference/glossary-and-mental-model.md:11-13`, `docs/reference/glossary-and-mental-model.md:46-50`
  - Rationale: The frozen English docs clearly publish the three-scope contract, root-shared singleton behavior, request-container isolation, transient-per-resolution semantics, and the singleton-to-request mismatch guard. They do not publish the manuscript's promise-cache maps, request-local singleton footgun, override invalidation internals, stale-disposal scheduling, or exact cache-key strategy strongly enough to support contradiction-grade findings.
- `Child-scope teardown ordering and request-disposal internals outrun the current shutdown authority`
  - Book: `book/advanced/ch05-scopes.ko.md:317-389`
  - Docs: `docs/architecture/lifecycle-and-shutdown.md:32-44`; `docs/architecture/http-runtime.md:9-23`; `docs/reference/glossary-and-mental-model.md:46-50`
  - Rationale: The mapped English docs confirm that shutdown hooks run in reverse order, runtime close paths end with container disposal, and the HTTP dispatcher disposes the request-scoped container before the request ends. They do not document container-tier `disposeAll()` ordering, request-child registry cleanup, stale-disposal queues, or the exact root-vs-child cache collection rules strongly enough for a safe final contradiction or clearance decision.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch06-circular-deps.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/architecture/di-and-modules.md`, `docs/architecture/architecture-overview.md`, `docs/getting-started/bootstrap-paths.md`, `docs/reference/glossary-and-mental-model.md`, `docs/contracts/behavioral-contract-policy.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Cycle-detection internals and alias-chain walkthrough exceed the published DI contract`
  - Book: `book/advanced/ch06-circular-deps.ko.md:21-51`, `book/advanced/ch06-circular-deps.ko.md:80-106`, `book/advanced/ch06-circular-deps.ko.md:164-166`
  - Docs: `docs/architecture/di-and-modules.md:24-30`, `docs/architecture/di-and-modules.md:53-56`; `docs/reference/glossary-and-mental-model.md:11-15`, `docs/reference/glossary-and-mental-model.md:29-31`; `docs/architecture/architecture-overview.md:17-20`
  - Rationale: The frozen English docs clearly publish explicit-token DI, `forwardRef(...)` as a declared token form for declaration-time cycles, `useExisting` alias support, `CircularDependencyError`, duplicate-policy governance, and the high-level module-graph responsibility split. They do not publish the chapter's `activeTokens`/`chain` detector, `withTokenInChain()` cleanup pattern, alias `visited`-set walk, readable-chain message strategy, or transient/request-scoped cycle-monitoring internals strongly enough for contradiction-grade or clearance-grade adjudication.
- `Cycle-breaking playbook and alternate escape hatches outrun the current English authority set`
  - Book: `book/advanced/ch06-circular-deps.ko.md:108-162`, `book/advanced/ch06-circular-deps.ko.md:168-176`
  - Docs: `docs/architecture/di-and-modules.md:29-30`, `docs/architecture/di-and-modules.md:53-56`; `docs/getting-started/bootstrap-paths.md:8-14`, `docs/getting-started/bootstrap-paths.md:44-50`; `docs/contracts/behavioral-contract-policy.md:9-14`
  - Rationale: The mapped English docs are explicit that provider cycles fail with `CircularDependencyError`, module-graph failures surface as `ModuleGraphError`, and documented lifecycle/order guarantees are binding contracts. They do not publish the manuscript's stronger recovery guidance about shared-provider extraction as the preferred error-driven refactor, `OnModuleInit` plus `ModuleRef`/`Container` as a sanctioned manual escape hatch, library-author anti-cycle guidance, or tree-shaking/visibility side effects strongly enough to classify those deeper recommendations as either a verified contradiction or a verified no-issue.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch07-dynamic-modules.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/architecture/di-and-modules.md`, `docs/architecture/architecture-overview.md`, `docs/reference/glossary-and-mental-model.md`, `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/contracts/third-party-extension-contract.md`, `docs/contracts/behavioral-contract-policy.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Manufactured module-class identity and metadata-merge internals exceed the published dynamic-module contract`
  - Book: `book/advanced/ch07-dynamic-modules.ko.md:21-70`, `book/advanced/ch07-dynamic-modules.ko.md:120-121`, `book/advanced/ch07-dynamic-modules.ko.md:204-206`, `book/advanced/ch07-dynamic-modules.ko.md:264-272`
  - Docs: `docs/reference/glossary-and-mental-model.md:24`, `docs/reference/glossary-and-mental-model.md:29`; `docs/contracts/third-party-extension-contract.md:17`, `docs/contracts/third-party-extension-contract.md:43-48`; `docs/architecture/di-and-modules.md:16-20`; `docs/architecture/architecture-overview.md:17-20`; `docs/reference/package-surface.md:33-36`
  - Rationale: The frozen English docs do publish dynamic modules as runtime-produced registration surfaces with explicit `forRoot(...)` / `forRootAsync(...)`, typed exported tokens, and normal module visibility/global rules. They do not publish the manuscript's stronger claims about `defineModule()` returning the same class reference, `defineModuleMetadata()` partial-merge behavior, subclass-per-registration identity, no wrapper-object protocol, module-instance isolation guarantees, or class-identity-driven graph semantics strongly enough for a dual-citation contradiction or clearance verdict.
- `Package-specific async-factory, named-registration, alias-surface, and authoring-checklist details outrun the current docs set`
  - Book: `book/advanced/ch07-dynamic-modules.ko.md:72-118`, `book/advanced/ch07-dynamic-modules.ko.md:122-226`, `book/advanced/ch07-dynamic-modules.ko.md:228-270`
  - Docs: `docs/contracts/third-party-extension-contract.md:17`, `docs/contracts/third-party-extension-contract.md:43-48`; `docs/reference/package-chooser.md:48-50`, `docs/reference/package-chooser.md:67-71`; `docs/reference/package-surface.md:47-50`, `docs/reference/package-surface.md:53`; `docs/architecture/di-and-modules.md:14-20`, `docs/architecture/di-and-modules.md:54-56`; `docs/contracts/behavioral-contract-policy.md:9-14`
  - Rationale: The mapped English docs are strong enough to confirm explicit module entrypoints, memoized-or-normalized async options before downstream consumption, explicit token exports, global-module visibility rules, Redis named registrations, and the existence of email/queue/socket.io family surfaces. They remain too thin on the chapter's package-specific walkthroughs for Prisma/Redis/Queue/Email/Socket.IO/Passport internals, singleton promise-cache behavior, alias-based public-token layering, unique-class-per-`forRoot()` isolation, validation helper placement, meta-testing patterns, and wider authoring heuristics, so the safe disposition remains `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch08-module-graph.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/getting-started/bootstrap-paths.md`, `docs/architecture/lifecycle-and-shutdown.md`, `docs/architecture/di-and-modules.md`, `docs/architecture/architecture-overview.md`, `docs/reference/glossary-and-mental-model.md`, `docs/contracts/behavioral-contract-policy.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Compiled-module record shape and DFS compiler internals exceed the published bootstrap contract`
  - Book: `book/advanced/ch08-module-graph.ko.md:21-97`, `book/advanced/ch08-module-graph.ko.md:210-213`
  - Docs: `docs/getting-started/bootstrap-paths.md:7-14`, `docs/getting-started/bootstrap-paths.md:44-52`; `docs/reference/glossary-and-mental-model.md:14-15`, `docs/reference/glossary-and-mental-model.md:27`, `docs/reference/glossary-and-mental-model.md:46-49`; `docs/architecture/architecture-overview.md:18-20`
  - Rationale: The frozen English docs explicitly state that bootstrap compiles the reachable module graph before runtime-token registration, lifecycle resolution, and dispatcher creation, and that circular imports fail as `ModuleGraphError`. They do not publish the manuscript's `CompiledModule[]` record shape, `providerTokens` / `exportedTokens` precomputation, `compiled`/`visiting`/`ordered` collections, post-order DFS replay model, `normalizeModuleDefinition()` details, or compiler-cache reuse rules strongly enough for contradiction-grade or clearance-grade adjudication.
- `Accessible-token formulas, duplicate-provider replay semantics, and deeper lifecycle-order guarantees outrun current English authority`
  - Book: `book/advanced/ch08-module-graph.ko.md:99-224`
  - Docs: `docs/architecture/di-and-modules.md:16-20`, `docs/architecture/di-and-modules.md:25-26`, `docs/architecture/di-and-modules.md:31-35`, `docs/architecture/di-and-modules.md:54-56`; `docs/getting-started/bootstrap-paths.md:8-13`, `docs/getting-started/bootstrap-paths.md:46-50`; `docs/architecture/lifecycle-and-shutdown.md:9-18`, `docs/architecture/lifecycle-and-shutdown.md:24-29`, `docs/architecture/lifecycle-and-shutdown.md:36-39`; `docs/contracts/behavioral-contract-policy.md:9-14`
  - Rationale: The mapped English docs clearly publish the visibility/export contract, `ModuleVisibilityError`, `ModuleInjectionMetadataError`, duplicate-provider governance with default `warn`, eager lifecycle-instance resolution, the global `onModuleInit()`-then-`onApplicationBootstrap()` barrier, and reverse shutdown ordering. They do not publish the chapter's exact accessible-token union formula, `createExportedTokenSet()` legality algorithm, last-write-wins replay semantics for duplicate selection, middleware registration layering, depth-first lifecycle dependency guarantees, or the multi-layer diagnostic matrix strongly enough to upgrade the chapter beyond fail-closed `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch09-app-context.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/getting-started/bootstrap-paths.md`, `docs/architecture/lifecycle-and-shutdown.md`, `docs/architecture/platform-consistency-design.md`, `docs/architecture/architecture-overview.md`, `docs/reference/glossary-and-mental-model.md`, `docs/reference/package-surface.md`, `docs/contracts/behavioral-contract-policy.md`, `docs/getting-started/migrate-from-nestjs.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=no_issues; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Application-context shell comparison extends beyond the published bootstrap and standalone-context contract`
  - Book: `book/advanced/ch09-app-context.ko.md:21-45`, `book/advanced/ch09-app-context.ko.md:47-77`
  - Docs: `docs/getting-started/bootstrap-paths.md:7-14`, `docs/getting-started/bootstrap-paths.md:28-33`; `docs/architecture/architecture-overview.md:19-22`; `docs/getting-started/migrate-from-nestjs.md:16-20`
  - Rationale: The frozen English docs clearly publish `FluoFactory.create(...)`, `FluoFactory.createApplicationContext(...)`, module compilation, runtime-token registration, lifecycle resolution, and the existence of a standalone application context. They do not publish the manuscript's stronger three-shell sibling model, the exact `Application` vs `ApplicationContext` vs `MicroserviceApplication` surface comparison, wrapper layering narrative, or public-type/source-tour details strongly enough for a contradiction-grade or clearance-grade decision.
- `Cleanup, readiness, and platform-shell internals outrun the current runtime authority set`
  - Book: `book/advanced/ch09-app-context.ko.md:79-157`
  - Docs: `docs/architecture/lifecycle-and-shutdown.md:9-18`, `docs/architecture/lifecycle-and-shutdown.md:24-44`; `docs/architecture/platform-consistency-design.md:11-15`, `docs/architecture/platform-consistency-design.md:21-29`, `docs/architecture/platform-consistency-design.md:33-39`; `docs/contracts/behavioral-contract-policy.md:5-14`
  - Rationale: The mapped English docs are explicit that runtime tokens register after compilation, `ready()` gates `listen()`, state transitions remain `bootstrapped`/`ready`/`closed`, shutdown runs cleanup callbacks then hooks then adapter close then container disposal, and platform-managed components report readiness and health through `PlatformShell`. They stay too thin on `closeRuntimeResources()` aggregation details, retryable close semantics, `closingPromise` memoization, `runBootstrapFailureCleanup()` preservation behavior, microservice wrapper invariants, and the detailed component-sorting/snapshot internals described in the manuscript, so fail-closed `insufficient_ssot` remains required.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch10-runtime-branching.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/getting-started/bootstrap-paths.md`, `docs/architecture/platform-consistency-design.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/lifecycle-and-shutdown.md`, `docs/reference/package-surface.md`, `docs/reference/glossary-and-mental-model.md`, `docs/contracts/behavioral-contract-policy.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Runtime branching narrative exceeds the published package-surface and platform-adapter contract`
  - Book: `book/advanced/ch10-runtime-branching.ko.md:21-72`
  - Docs: `docs/architecture/architecture-overview.md:9-11`, `docs/architecture/architecture-overview.md:20-22`, `docs/architecture/architecture-overview.md:35-40`, `docs/architecture/architecture-overview.md:48-49`; `docs/reference/package-surface.md:19-29`, `docs/reference/package-surface.md:36-40`, `docs/reference/package-surface.md:58`; `docs/reference/glossary-and-mental-model.md:23-27`, `docs/reference/glossary-and-mental-model.md:37-40`
  - Rationale: The frozen English docs clearly publish the adapter-first runtime model, the transport/core boundary, `@fluojs/runtime` bootstrap ownership, and the canonical platform package matrix. They do not document the manuscript's stronger export-map topology claims about root barrel exclusions, `./web` or `./internal` subpath curation, or the claim that package topology itself is a governed runtime contract strongly enough for a dual-citation contradiction or `no_issues` outcome.
- `Node-vs-Web branching helpers and shared request/response factory internals outrun current English authority`
  - Book: `book/advanced/ch10-runtime-branching.ko.md:74-169`
  - Docs: `docs/getting-started/bootstrap-paths.md:21-24`, `docs/getting-started/bootstrap-paths.md:28-32`, `docs/getting-started/bootstrap-paths.md:37-42`; `docs/architecture/platform-consistency-design.md:11-15`, `docs/architecture/platform-consistency-design.md:21-39`; `docs/architecture/lifecycle-and-shutdown.md:40-44`
  - Rationale: The mapped English docs are explicit that `packages/runtime/src/node.ts` is the Node-specific public subpath, adapters bind requests through `listen(dispatcher)` and close transport resources, Node-hosted shutdown helpers cover `SIGINT`/`SIGTERM`, and platform packages must preserve runtime phase order. They remain too silent on `createNodeHttpAdapter()`, `bootstrapNodeApplication()`, `runNodeApplication()`, `dispatchWebRequest()`, `createWebRequestResponseFactory()`, shared request/response factory interfaces, retry/drain/compression helpers, and Edge-via-Web seam details, so the manuscript's deeper source-tour walkthrough must stay `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch11-request-pipeline.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/architecture/http-runtime.md`, `docs/architecture/error-responses.md`, `docs/architecture/architecture-overview.md`, `docs/reference/glossary-and-mental-model.md`, `docs/architecture/observability.md`, `docs/contracts/behavioral-contract-policy.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Dispatcher phase walkthrough goes deeper than the published HTTP request lifecycle contract`
  - Book: `book/advanced/ch11-request-pipeline.ko.md:21-120`, `book/advanced/ch11-request-pipeline.ko.md:186-212`, `book/advanced/ch11-request-pipeline.ko.md:219-240`
  - Docs: `docs/architecture/http-runtime.md:7-23`, `docs/architecture/http-runtime.md:37-46`; `docs/reference/glossary-and-mental-model.md:16-22`; `docs/architecture/error-responses.md:64-82`
  - Rationale: The frozen English docs clearly publish the request phase order from normalized request/response through middleware, route matching, guards, interceptor composition, DTO binding/validation, handler execution, success writing, error normalization, and guaranteed request-container disposal. They do not publish the manuscript's exact 10-step breakdown, `DispatchPhaseContext` structure, observer-resolution helper flow, finalize-request helper shape, or the stronger source-tour claims around per-phase state sharing strongly enough to clear or contradict those details at dual-citation grade.
- `ALS, observer fault tolerance, WeakMap caching, and zero-leak performance claims exceed the current authority surface`
  - Book: `book/advanced/ch11-request-pipeline.ko.md:77-95`, `book/advanced/ch11-request-pipeline.ko.md:96-120`, `book/advanced/ch11-request-pipeline.ko.md:122-184`, `book/advanced/ch11-request-pipeline.ko.md:213-242`
  - Docs: `docs/reference/glossary-and-mental-model.md:22`; `docs/architecture/observability.md:49-51`; `docs/architecture/http-runtime.md:10-23`, `docs/architecture/http-runtime.md:43-46`; `docs/architecture/error-responses.md:76-82`; `docs/contracts/behavioral-contract-policy.md:5-14`
  - Rationale: The mapped English docs confirm only that `RequestContext` is the per-request runtime object, request correlation data is available through `RequestContext` and AsyncLocalStorage helpers, the dispatcher always emits `onRequestFinish` and disposes the request-scoped container, middleware may commit early, and normalized error handling preserves response-commit guards and request correlation. They stay too thin on automatic distributed-tracing/logging claims, observer fault-tolerance guarantees, repeated abort checkpoints, `WeakMap` route-metadata caching, latency/throughput claims, temp-file or open-stream cleanup, and the manuscript's stronger zero-leak language, so the safe final disposition remains `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch12-execution-chain.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/architecture/http-runtime.md`, `docs/architecture/error-responses.md`, `docs/architecture/security-middleware.md`, `docs/reference/glossary-and-mental-model.md`, `docs/architecture/observability.md`, `docs/contracts/behavioral-contract-policy.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Execution-chain layering and onion/proxy walkthrough exceed the published HTTP runtime contract`
  - Book: `book/advanced/ch12-execution-chain.ko.md:21-33`, `book/advanced/ch12-execution-chain.ko.md:52-72`, `book/advanced/ch12-execution-chain.ko.md:76-103`, `book/advanced/ch12-execution-chain.ko.md:172-183`
  - Docs: `docs/architecture/http-runtime.md:9-21`, `docs/architecture/http-runtime.md:37-46`; `docs/architecture/security-middleware.md:40-55`; `docs/reference/glossary-and-mental-model.md:16-22`
  - Rationale: The frozen English docs clearly publish the dispatcher phase order, the middleware-versus-guard-versus-interceptor boundary, and the fact that middleware runs before matching or before guards depending on scope. They do not document the manuscript's deeper `reduceRight` onion composition, proxy-style interceptor construction details, exact request/response unwinding narrative, or source-tour level chain-building helpers strongly enough for a contradiction-grade or clearance-grade decision.
- `Exception-chain, stack-trace, and controller-invocation internals outrun the current error/runtime authority`
  - Book: `book/advanced/ch12-execution-chain.ko.md:104-166`, `book/advanced/ch12-execution-chain.ko.md:185-202`
  - Docs: `docs/architecture/http-runtime.md:18-22`; `docs/architecture/error-responses.md:9-18`, `docs/architecture/error-responses.md:40-46`, `docs/architecture/error-responses.md:64-89`; `docs/architecture/observability.md:46-51`
  - Rationale: The mapped English docs confirm only the high-level handler invocation boundary, `onError` or `writeErrorResponse(...)` fallback, the serialized `ErrorResponse` shape, request correlation, and binding or validation failures becoming `BadRequestException`. They stay too thin on `FluoError` cause-preservation guidance, interceptor-local domain-error remapping as a taught pattern, stack-trace preservation claims, and the manuscript's concept-level `context.container.resolve(...)` plus binder walkthrough, so fail-closed `insufficient_ssot` remains required.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch13-custom-adapter.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/architecture/platform-consistency-design.md`, `docs/contracts/third-party-extension-contract.md`, `docs/getting-started/bootstrap-paths.md`, `docs/architecture/http-runtime.md`, `docs/architecture/architecture-overview.md`, `docs/reference/package-surface.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Adapter portability narrative and host-specific lifecycle walkthrough exceed the published platform contract`
  - Book: `book/advanced/ch13-custom-adapter.ko.md:21-27`, `book/advanced/ch13-custom-adapter.ko.md:121-126`, `book/advanced/ch13-custom-adapter.ko.md:167-173`
  - Docs: `docs/architecture/platform-consistency-design.md:5-15`, `docs/architecture/platform-consistency-design.md:21-24`, `docs/architecture/platform-consistency-design.md:33-39`; `docs/contracts/third-party-extension-contract.md:13-16`, `docs/contracts/third-party-extension-contract.md:24-25`; `docs/reference/package-surface.md:19-29`, `docs/reference/package-surface.md:38-40`
  - Rationale: The frozen English docs are explicit that official platform packages implement the adapter seam through `HttpApplicationAdapter`, normalize host-native request and response objects, preserve HTTP phase ordering, and expose optional realtime capability in the documented union shape. They do not publish the manuscript's stronger portability promise of moving between Fastify, Bun, and Lambda-style environments with zero code changes, per-environment lifecycle narratives, adapter-level fatal-error fallback behavior, or HTTP/3 and QUIC evolution guidance strongly enough for a dual-citation contradiction or clearance verdict.
- `Fastify, No-op, and tiny-node adapter examples outrun the frozen docs set`
  - Book: `book/advanced/ch13-custom-adapter.ko.md:29-77`, `book/advanced/ch13-custom-adapter.ko.md:78-119`, `book/advanced/ch13-custom-adapter.ko.md:148-165`, `book/advanced/ch13-custom-adapter.ko.md:175-258`
  - Docs: `docs/architecture/platform-consistency-design.md:12-24`, `docs/architecture/platform-consistency-design.md:33-36`; `docs/getting-started/bootstrap-paths.md:22-32`; `docs/architecture/http-runtime.md:9-10`; `docs/contracts/third-party-extension-contract.md:14-15`, `docs/contracts/third-party-extension-contract.md:47-48`
  - Rationale: The mapped English docs confirm the required `listen(dispatcher)` and `close(signal?)` methods, `FrameworkRequest` and `FrameworkResponse` normalization, adapter registration through `FluoFactory.create(rootModule, { adapter })`, and the existence of Fastify and Cloudflare Workers public helper entrypoints. They do not document the manuscript's conceptual `all('*')` Fastify binding, `createNoopHttpApplicationAdapter()` helper, exact request-field mapping example including `signal`, binder customization guidance, or the full tiny-node adapter skeleton strongly enough to accept or reject those concrete teaching surfaces.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch14-portability-testing.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/contracts/testing-guide.md`, `docs/contracts/platform-conformance-authoring-checklist.md`, `docs/contracts/behavioral-contract-policy.md`, `docs/architecture/platform-consistency-design.md`, `docs/reference/package-surface.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Portability and conformance taxonomy plus edge-case matrix exceed the published testing contract`
  - Book: `book/advanced/ch14-portability-testing.ko.md:21-39`, `book/advanced/ch14-portability-testing.ko.md:60-103`, `book/advanced/ch14-portability-testing.ko.md:176-201`, `book/advanced/ch14-portability-testing.ko.md:240-246`
  - Docs: `docs/contracts/testing-guide.md:7-12`, `docs/contracts/testing-guide.md:29-34`; `docs/contracts/platform-conformance-authoring-checklist.md:15-36`; `docs/contracts/behavioral-contract-policy.md:9-14`
  - Rationale: The frozen English docs are clear that runtime or adapter changes must keep conformance or portability coverage through the `@fluojs/testing` harness subpaths, and the platform checklist explicitly requires malformed-cookie preservation, raw-body rules, SSE support, HTTPS/startup logging, shutdown-listener cleanup, and fetch-style websocket conformance. They do not publish the manuscript's broader semantic-invariants framing, Hono comparison, cold-start or backpressure narratives, or the extended essay about framework-wide portability philosophy strongly enough for contradiction-grade or no-issues adjudication.
- `Concrete harness APIs, library-author harnesses, and custom-adapter exercise methods outrun the frozen authority set`
  - Book: `book/advanced/ch14-portability-testing.ko.md:40-58`, `book/advanced/ch14-portability-testing.ko.md:123-170`, `book/advanced/ch14-portability-testing.ko.md:203-230`
  - Docs: `docs/contracts/testing-guide.md:9-12`, `docs/contracts/testing-guide.md:29-34`; `docs/contracts/platform-conformance-authoring-checklist.md:15-23`, `docs/contracts/platform-conformance-authoring-checklist.md:27-36`; `docs/architecture/platform-consistency-design.md:33-39`
  - Rationale: The mapped English docs name the public harness subpaths and the required conformance checks, but they do not document `HttpAdapterPortabilityHarnessOptions`, the specific `bootstrap`/`run` option interface shown in the chapter, assertion method names such as `assertPreservesMalformedCookieValues()` or `assertSupportsSseStreaming()`, `BaseLibraryConformanceHarness`, `runPipeConformance(...)`, or the exact adapter-author usage patterns strongly enough to support a dual-citation contradiction or clearance decision.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch15-studio.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/reference/toolchain-contract-matrix.md`, `docs/reference/package-surface.md`, `docs/architecture/platform-consistency-design.md`, `docs/architecture/lifecycle-and-shutdown.md`, `docs/architecture/observability.md`, `docs/contracts/platform-conformance-authoring-checklist.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Studio ecosystem and snapshot-schema walkthrough exceed the published tooling contract`
  - Book: `book/advanced/ch15-studio.ko.md:22-90`
  - Docs: `docs/reference/toolchain-contract-matrix.md:17-25`; `docs/reference/package-surface.md:17`; `docs/architecture/platform-consistency-design.md:15`, `docs/architecture/platform-consistency-design.md:27-29`, `docs/architecture/platform-consistency-design.md:37-39`; `docs/architecture/lifecycle-and-shutdown.md:14-16`
  - Rationale: The frozen English docs confirm that `fluo inspect` is the diagnostics surface that exports runtime graph and timing data in JSON, that `@fluojs/studio` belongs to the tooling family, that platform-managed components report readiness, health, and snapshot data through `PlatformShell`, and that timing diagnostics expose stable phase names. They do not publish the manuscript's stronger producer/contracts/viewer ecosystem split, the exact `PlatformShellSnapshot` interface shape, or the detailed `PlatformDiagnosticIssue` field set beyond stable codes, severity, component identity, and optional fix hints, so the chapter must remain fail-closed as `insufficient_ssot`.
- `Viewer features, programmatic Studio APIs, Mermaid export, and live-Studio roadmap outrun current English docs`
  - Book: `book/advanced/ch15-studio.ko.md:91-215`, `book/advanced/ch15-studio.ko.md:225-237`
  - Docs: `docs/reference/toolchain-contract-matrix.md:19-25`; `docs/architecture/platform-consistency-design.md:37-39`; `docs/contracts/platform-conformance-authoring-checklist.md:20-23`, `docs/contracts/platform-conformance-authoring-checklist.md:43-45`; `docs/architecture/observability.md:50-51`; `docs/architecture/lifecycle-and-shutdown.md:14-16`
  - Rationale: The mapped English docs are explicit only about JSON diagnostics export, deterministic snapshot semantics, stable diagnostic codes plus `fixHint`, sanitized snapshots, and the existence of bootstrap timing phases. They stay silent on drag-and-drop viewer UX, snapshot history management, `parseStudioPayload`, `applyFilters`, `renderMermaid`, memory visualization, architecture-guard workflows, and live diagnostics socket or collaboration roadmap claims, so those deeper teaching surfaces cannot be adjudicated beyond `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch16-custom-package.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/package-folder-structure.md`, `docs/reference/glossary-and-mental-model.md`, `docs/contracts/manifest-decision.md`, `docs/contracts/third-party-extension-contract.md`, `docs/contracts/public-export-tsdoc-baseline.md`, `docs/architecture/di-and-modules.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Custom package layout and dependency guidance extend beyond the published package authoring contract`
  - Book: `book/advanced/ch16-custom-package.ko.md:21-50`, `book/advanced/ch16-custom-package.ko.md:188-208`
  - Docs: `docs/reference/package-folder-structure.md:5-24`, `docs/reference/package-folder-structure.md:27-62`; `docs/reference/package-surface.md:32-37`, `docs/reference/package-surface.md:57-60`; `docs/contracts/manifest-decision.md:19-45`; `docs/contracts/third-party-extension-contract.md:17-18`, `docs/contracts/third-party-extension-contract.md:27-29`, `docs/contracts/third-party-extension-contract.md:43-48`; `docs/contracts/public-export-tsdoc-baseline.md:5-22`
  - Rationale: The frozen English docs clearly document the public `exports` map, `dist`-only manifest targets, canonical `src/index.ts` / `src/module.ts` / `src/tokens.ts` / `src/internal/` layout roles, explicit module entrypoints, typed token export expectations, and the TSDoc baseline for governed public exports. They do not publish the chapter's stronger authoring guidance that `module.ts` should be isolated to avoid framework-metadata imports for utility consumers, that `@fluojs/core` and `@fluojs/di` should always be `peerDependencies`, that `@fluojs/runtime` is needed only for manual bootstrap or graph surgery, or the token-conflict rationale around multiple DI engine instances strongly enough for a contradiction-grade or clearance-grade decision.
- `Feature-flags DynamicModule walkthrough and helper-level package patterns outrun the frozen docs set`
  - Book: `book/advanced/ch16-custom-package.ko.md:52-186`, `book/advanced/ch16-custom-package.ko.md:198-205`
  - Docs: `docs/reference/glossary-and-mental-model.md:11-15`, `docs/reference/glossary-and-mental-model.md:24`, `docs/reference/glossary-and-mental-model.md:29-31`; `docs/contracts/third-party-extension-contract.md:17-18`, `docs/contracts/third-party-extension-contract.md:39-48`; `docs/architecture/di-and-modules.md:7-20`, `docs/architecture/di-and-modules.md:24-34`, `docs/architecture/di-and-modules.md:53-56`; `docs/CONTEXT.md:13-16`
  - Rationale: The mapped English docs are explicit that configurable modules use `forRoot(...)` and `forRootAsync(...)`, exported options and tokens must stay typed and explicit, third-party metadata keys should use namespaced `Symbol.for(...)`, module visibility flows through explicit `imports` and `exports`, and `forwardRef(...)` covers declaration-time cycles. They remain too thin on the manuscript's exact `DynamicModule` interface presentation, `AsyncModuleOptions` strategy surface, the complete feature-flags service/module example, the recommendation to use `forwardRef()` in both `imports` and `inject` arrays as a package-design rule, and the claim that explicit `exports` improve Studio graph visualization, so the safe adjudicated outcome remains `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/advanced/ch17-contributing.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/CONTEXT.md`, `docs/contracts/behavioral-contract-policy.md`, `docs/contracts/release-governance.md`, `docs/contracts/testing-guide.md`, `docs/contracts/public-export-tsdoc-baseline.md`, `docs/contracts/platform-conformance-authoring-checklist.md`, `docs/contracts/deployment.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Contributor intake, label taxonomy, and RFC-governance workflow exceed the published docs authority`
  - Book: `book/advanced/ch17-contributing.ko.md:22-63`, `book/advanced/ch17-contributing.ko.md:110-149`
  - Docs: `docs/CONTEXT.md:47-53`, `docs/CONTEXT.md:57-63`; `docs/contracts/behavioral-contract-policy.md:5-14`, `docs/contracts/behavioral-contract-policy.md:21-39`; `docs/contracts/release-governance.md:5-39`; `docs/contracts/public-export-tsdoc-baseline.md:5-29`; `docs/contracts/platform-conformance-authoring-checklist.md:47-53`
  - Rationale: The frozen English docs confirm the standard-first identity, behavioral-contract preservation rule, release tiers and semver gates, TSDoc baseline, and PR evidence expectations for governed platform changes. They do not publish the chapter's stronger contribution-process claims about blank issues being disabled, the exact Bug/Feature/Documentation/DX intake taxonomy, label names such as `priority:p0` or `status:needs-repro`, Discussions routing as a binding issue policy, the five-step RFC lifecycle with proposal locations and approval counts, or recurring maintenance/community programs strongly enough to support a dual-citation contradiction or safe `no_issues` verdict.
- `Verification loop, local setup details, and community-process internals outrun the frozen governance docs`
  - Book: `book/advanced/ch17-contributing.ko.md:68-108`, `book/advanced/ch17-contributing.ko.md:151-241`
  - Docs: `docs/contracts/testing-guide.md:5-34`; `docs/contracts/deployment.md:5-15`; `docs/contracts/behavioral-contract-policy.md:55-70`; `docs/contracts/release-governance.md:31-39`, `docs/contracts/release-governance.md:83-106`; `docs/contracts/platform-conformance-authoring-checklist.md:13-23`, `docs/contracts/platform-conformance-authoring-checklist.md:47-53`
  - Rationale: The mapped English docs are explicit that contributors must keep build, typecheck, test, release-readiness, governed-doc parity, and conformance evidence aligned with documented contract changes. They stay too silent on the manuscript's Node.js 18 prerequisite, `pnpm verify` sub-step details such as Prettier or 100% coverage expectations, CJS/ESM/UMD build-target discussion, dependency-audit claims, git worktree recommendations, changesets or Version Packages PR mechanics, security email flow, mentoring/events/community programs, benchmark suite guidance, or extra docs paths like `docs/style-guide.md`, `docs/roadmap/`, and `docs/CONTRIBUTING_GUIDELINES_EXTENDED.md`, so fail-closed `insufficient_ssot` remains the only evidence-safe disposition.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`
