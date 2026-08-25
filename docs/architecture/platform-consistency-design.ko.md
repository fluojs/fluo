# Platform Consistency Contract

<p><a href="./platform-consistency-design.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 fluo transport 패키지가 사용하는 현재 플랫폼 어댑터 계약을 정의한다. 저장소 가이드는 이 정책 접점을 `PlatformAdapter`로 부르며, 현재 transport 중심 코드는 `@fluojs/http`의 `HttpApplicationAdapter`와 `@fluojs/runtime`의 `PlatformShell`로 이 계약을 노출한다.

## Platform Adapter Seam

| Contract area | Current source | Requirement |
| --- | --- | --- |
| Package identity | `docs/reference/package-surface.ko.md`는 `@fluojs/platform-*`를 문서화된 adapter seam을 구현하는 어댑터 전용으로 예약한다. | Platform 패키지는 하나의 hosting environment 또는 protocol을 위한 런타임 어댑터 접점을 제공해야 한다. |
| HTTP transport seam | `packages/http/src/adapter.ts`는 `HttpApplicationAdapter`를 정의한다. | 어댑터는 `listen(dispatcher)`로 dispatcher를 host transport에 연결하고, `close(signal?)`로 transport resource를 해제해야 한다. |
| Request contract | `packages/http/src/types.ts`는 `FrameworkRequest`와 `FrameworkResponse`를 정의한다. | 어댑터는 dispatch 전에 host-native request와 response를 framework contract로 정규화해야 한다. |
| Runtime shell integration | `packages/runtime/src/bootstrap.ts`는 `HTTP_APPLICATION_ADAPTER`와 `PLATFORM_SHELL`을 등록한다. | 어댑터는 module compilation, lifecycle hook 순서, dispatcher 생성 순서를 바꾸지 않고 runtime bootstrap에 참여해야 한다. |
| Platform component orchestration | `packages/runtime/src/platform-contract.ts`와 `packages/runtime/src/platform-shell.ts`는 `PlatformComponent`와 `PlatformShell`을 정의한다. | 플랫폼 소유 component는 validation, readiness, health, snapshot, shutdown 상태를 platform shell 계약으로 보고해야 한다. |

## Required Methods

| Method | Source contract | Required behavior |
| --- | --- | --- |
| `listen(dispatcher)` | `packages/http/src/adapter.ts`의 `HttpApplicationAdapter.listen(dispatcher)` | host listener를 시작하고 모든 incoming request를 제공된 dispatcher에 연결해야 한다. |
| `close(signal?)` | `packages/http/src/adapter.ts`의 `HttpApplicationAdapter.close(signal?)` | shutdown 동안 host listener를 멈추고 transport resource를 해제해야 한다. |
| `getServer?()` | `packages/http/src/adapter.ts`의 optional method | host runtime이 제공할 때 transport-native server object를 노출할 수 있다. |
| `getRealtimeCapability?()` | `packages/http/src/adapter.ts`의 optional method | 문서화된 adapter capability union을 통해 server-backed, fetch-style, unsupported realtime capability를 설명할 수 있다. Fetch-style version 1은 stable capability version을 바꾸지 않고 `listen()` 전에 realtime binding을 설치하는 별도 versioned optional `bindingInstallation` extension을 노출할 수 있다. |
| `start()` | `packages/runtime/src/platform-contract.ts`의 `PlatformShell.start()` 와 `PlatformComponent.start()` | runtime platform shell에 등록된 platform-managed component는 dependency 순서대로 시작되어야 한다. |
| `stop()` | `packages/runtime/src/platform-contract.ts`의 `PlatformShell.stop()` 와 `PlatformComponent.stop()` | platform-managed component는 소유 resource를 누수시키지 않고 clean shutdown과 rollback 경로를 지원해야 한다. |
| `ready()` | `packages/runtime/src/platform-contract.ts`의 `PlatformShell.ready()` 와 `PlatformComponent.ready()` | platform-managed component는 non-ready 상태에 대해 안정적인 reason과 함께 `ready`, `not-ready`, `degraded`를 보고해야 한다. |
| `health()` | `packages/runtime/src/platform-contract.ts`의 `PlatformShell.health()` 와 `PlatformComponent.health()` | platform-managed component는 component failure를 숨기지 않고 `healthy`, `unhealthy`, `degraded`를 보고해야 한다. |
| `snapshot()` | `packages/runtime/src/platform-contract.ts`의 `PlatformShell.snapshot()` 와 `PlatformComponent.snapshot()` | platform-managed component는 machine-readable state, ownership, telemetry tag, dependency metadata를 노출해야 한다. |

## Platform Shell Lifecycle Exclusivity

`RuntimePlatformShell.start()`와 `stop()`은 정확히 하나의 active lifecycle transition만 허용한다. 두 operation 중 하나가 active인 동안 겹치는 모든 `start()` 또는 `stop()` 호출은 root-exported `PlatformLifecycleConflictError`를 담은 즉시 reject된 promise를 반환해야 한다. Error code는 `PLATFORM_LIFECYCLE_CONFLICT`이며 `activeOperation`과 `requestedOperation`은 readonly field와 일치하는 structured metadata로 제공된다.

Shell은 겹치는 lifecycle work를 queue하면 안 된다. 또한 공유, coalesce, desired state 기록도 하면 안 된다. Runtime-neutral promise scheduling으로 component work 시작 전에 active transition을 publish하므로 synchronous callback reentry와 임의의 await 이후 reentry 모두 같은 conflict 계약을 관찰한다. Identity-checked cleanup은 성공 또는 실패 뒤 transition을 해제한다. Caller는 settlement 이후에만 명시적으로 retry할 수 있다. Private rollback과 cleanup path는 owning transition 내부에 남아 dependency ordering, diagnostics, rollback retry, sequential idempotency를 보존한다.

## Conformance Rules

- Platform 패키지는 저장소 정책이 `PlatformAdapter`라고 부르는 adapter seam을 구현해야 하며, 현재 HTTP transport 계약은 `HttpApplicationAdapter`가 담당한다.
- 어댑터는 dispatcher를 호출하기 전에 host-native request와 response를 `FrameworkRequest`와 `FrameworkResponse`로 변환해야 한다.
- 어댑터는 `@fluojs/http`가 정의한 phase 순서, 즉 middleware, route matching, guards, interceptors, binding, validation, handler execution, response writing 순서를 보존해야 한다.
- 어댑터는 `@fluojs/http`, `@fluojs/di`, `@fluojs/config`가 소유한 route syntax, DI resolution, configuration loading, response status default를 다시 정의하면 안 된다.
- 플랫폼 소유 component가 validation, readiness, health, diagnostics, shutdown orchestration에 참여할 때는 `PlatformComponent`와 `PlatformShell` 계약을 사용해야 한다.
- 플랫폼 진단 정보는 `PlatformDiagnosticIssue`가 정의한 stable issue code, severity, component identity, optional fix hint를 사용해야 한다.
- 리소스 소유권은 명시적이어야 한다. transport 또는 infrastructure resource를 생성한 component는 그것을 직접 중단해야 하며, 외부에서 관리되는 resource를 어댑터 소유처럼 닫으면 안 된다.
- Platform 패키지는 `@fluojs/config`를 우회하기 위해 `process.env`를 직접 읽으면 안 된다.
- Platform 패키지는 `experimentalDecorators` 또는 `emitDecoratorMetadata`를 요구하면 안 된다.
