# Platform Consistency Contract

<p><strong><kbd>English</kbd></strong> <a href="./platform-consistency-design.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current platform adapter contract used by fluo transport packages. Repository guidance names this policy seam `PlatformAdapter`, while the current transport-facing code exposes `HttpApplicationAdapter` in `@fluojs/http` and platform component orchestration through `PlatformShell` in `@fluojs/runtime`.

## Platform Adapter Seam

| Contract area | Current source | Requirement |
| --- | --- | --- |
| Package identity | `docs/reference/package-surface.md` reserves `@fluojs/platform-*` for adapters implementing the documented adapter seam. | Platform packages MUST provide the runtime-facing adapter seam for one hosting environment or protocol. |
| HTTP transport seam | `packages/http/src/adapter.ts` defines `HttpApplicationAdapter`. | An adapter MUST bind the dispatcher to the host transport through `listen(dispatcher)` and release transport resources through `close(signal?)`. |
| Request contract | `packages/http/src/types.ts` defines `FrameworkRequest` and `FrameworkResponse`. | An adapter MUST normalize host-native request and response objects to the framework contracts before dispatch. |
| Runtime shell integration | `packages/runtime/src/bootstrap.ts` registers `HTTP_APPLICATION_ADAPTER` and `PLATFORM_SHELL`. | An adapter MUST participate in runtime bootstrap without changing module compilation, lifecycle hook order, or dispatcher creation order. |
| Platform component orchestration | `packages/runtime/src/platform-contract.ts` and `packages/runtime/src/platform-shell.ts` define `PlatformComponent` and `PlatformShell`. | Platform-owned components SHOULD report validation, readiness, health, snapshot, and shutdown state through the platform shell contract. |

## Required Methods

| Method | Source contract | Required behavior |
| --- | --- | --- |
| `listen(dispatcher)` | `HttpApplicationAdapter.listen(dispatcher)` in `packages/http/src/adapter.ts` | MUST start the host listener and bind every incoming request to the provided dispatcher. |
| `close(signal?)` | `HttpApplicationAdapter.close(signal?)` in `packages/http/src/adapter.ts` | MUST stop the host listener and release transport resources during shutdown. |
| `getServer?()` | Optional method in `packages/http/src/adapter.ts` | MAY expose the transport-native server object when the host runtime provides one. |
| `getRealtimeCapability?()` | Optional method in `packages/http/src/adapter.ts` | MAY describe server-backed, fetch-style, or unsupported realtime capability through the documented adapter capability union. |
| `start()` | `PlatformShell.start()` and `PlatformComponent.start()` in `packages/runtime/src/platform-contract.ts` | Platform-managed components MUST start in dependency order when they are registered with the runtime platform shell. |
| `stop()` | `PlatformShell.stop()` and `PlatformComponent.stop()` in `packages/runtime/src/platform-contract.ts` | Platform-managed components MUST stop cleanly and support rollback or repeated shutdown calls without leaking owned resources. |
| `ready()` | `PlatformShell.ready()` and `PlatformComponent.ready()` in `packages/runtime/src/platform-contract.ts` | Platform-managed components MUST report `ready`, `not-ready`, or `degraded` with a stable reason for non-ready states. |
| `health()` | `PlatformShell.health()` and `PlatformComponent.health()` in `packages/runtime/src/platform-contract.ts` | Platform-managed components MUST report `healthy`, `unhealthy`, or `degraded` without hiding component failure. |
| `snapshot()` | `PlatformShell.snapshot()` and `PlatformComponent.snapshot()` in `packages/runtime/src/platform-contract.ts` | Platform-managed components MUST expose machine-readable state, ownership, telemetry tags, and dependency metadata. |

## Conformance Rules

- Platform packages MUST implement the adapter seam referenced by repository policy as `PlatformAdapter`, with the current HTTP transport contract supplied by `HttpApplicationAdapter`.
- Adapters MUST translate host-native request and response objects into `FrameworkRequest` and `FrameworkResponse` before calling the dispatcher.
- Adapters MUST preserve the HTTP runtime phase order defined by `@fluojs/http`, including middleware, route matching, guards, interceptors, binding, validation, handler execution, and response writing.
- Adapters MUST NOT redefine route syntax, DI resolution, configuration loading, or response status defaults that are owned by `@fluojs/http`, `@fluojs/di`, or `@fluojs/config`.
- Platform-managed components MUST use the `PlatformComponent` and `PlatformShell` contracts when they participate in validation, readiness, health, diagnostics, or shutdown orchestration.
- Platform diagnostics MUST use stable issue codes, severity, component identity, and optional fix hints as defined by `PlatformDiagnosticIssue`.
- Resource ownership MUST stay explicit. Components that create transport or infrastructure resources MUST stop them, and externally managed resources MUST NOT be closed as if the adapter owned them.
- Platform packages MUST NOT read `process.env` directly as a substitute for `@fluojs/config`.
- Platform packages MUST NOT require `experimentalDecorators` or `emitDecoratorMetadata`.
