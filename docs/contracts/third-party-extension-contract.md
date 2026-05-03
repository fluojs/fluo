# Third-Party Extension Contract

<p>
  <strong>English</strong> | <a href="./third-party-extension-contract.ko.md">한국어</a>
</p>

This document defines the contract for third-party adapters, integration packages, and extension modules that expose a fluo-facing runtime surface.

## Required Interface

| Extension surface | Current source contract | Required rule |
| --- | --- | --- |
| Official platform packages | `docs/reference/package-surface.md`, `docs/architecture/platform-consistency-design.md` | Packages published as `@fluojs/platform-*` MUST implement the repository policy seam named `PlatformAdapter`. In the current HTTP transport stack, that seam is satisfied through `HttpApplicationAdapter` from `@fluojs/http`. |
| HTTP listener adapters | `packages/http/src/adapter.ts` | Adapters MUST implement `listen(dispatcher)` and `close(signal?)`. `getServer?()` and `getRealtimeCapability?()` stay optional and must preserve the documented capability shapes when exposed. |
| Request and response mapping | `packages/http/src/adapter.ts`, `packages/http/src/types.ts`, `docs/architecture/platform-consistency-design.md` | Adapters MUST translate host-native input into `FrameworkRequest` and `FrameworkResponse`, then hand execution to the provided `Dispatcher` without changing request-phase ordering, response commit semantics, or streaming contracts. |
| Runtime-managed platform components | `packages/runtime/src/platform-contract.ts`, `packages/runtime/src/types.ts` | Extensions that register under `platform.components` MUST implement `PlatformComponent` with `validate()`, `start()`, `ready()`, `health()`, `snapshot()`, and `stop()`. Validation, readiness, health, and snapshot payloads must use the documented report shapes. |
| Module-style integrations | `packages/core/src/metadata.ts`, `packages/email/src/module.ts` | Packages that expose reusable registration APIs SHOULD publish explicit module entrypoints such as `forRoot(options)` and `forRootAsync({ inject, useFactory })`. Exported tokens and option objects MUST stay typed and explicit. |
| Decorator and metadata extensions | `packages/core/src/metadata/shared.ts`, `packages/http/src/decorators.ts` | Extensions that write metadata MUST use TC39 decorator context metadata plus namespaced `Symbol.for(...)` keys. Use the shared metadata symbol boundary from `@fluojs/core` rather than ad hoc globals. |

## Prohibited Patterns

- Extensions MUST NOT require `experimentalDecorators` or `emitDecoratorMetadata`.
- Package internals MUST NOT read `process.env` directly. Configuration must enter through explicit options, DI, or `@fluojs/config` at the application boundary.
- Adapters MUST NOT bypass `FrameworkRequest`, `FrameworkResponse`, or `Dispatcher` by coupling framework behavior to host-native request or response types.
- Extensions MUST NOT redefine route syntax, DI resolution rules, configuration loading rules, or lifecycle ordering that belong to `@fluojs/http`, `@fluojs/di`, `@fluojs/config`, or `@fluojs/runtime`.
- Metadata writers MUST NOT reuse fluo-owned keys such as `fluo.standard.*` or `fluo.metadata.*` for third-party state. Use package-scoped `Symbol.for('fluo.<package>.<purpose>')` keys.
- Public exports MUST NOT ship without TSDoc when the package is part of the governed public surface.
- Registration MUST NOT happen through import-time side effects. Callers must opt in through explicit bootstrap or module registration APIs.

## Versioning Obligations

- Public third-party packages that depend on documented fluo contracts MUST follow semantic versioning for their own published surface.
- Changes to module option shape, exported token names, adapter capability fields, lifecycle ordering, shutdown semantics, readiness behavior, or documented error behavior count as contract changes.
- In `0.x`, breaking contract changes may ship only in a minor release and must include consumer-facing upgrade requirements in `CHANGELOG.md`.
- In `1.0+`, breaking contract changes MUST ship in a major release.
- When an extension changes documented behavior, update implementation, tests, README content, and this contract-facing evidence together.
- If an extension targets the official publish surface or claims official platform compatibility, it must continue to satisfy the release and governance checks documented in `docs/contracts/release-governance.md` and `docs/contracts/behavioral-contract-policy.md`.

## Registration Protocol

| Registration concern | Required protocol |
| --- | --- |
| Static module configuration | Expose `forRoot(options)` when the extension has one explicit root-level configuration shape. Validate required inputs before providers are exported. |
| Async module configuration | Expose `forRootAsync({ inject, useFactory })` when configuration depends on DI or runtime lookups. Memoize or normalize the resolved options before downstream providers consume them. |
| Scoped or feature registration | Use `forFeature(...)` or `register(...)` only when the package has a distinct scoped contract. Do not duplicate `forRoot(...)` semantics under multiple names. |
| Token export | Export named symbols or typed tokens for extension-owned services and options. Follow the repo pattern of package-scoped `Symbol.for(...)` keys such as `fluo.email.options` or `fluo.queue.options`. |
| Runtime adapter registration | Register HTTP adapters through `FluoFactory.create(rootModule, { adapter })`. Register platform-owned infrastructure through `platform.components` when the extension participates in validation, readiness, health, diagnostics, or shutdown orchestration. |
| Provider exposure | Export only the services, channels, or tokens that callers are expected to consume. Keep container registration inside module factories or bootstrap options, not in top-level import evaluation. |
