<!-- packages: @fluojs/runtime, @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: T16 Part 3 source-analysis draft for application context shells, adapter contracts, and runtime lifecycle coordination -->

# Chapter 9. Application Context and Platform Adapter Contracts

이 장은 Fluo가 하나의 부트스트랩 spine 위에서 application context, full application, microservice shell을 어떻게 조립하는지 설명합니다. Chapter 8이 모듈 그래프와 초기화 순서를 확정했다면, 이 장은 그 결과물이 어떤 런타임 셸 계약으로 노출되는지 이어서 보여 줍니다.

## Learning Objectives
- `ApplicationContext`, `Application`, `MicroserviceApplication`이 공유하는 공통 부트스트랩 기반을 이해합니다.
- adapterless context와 full application의 차이를 런타임 토큰 관점에서 설명합니다.
- readiness, listen, shutdown contract가 어느 계층에서 책임지는지 분석합니다.
- cleanup과 재시도 가능한 close 동작이 런타임 무결성에 왜 중요한지 정리합니다.
- platform shell과 HTTP adapter가 서로 다른 호스트 가정을 어떻게 분리하는지 살펴봅니다.
- 고급 툴링이나 워커 프로세스에서 application context를 언제 선택할지 판단합니다.

## Prerequisites
- Chapter 8 완료.
- Fluo 라이프사이클 훅과 런타임 토큰 기본 이해.
- HTTP 어댑터와 DI 컨테이너 역할에 대한 기초 지식.

## 9.1 Fluo builds three runtime shells from one bootstrap spine
Fluo runtime internals를 오해하는 가장 쉬운 방법은 `Application`, `ApplicationContext`, `MicroserviceApplication`이 서로 전혀 다른 bootstrap path에서 나온다고 생각하는 것입니다. 실제 구현은 그렇지 않습니다.

세 shell 모두 `path:packages/runtime/src/bootstrap.ts` 안에서 조립됩니다. 그리고 더 아래쪽 bootstrap spine을 공유합니다. module graph compilation, container registration, runtime token registration, lifecycle singleton resolution, hook execution, platform-shell startup이 공통입니다.

`path:packages/runtime/src/types.ts:163-199`의 public type을 보면 닮은 점이 분명합니다. `ApplicationContext`는 `container`, `modules`, `rootModule`, `get()`, `close()`를 노출합니다. `Application`은 여기에 `state`, `dispatcher`, `listen()`, `ready()`, `connectMicroservice()`, `startAllMicroservices()`를 추가합니다. `MicroserviceApplication`은 context surface를 재사용하면서 `listen()`, `send()`, `emit()` 같은 transport method를 더합니다.

이것은 우연한 API 대칭이 아닙니다. 구현 순서의 반영입니다. Fluo는 먼저 transport-neutral한 DI/lifecycle baseline을 만든 뒤, 각 shell type이 약속한 capability만 래핑해 노출합니다.

source에서도 분기 지점이 직접 보입니다. `path:packages/runtime/src/bootstrap.ts:920-1029`의 `bootstrapApplication()`은 `new FluoApplication(...)`을 반환합니다. `path:packages/runtime/src/bootstrap.ts:1059-1153`의 `FluoFactory.createApplicationContext()`는 `new FluoApplicationContext(...)`를 반환합니다. `path:packages/runtime/src/bootstrap.ts:1164-1189`의 `FluoFactory.createMicroservice()`는 먼저 application context를 만든 다음, resolve된 runtime token을 `FluoMicroserviceApplication`으로 감쌉니다.

즉 bootstrap 구조는 완전히 별개인 세 경로가 아니라, 한 baseline 위에 올라가는 layered composition입니다. runtime은 context 전용 DI system이나 microservice 전용 lifecycle engine을 따로 유지하지 않습니다. 같은 core baseline 위에 다른 wrapper를 얹습니다.

구현 관점의 diagram은 다음과 같습니다.

```text
bootstrap graph + container + lifecycle baseline
  -> FluoApplicationContext  (DI-only shell)
  -> FluoApplication         (context + dispatcher + adapter state)
  -> FluoMicroserviceApplication (context + resolved transport runtime)
```

테스트도 이 공통 조상을 강화합니다. `path:packages/runtime/src/bootstrap.test.ts:522-629`는 context bootstrap을 검증하고, `path:packages/runtime/src/application.test.ts:175-235`는 full application lifecycle을 검증하며, `path:packages/runtime/src/bootstrap.test.ts:764-859`는 microservice wrapper path를 검증합니다.

이 공유 bootstrap spine이 이 장의 기반입니다. runtime contract의 나머지 부분을 이해하려면, 먼저 context, application, microservice shell이 하나의 compiled module/container baseline 위에서 만들어지는 형제라는 사실을 봐야 합니다.

## 9.2 Application context is the adapterless baseline and still runs full lifecycle bootstrap
`FluoApplicationContext`는 `path:packages/runtime/src/bootstrap.ts:531-575`에 정의되어 있습니다. 표면은 의도적으로 작습니다. `container`, `modules`, `rootModule`, optional bootstrap timing diagnostics, lifecycle instance, cleanup callback만 저장합니다.

public method도 `get()`과 `close()`뿐입니다. 이 미니멀한 표면이 핵심입니다. application context는 CLI task, worker, migration, 혹은 HTTP listener가 필요 없는 모든 DI-driven process를 위한 runtime baseline입니다.

실제 bootstrap path는 `path:packages/runtime/src/bootstrap.ts:1059-1153`의 `FluoFactory.createApplicationContext()`입니다. 이 함수를 `bootstrapApplication()`과 비교하면, 대부분의 순서가 동일합니다. 여전히 logger, platform shell, runtime provider list, compiled module, runtime context token, lifecycle instance, timing diagnostics를 만듭니다.

핵심 차이는 token registration입니다. full application에서는 `registerRuntimeBootstrapTokens()`가 `HTTP_APPLICATION_ADAPTER`와 `PLATFORM_SHELL`을 모두 추가합니다. context에서는 `registerRuntimeApplicationContextTokens()`가 `PLATFORM_SHELL`만 추가합니다.

이 차이는 테스트로 명시적으로 고정됩니다. `path:packages/runtime/src/bootstrap.test.ts:523-541`은 application service resolve는 성공하고, `context.get(HTTP_APPLICATION_ADAPTER)`는 `No provider registered`로 실패하며, `context.get(PLATFORM_SHELL)`은 성공해야 한다고 검증합니다.

여기서 중요한 점은 미묘합니다. application context는 "절반만 bootstrap된 상태"가 아닙니다. 자신이 약속한 capability에 대해서는 완전히 bootstrap된 상태입니다. 다만 adapter access를 약속하지 않을 뿐입니다.

lifecycle 동작도 완전합니다. 같은 테스트 파일의 `path:packages/runtime/src/bootstrap.test.ts:543-582`는 context bootstrap이 `onModuleInit()`와 `onApplicationBootstrap()`을 실행하고, 이후 `close()`가 `onModuleDestroy()`와 `onApplicationShutdown()`을 실행함을 보여 줍니다.

즉 context bootstrap은 dry-run mode가 아닙니다. lifecycle hook에 참여할 singleton provider를 eager하게 만들고, full application shell과 같은 runtime hook을 실제로 수행합니다.

timing diagnostics도 같은 패턴을 따릅니다. `path:packages/runtime/src/bootstrap.test.ts:584-610`은 기본적으로 `bootstrapTiming`이 없지만, `diagnostics.timing`을 켜면 사용할 수 있음을 보여 줍니다. runtime은 timing instrumentation을 HTTP app에만 제한하지 않습니다.

context bootstrap 흐름을 요약하면 다음과 같습니다.

```text
createApplicationContext(rootModule)
  -> bootstrapModule()
  -> register RUNTIME_CONTAINER + COMPILED_MODULES + PLATFORM_SHELL
  -> resolve singleton lifecycle instances
  -> run bootstrap hooks
  -> return DI-only shell with get() and close()
```

그래서 context API는 고급 툴링에서 특히 유용합니다. 같은 validated module graph, 같은 singleton state, 같은 shutdown semantics를 얻으면서도, DI에 접근하려고 HTTP adapter를 억지로 만들 필요가 없습니다.

## 9.3 Full applications add dispatcher state, readiness checks, and adapter-driven listen semantics
`FluoApplication`은 `path:packages/runtime/src/bootstrap.ts:403-529`에 정의되어 있습니다. context가 가지는 모든 것을 저장하면서, 추가로 `dispatcher`, adapter 존재 여부 상태, platform shell reference, connected microservice list, `ApplicationState`를 보관합니다.

`ApplicationState`는 `path:packages/runtime/src/types.ts:91-92`에 선언되어 있습니다. 허용 값은 `'bootstrapped'`, `'ready'`, `'closed'`입니다. 이 state는 HTTP 전용이 아닙니다. application과 microservice shell의 runtime lifecycle progression을 표현합니다.

가장 먼저 볼 계약은 `path:packages/runtime/src/bootstrap.ts:437-443`의 `ready()`입니다. 이 메서드는 `adapter.listen()`을 호출하지 않습니다. application이 이미 닫혀 있지 않은지만 확인한 뒤, `platformShell.assertCriticalReadiness()`에 위임합니다.

즉 Fluo에서 readiness는 "server socket이 bind되었다"의 동의어가 아닙니다. platform shell에 기반한 pre-listen gate입니다. critical platform component가 ready라고 보고해야만 transport startup이 허용됩니다.

`path:packages/runtime/src/bootstrap.ts:466-491`의 `listen()`은 그 readiness gate 위에 adapter behavior를 얹습니다. app이 closed면 throw하고, 이미 ready면 바로 return하며, adapter가 없으면 `options.adapter`를 제공하거나 `createApplicationContext()`를 쓰라는 invariant error를 던집니다.

이 정확한 에러 문자열은 `path:packages/runtime/src/application.test.ts:407-420`에서 검증됩니다. 이 테스트가 중요한 이유는, runtime이 adapterless application bootstrap 자체는 의도적으로 허용하면서도, adapter 없이 `listen()`하는 행위는 금지한다는 사실을 고정하기 때문입니다.

이 guard를 통과한 뒤에야 `listen()`은 `await this.ready()`를 호출하고, 그 다음 `await this.adapter.listen(this.dispatcher)`를 실행합니다. 성공하면 state를 `'ready'`로 바꾸고 startup log를 남깁니다. 즉 transport adapter가 application state transition을 단독으로 소유하지 않습니다. 더 큰 runtime shell policy의 일부로 참여합니다.

dispatcher 조립은 그보다 앞서 `path:packages/runtime/src/bootstrap.ts:890-910`의 `createRuntimeDispatcher()`에서 일어납니다. runtime은 compiled module controller로부터 handler mapping을 만들고, route mapping을 로그로 남기며, middleware, converters, interceptors, observers, optional exception filter로 dispatcher를 생성합니다.

이 사실이 application context와 full application의 진짜 분기점을 보여 줍니다. module bootstrap 자체가 아니라, request dispatch machinery를 만들 것인지, `listen()`을 노출할 것인지에서 갈라집니다.

`path:packages/runtime/src/application.test.ts:355-395`의 runtime token 테스트도 이를 구체화합니다. `RUNTIME_CONTAINER`, `COMPILED_MODULES`, `HTTP_APPLICATION_ADAPTER`를 주입받은 probe provider는, lifecycle hook 동안 live application container, compiled modules list, configured adapter를 실제로 관찰합니다.

따라서 application shell contract는 이렇게 요약할 수 있습니다.

```text
Application = ApplicationContext
  + dispatcher
  + HTTP adapter token registration
  + readiness gate
  + listen() state transition
  + microservice attachment helpers
```

source가 구현하는 모델도 정확히 이것입니다. application shell은 totally different bootstrap universe가 아니라, context baseline에 transport-facing capability를 더한 형태입니다.

## 9.4 Shutdown and failure cleanup are first-class runtime contracts, not afterthoughts
application context와 application shell은 모두 신중한 close semantics를 구현합니다. 이 부분은 runtime에서 특히 성숙한 설계 중 하나입니다.

공유 cleanup primitive는 `path:packages/runtime/src/bootstrap.ts:119-153`의 `closeRuntimeResources()`입니다. 순서는 명시적입니다. 먼저 runtime cleanup callback을 실행하고, 그 다음 shutdown hook, 그 다음 adapter가 있으면 adapter close, 마지막으로 container disposal을 수행합니다. 필요하면 에러를 누적한 뒤 하나로 다시 던집니다.

failure-path cleanup은 형제 helper인 `path:packages/runtime/src/bootstrap.ts:155-189`의 `runBootstrapFailureCleanup()`이 담당합니다. bootstrap이 일부 lifecycle instance나 resource를 만든 뒤 실패하더라도, runtime은 여전히 cleanup을 시도하고, cleanup failure는 로그로 남기면서, 원래의 bootstrap error는 보존합니다.

이것은 단순한 방어 코딩이 아닙니다. bootstrap이 multi-phase이기 때문에 반드시 필요한 rollback path입니다. provider resolution 이후, platform start 이후, 혹은 dispatcher creation 직전에도 실패가 가능하기 때문입니다.

테스트가 이 보장을 구체화합니다. `path:packages/runtime/src/application.test.ts:237-270`은 adapter shutdown failure 후에도 `close()`를 재시도할 수 있음을 증명합니다. `path:packages/runtime/src/application.test.ts:272-290`은 shutdown hook failure가 조용히 묻히지 않고 surface된다는 것을 보여 줍니다. `path:packages/runtime/src/application.test.ts:292-320`은 cleanup도 실패하더라도 original startup failure를 보존한다는 점을 검증합니다.

close idempotency도 의도적인 설계입니다. `FluoApplication.close()`와 `FluoApplicationContext.close()`는 모두 `closingPromise`를 memoize합니다. close가 이미 진행 중이면, 뒤늦은 호출자는 같은 promise를 기다립니다. close가 성공하면 이후 호출은 즉시 return합니다. close가 실패하면 promise를 비워 재시도를 허용합니다.

lifecycle hook ordering은 `path:packages/runtime/src/bootstrap.ts:710-722`의 `runShutdownHooks()`가 담당합니다. instance를 역순으로 순회하고, 먼저 `onModuleDestroy()`를 모두 실행한 뒤, 그 다음 `onApplicationShutdown(signal)`을 실행합니다. 가능한 한 startup dependency 방향을 거꾸로 되돌리는 ordering이라고 볼 수 있습니다.

context-only shell에도 같은 보장이 적용됩니다. `path:packages/runtime/src/bootstrap.test.ts:612-628`은 context shutdown failure가 `context.close()`를 통해 그대로 surface됨을 보여 줍니다.

cleanup flow는 다음과 같습니다.

```text
close()
  -> if already closed, return
  -> if closing in progress, await existing promise
  -> run cleanup callbacks
  -> run reverse-order shutdown hooks
  -> close adapter if present
  -> dispose container
  -> mark closed on success
  -> allow retry on failure
```

고급 사용자에게 이 설계가 중요한 이유는 runtime lifecycle이 startup convenience만 다루지 않기 때문입니다. Fluo는 resource retirement까지 runtime contract의 일부로 취급합니다.

## 9.5 The platform shell and adapter seams define what the runtime may assume about the host
이제 runtime bootstrap 안의 두 가지 다른 contract를 분리해서 볼 수 있습니다. 하나는 platform shell이고, 다른 하나는 HTTP adapter입니다. 둘은 상호작용하지만, 답하는 질문이 다릅니다.

platform-shell contract는 `path:packages/runtime/src/platform-contract.ts:151-160`에 정의되어 있습니다. `PlatformShell`은 `start()`, `stop()`, `ready()`, `health()`, `snapshot()`을 구현해야 합니다. 역할은 request adapter보다 더 넓은 인프라 component를 하나의 단위로 조율하는 것입니다.

구현체는 `path:packages/runtime/src/platform-shell.ts:137-465`의 `RuntimePlatformShell`입니다. 이 클래스는 component registration을 정규화하고, dependency identity를 검증하고, dependency order로 정렬하고, 그 순서대로 시작하고, 역순으로 정지하며, readiness와 health report를 집계합니다.

`path:packages/runtime/src/platform-shell.test.ts:94-219`의 테스트가 핵심 동작을 보여 줍니다. dependency order가 start에 반영되고, reverse order가 stop에 반영되며, unknown dependency id는 거부되고, aggregate snapshot은 readiness, health, component dependency, diagnostics를 함께 묶습니다.

이 platform shell은 `runBootstrapLifecycle()` 동안 시작되고, `FluoApplication.ready()`가 `listen()` 전에 다시 검사합니다. 즉 platform shell은 runtime의 host-readiness governor입니다.

adapter contract는 더 좁습니다. HTTP adapter는 request/response dispatch와 listen/close semantics에 집중하고, platform shell은 host component의 readiness와 health를 집계합니다. 이 분리 덕분에 runtime은 호스트별 세부 사항을 한 계층에 밀어 넣지 않고, application shell이 무엇을 가정해도 되는지 명확히 제한합니다.
