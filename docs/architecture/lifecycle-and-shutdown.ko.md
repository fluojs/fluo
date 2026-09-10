# 라이프사이클 및 종료 보장

<p><a href="./lifecycle-and-shutdown.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 범위와 사전 조건

이 EN/KO 문서 쌍은 [문서 권위 정책](../contracts/documentation-authority.ko.md)에 따른 runtime lifecycle, 종료 admission, cleanup 재시도의 기준 Docs입니다. Book과 CONTEXT는 이 계약을 설명하고 연결하는 소비자입니다. 현재 checkout의 `@fluojs/runtime`과 DI, Node/Fastify 및 host-owned adapter 경계를 다룹니다. 배포된 모든 버전에서 검증했다는 뜻은 아닙니다. Terminus HTTP health/readiness 판정은 별도 [health 계약](../contracts/health-and-readiness.ko.md)의 범위입니다.

| 항목 | 전제와 공개 표면 |
| --- | --- |
| 실행 환경 | 아래 검증 명령은 의존성을 설치한 repository checkout에서 Node `>=24 <27`, `pnpm@10.4.1`을 사용합니다. 생성 앱은 registry 의존성과 생성된 scripts를 유지하고, `examples/fluo-blog` 같은 repository example은 workspace 의존성과 자체 빌드 전제를 따릅니다. 이 문서는 두 앱 디렉터리를 서로 덮어쓰는 recipe가 아닙니다. |
| 모듈과 DI | `@fluojs/runtime`의 `defineModule`, `FluoFactory`을 사용합니다. Root module과 provider를 등록하고, 모듈 간 의존성은 imports/exports로 공개해야 합니다. 생성자 의존성에는 `@fluojs/core`의 `Inject` 또는 provider의 명시적 `inject` 목록이 필요합니다. Decorator를 쓰면 module 평가 전에 `Symbol.metadata` 준비와 표준 decorator 변환이 필요합니다. [metadata 계약](./decorators-and-metadata.ko.md)을 따릅니다. |
| Lifecycle API | `@fluojs/runtime`에서 type으로 `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, `OnApplicationShutdown`, `Application`, `ApplicationContext`를 import합니다. 훅은 동기 `void` 또는 `Promise<void>`를 반환합니다. Interface 선언만으로 등록되지는 않습니다. Hook-bearing `useValue` 또는 적격 singleton class/factory provider가 lifecycle 대상이며, `useExisting` alias와 request/transient provider는 독립 startup hook 대상으로 root-resolve하지 않습니다. |
| HTTP 경로 | 각 platform의 concrete `AdapterClass.create(options)`와 `@fluojs/runtime`의 `FluoFactory.create(...)`, `app.listen()`을 사용합니다. Custom adapter는 `@fluojs/http/portable`의 `HttpApplicationAdapter`를 구현합니다. `src/` 경로는 구현 근거이지 consumer import가 아닙니다. |
| 외부 자원 | 순수 DI 예제에는 서버, 환경 파일, 외부 서비스가 필요하지 않습니다. DB·queue·socket·background job을 추가하면 해당 자원의 연결 설정, 오류 처리, drain, close 소유권도 애플리케이션이나 해당 package에 지정해야 합니다. |

## 입력, 기본값과 완료 시점

| API 또는 입력 | 기본값, 반환과 경계 |
| --- | --- |
| `FluoFactory.create(RootModule, options = {})` | Bootstrap과 HTTP dispatcher 생성 뒤 `Promise<Application>`으로 반환하며 초기 상태는 `bootstrapped`입니다. 생성 시 listen/signal 등록은 하지 않습니다. `logger`와 middleware 정책을 받고 선택적 `shutdownRegistration`은 listen 뒤 실행합니다. Adapterless shell의 `listen()`은 `InvariantError`로 reject하지만 shell은 보존합니다. |
| `FluoFactory.createApplicationContext(RootModule, options = {})` | DI와 lifecycle 초기화가 끝난 `Promise<ApplicationContext>`입니다. HTTP adapter/dispatcher/listener 및 공개 `state`, `ready()`, `listen()`은 없습니다. `get(token): Promise<T>`, `close(signal?): Promise<void>`를 사용합니다. |
| Bootstrap 옵션 | `providers`는 생략 시 추가 등록 없음, `duplicateProviderPolicy`는 `warn`이며 `throw`/`ignore`도 받습니다. `moduleGraphCache`와 `diagnostics.timing`은 기본 off입니다. Timing을 켜면 `bootstrapTiming`을 제공하며 context에는 `create_dispatcher` phase가 없습니다. |
| `app.ready()` | `Promise<void>`로 critical platform readiness를 검사할 뿐 adapter를 활성화하거나 `state`를 `ready`로 바꾸지 않습니다. HTTP health route를 자동 생성하지도 않습니다. 성공한 close 뒤에는 reject합니다. 종료 admission 판정에는 이 메서드나 `state` 대신 아래 operation gate 계약을 적용합니다. |
| `app.listen()` | `ready()` → `adapter.listen(dispatcher)` → 시작 로그 → 선택적 host signal 등록을 기다립니다. 동시 호출은 startup과 실패 cleanup을 공유합니다. Readiness/listen/setup 실패는 원래 오류를 보존하며 `close('bootstrap-failed')`를 호출합니다. 새 startup에는 새 앱이 필요합니다. |
| `AdapterClass.create(options)` | Transport를 구성하지만 listen이나 signal 등록을 시작하지 않습니다. [Factory recipe](../getting-started/bootstrap-paths.ko.md)로 application과 host callback을 조립합니다. |
| Node/Fastify shutdown options | 명시적인 `createNodeShutdownSignalRegistration()`은 기본 `SIGINT`/`SIGTERM`을 선택합니다. Callback을 생략하면 host가 signal을 소유합니다. `forceExitTimeoutMs = 30_000`은 signal 완료 bound이며 adapter `shutdownTimeoutMs = 10_000`과 별개입니다. Fastify는 setup 시 0 이상의 safe integer 종료 제한을 검증합니다. |
| `close(signal?)` | 생략한 signal은 `undefined`이며 runtime이 임의로 `SIGTERM`을 붙이지 않습니다. 진행 중 teardown을 공유하고 성공 뒤 반복 close는 no-op입니다. 실패 후 명시적 재시도는 아래 phase별 소유권을 따릅니다. |

## 시작 단계

| 순서 | 단계 | 런타임 사실 | 근거 소스 |
| --- | --- | --- | --- |
| 1 | 모듈 부트스트랩 | `FluoFactory.create(...)`은 어떤 라이프사이클 훅보다 먼저 모듈 그래프를 컴파일하고 DI 컨테이너를 생성합니다. | `packages/runtime/src/bootstrap.ts:FluoFactory.create()` |
| 2 | 런타임 토큰 등록 | 모듈 컴파일이 성공한 뒤 `HTTP_APPLICATION_ADAPTER`, `PLATFORM_SHELL`, `RUNTIME_CONTAINER`, `COMPILED_MODULES` 같은 런타임 토큰이 등록됩니다. | `packages/runtime/src/bootstrap.ts:registerRuntimeBootstrapTokens()`, `packages/runtime/src/bootstrap.ts:registerRuntimeApplicationContextTokens()` |
| 3 | 라이프사이클 인스턴스 해석 | 공개 라이프사이클 계약을 구현한 런타임 공급자와 모듈 공급자를 라이프사이클 실행 전에 해석합니다. 모든 적격 singleton `multi: true` contribution은 contribution 순서에 따른 별도 lifecycle instance로 유지되며, class/factory contribution은 request/transient sibling을 root에서 해석하지 않고 개별 해석됩니다. | `packages/runtime/src/bootstrap.ts:resolveLifecycleInstances()`, `packages/di/src/internal.ts:resolveMultiContribution()` |
| 4 | 부트스트랩 라이프사이클 | `runBootstrapHooks(...)`는 먼저 모든 해석된 라이프사이클 인스턴스의 `onModuleInit()`를 실행하고, 이어서 같은 인스턴스들의 `onApplicationBootstrap()`를 실행합니다. | `packages/runtime/src/bootstrap.ts:runBootstrapHooks()` |
| 5 | 플랫폼 시작 | `platformShell.start()`는 부트스트랩 훅이 완료된 뒤 실행됩니다. 이 단계가 성공하기 전까지 readiness 표시는 시작 중 상태에 머뭅니다. | `packages/runtime/src/bootstrap.ts:runBootstrapLifecycle()` |
| 6 | 디스패처 생성 | HTTP 디스패처는 부트스트랩 라이프사이클 경로가 끝난 뒤 생성됩니다. 타이밍 진단을 켜면 이 단계는 `create_dispatcher` phase로 노출됩니다. | `packages/runtime/src/bootstrap.ts:FluoFactory.create()`, `packages/runtime/src/health/diagnostics.ts` |

타이밍 진단을 `diagnostics.timing`으로 활성화하면 부트스트랩 phase 이름은 `bootstrap_module`, `register_runtime_tokens`, `resolve_lifecycle_instances`, `run_bootstrap_lifecycle`, `create_dispatcher`로 고정됩니다.

Bootstrap 실패 시 런타임은 확보한 lifecycle instance에 `bootstrap-failed` 신호로 실패 정리를 수행하고, 확보한 container의 해제를 시도하며, ready 애플리케이션을 반환하지 않습니다. 독립 provider 해석은 동시에 진행할 수 있지만 모두 settle된 뒤 선언 순서에 따라 훅을 실행합니다. 초기화 훅은 순차 await하며 실패하면 이후 startup 훅으로 진행하지 않습니다.

`platformShell.stop()`은 앞에 추가된 lifecycle instance의 `onModuleDestroy()`에 들어 있습니다. 따라서 사용자 instance의 역순 destroy 다음, `onApplicationShutdown()` pass 전에 실행됩니다. Context도 같은 bootstrap lifecycle을 따르지만 HTTP dispatcher 생성은 하지 않습니다.

## 상태 신호

| 신호 또는 상태 | 보장 | 근거 소스 |
| --- | --- | --- |
| 모듈 readiness 표시 | 부트스트랩 중 `markStarting()`과 `markReady()`를 노출하는 compiled module은 라이프사이클 훅 전에 starting으로 설정되고, `platformShell.start()`가 성공한 뒤에만 ready로 전환됩니다. shutdown은 cleanup callback과 lifecycle shutdown hook 실행 전에 이 표시를 starting으로 되돌립니다. | `packages/runtime/src/bootstrap.ts:resetReadinessState()`, `packages/runtime/src/bootstrap.ts:markReadinessState()`, `packages/runtime/src/bootstrap.ts:runBootstrapLifecycle()`, `packages/runtime/src/bootstrap.ts:closeRuntimeResources()` |
| 애플리케이션 상태 모델 | 공개 런타임 상태는 `bootstrapped`, `ready`, `closed`입니다. | `packages/runtime/src/types.ts:ApplicationState` |
| listen 이전 readiness 게이트 | `Application.listen()`은 `ready()`를 호출하고, `ready()`는 `platformShell.assertCriticalReadiness()`에 위임합니다. 이 검사가 통과하기 전에는 adapter의 listen을 호출하지 않습니다. | `packages/runtime/src/bootstrap.ts:FluoApplication.startListening()` |
| ready 전이 | `Application.listen()`은 `adapter.listen(this.dispatcher)`가 성공적으로 끝나고 shutdown이 시작되지 않았을 때만 애플리케이션 상태를 `ready`로 설정합니다. | `packages/runtime/src/bootstrap.ts:FluoApplication.startListening()` |
| closed 전이 | `Application.close()`는 teardown이 pending인 동안 기존 공개 상태를 유지하고 teardown이 성공적으로 완료된 뒤에만 `closed`로 설정합니다. Shutdown admission은 공개 상태와 별도로 추적합니다. | `packages/runtime/src/application.test.ts` (`keeps failed shutdown terminal while retrying only incomplete cleanup`) |

이 보장들은 bootstrap 완료, readiness 검사, adapter 활성화와 ingress를 구분합니다. Node/Fastify는 adapter 생성 시 server 객체를 만들고 listen 때 binding을 수행합니다. Next.js/Workers 같은 host-owned 경로의 listen은 dispatcher 연결이며 별도 socket 생성을 뜻하지 않습니다. `Application.dispatch()`는 shutdown 전에는 listen을 요구하지 않고, 공개 `app.dispatcher`와 adapter의 직접 진입점은 `Application.dispatch()` wrapper를 거치지 않습니다. 이들의 ingress/drain 정책은 각 adapter와 host가 소유합니다.

## 종료 보장

| 영역 | 보장 | 경계 |
| --- | --- | --- |
| 훅 순서 | `runShutdownHooks(...)`는 라이프사이클 인스턴스의 역순으로 `onModuleDestroy()`를 실행한 뒤, 다시 역순으로 `onApplicationShutdown(signal?)`를 실행합니다. | `packages/runtime/src/bootstrap.ts:runShutdownHooks()` |
| 종료 경로 순서 | Application과 context teardown은 readiness reset, 런타임 정리 콜백, 종료 훅, `adapter.close(signal)`, 컨테이너 해제 순서로 실행됩니다. 재시도는 완료된 runtime phase를 건너뛰고 incomplete adapter 또는 lifecycle-hook stage를 해당 stage의 retry contract에 따라 다시 실행합니다. Container disposal은 terminal best-effort입니다. Materialize된 container-managed `onDestroy()` hook을 모두 시도하고, 실패한 hook만 이후 명시적 close 재시도를 위해 유지하며, 성공한 hook은 다시 실행하지 않습니다. | `packages/runtime/src/bootstrap.ts`, `packages/runtime/src/retryable-shutdown.ts`, `packages/runtime/src/bootstrap.test.ts` (`retries only failed container-managed onDestroy hooks on a second application context close`) |
| 멱등 close 진입 | `Application.close()`와 `ApplicationContext.close()`는 진행 중인 closing promise를 재사용하며, 첫 번째 close가 성공한 뒤에는 즉시 반환합니다. Teardown이 실패하면 이후 close는 완료된 runtime phase를 건너뛰고 incomplete stage가 소유한 작업을 재개하되 adapter 또는 lifecycle-stage retry ownership은 변경하지 않습니다. 별도의 terminal operation gate는 shutdown 시작부터 provider resolution, application listen, child microservice connect/start를 거부하며, 이 거부는 teardown이 pending이거나 실패한 뒤에도 유지됩니다. | `packages/runtime/src/application.test.ts` (`rejects Application.get() as soon as shutdown starts while teardown is pending`), `packages/runtime/src/bootstrap.test.ts` (`rejects ApplicationContext.get() as soon as shutdown starts while teardown is pending`, `rejects connect and start operations while application close is pending`) |
| Direct dispatch admission | `Application.dispatch()`는 같은 동기 terminal operation gate를 사용합니다. Close 시작 뒤 dispatch는 HTTP dispatcher handoff 전에 reject되며 teardown이 pending인 동안, close가 실패한 뒤, 성공한 close 뒤에도 계속 거부됩니다. Shutdown 전에 admission된 dispatch는 dispatcher가 소유하며 admission gate가 취소하지 않습니다. | `packages/runtime/src/application.test.ts` (`rejects new dispatches during pending shutdown without interrupting an admitted dispatch`) |
| 부트스트랩 실패 정리 | 시작 도중 라이프사이클 인스턴스가 이미 생성된 뒤 실패하면, 런타임은 `bootstrap-failed` 신호로 같은 종료 훅을 실행하고 컨테이너 해제를 시도합니다. | `packages/runtime/src/bootstrap.ts:155-189` |
| Microservice ownership | `Application.connectMicroservice()`로 연결한 microservice는 해당 애플리케이션이 소유하는 child입니다. `startAllMicroservices()`는 뒤쪽 child 시작 실패 시 이미 시작된 child를 `bootstrap-failed`로 rollback하며, `Application.close(signal)`은 부모 runtime cleanup, lifecycle hook, adapter close, container dispose보다 먼저 연결된 microservice를 닫습니다. | `packages/runtime/src/bootstrap.ts` |
| Microservice ingress | Microservice close 시작은 terminal ingress gate를 동기적으로 설정합니다. 겹친 `listen()`이 settle되는 동안 새 facade `send()`, `emit()`, `serverStream()`, `clientStream()`, `bidiStream()` 호출은 transport handoff 전에 reject됩니다. Runtime shell은 같은 gate를 `send()`와 `emit()`에 적용하며, close 시도가 실패해도 ingress는 다시 열리지 않습니다. | `packages/runtime/src/bootstrap.ts`, `packages/microservices/src/service.ts` |
| NATS request callback | NATS request subscription callback은 async boundary에서 malformed frame과 response encoding 또는 `respond()` 실패를 격리하고, raw console fallback 없이 설정된 transport logger로 보고하며, caller-owned NATS client를 열린 상태로 유지합니다. Encoding 가능한 request-handler 실패는 계속 상관관계가 유지된 error response를 생성합니다. | `packages/microservices/src/transports/nats-transport.ts` |
| NATS transport close | NATS close는 실패가 발생해도 소유한 모든 subscription cleanup을 시도하고, 여러 실패를 `AggregateError`로 보고하며, 실패한 subscription만 이후 close 재시도를 위해 유지하고 cleanup이 끝나기 전에는 listen 재시작을 허용하지 않습니다. Caller-owned NATS client는 열린 상태를 유지합니다. | `packages/microservices/src/transports/nats-transport.ts` |
| TCP transport close | 동시에 또는 반복해서 호출된 `TcpMicroserviceTransport.close()`는 첫 shutdown promise를 재사용하므로 모든 caller가 같은 listener와 socket cleanup 결과를 관찰하고 중복 teardown을 시작하지 않습니다. | `packages/microservices/src/transports/tcp-transport.ts` |
| Event Bus drain | `@fluojs/event-bus`는 shutdown 시작 시 publish와 inbound callback admission을 닫은 뒤 하나의 absolute `shutdown.drainTimeoutMs` deadline 아래에서 live dispatch set을 quiescence까지 다시 확인합니다. 이전 snapshot 뒤에 이미 active인 publish가 등록한 handler 또는 transport 작업도 transport close 전 drain에 남습니다. | `packages/event-bus/src/service.ts` |
| Cron scheduler ownership | `@fluojs/cron`은 decorator로 발견한 cron task를 application bootstrap 중 시작하고, 이미 시작된 registry에 dynamic cron task가 추가되면 즉시 시작합니다. Shutdown에서는 handle을 stop하기 전에 tick admission을 닫아 이미 queue된 callback이 drain에 진입하지 못하게 합니다. Scheduler handle은 `stop()`이 성공한 뒤에만 지우며, 첫 shutdown hook에서 실패하면 다음 shutdown hook이 재시도할 수 있도록 handle을 유지합니다. Active task execution은 설정된 timeout 안에서 drain합니다. 같은 timeout은 shutdown 중 Redis owned-lock release I/O에도 적용됩니다. Post-task `finally` release와 즉시 이어지는 stopped-state retry는 shutdown 시작 시 설정된 deadline의 남은 시간만 사용하며, deadline 뒤의 task settlement는 새 release window를 열지 않습니다. 각 acquisition은 서로 다른 Redis lease token을 사용하므로 늦은 release가 같은 configured owner identity로 만든 새 lease를 삭제할 수 없습니다. Release 실패 또는 release I/O timeout 시 local ownership은 shutdown retry/reporting을 위해 유지되고, bounded shutdown timeout이 만료되면 아직 실행 중인 lock은 보존됩니다. | `packages/cron/src/service.ts`, `packages/cron/src/distributed-lock-manager.ts` |
| Node 신호 범위 | Node 기반 종료 등록은 기본적으로 `SIGINT`와 `SIGTERM`을 감시합니다. | `packages/platform-nodejs/src/node/internal-node-shutdown.ts:4-15` |
| 호스트 타임아웃 경계 | Node 신호 등록은 기본 강제 종료 타임아웃으로 `30_000` ms를 사용합니다. 타임아웃이 나면 실패를 로그로 남기고 `process.exitCode = 1`을 설정하지만, 호스트 프로세스를 직접 종료하지는 않습니다. | `packages/platform-nodejs/src/node/internal-node-shutdown.ts:6-15`, `packages/platform-nodejs/src/node/internal-node-shutdown.ts:77-109` |
| 어댑터 드레인 타임아웃 | Node HTTP 어댑터는 drain semantics로 서버를 종료하고, `shutdownTimeoutMs`가 지나면 남은 연결을 강제로 닫습니다. 어댑터 기본값은 `10_000` ms입니다. | `packages/platform-nodejs/src/node/internal-node.ts:67`, `packages/platform-nodejs/src/node/internal-node.ts:169-179`, `packages/platform-nodejs/src/node/internal-node.ts:335-367` |

런타임은 종료 훅을 명시적 계약으로만 제공합니다. 신호 등록은 범용 런타임 표면이 아니라 주변 호스트가 제공하는 shutdown registration callback의 책임입니다.

## Runtime cleanup settlement

Runtime-owned cleanup registration은 동기 또는 비동기 callback을 받습니다. close와
bootstrap-failure cleanup은 등록 순서대로 callback을 실행하고 다음 cleanup phase 전에 각각을
await합니다. 실패해도 이후 registration은 건너뛰지 않습니다. close는 failure를 aggregate하고
완료되지 않은 cleanup phase만 retry 가능하게 남기며, bootstrap은 원래 bootstrap error를 보존하고
cleanup failure를 `ApplicationLogger`로 보고합니다.

## 실패, 재시도와 자원 소유권

1. `Application.close()`는 첫 await 전에 terminal gate를 닫고 진행 중 listen의 settlement를 기다립니다. 늦게 완료된 listen은 ready로 돌아가지 않습니다. 연결된 microservice를 연결 역순으로 닫은 뒤 부모의 readiness reset → runtime cleanup → destroy hooks → application shutdown hooks → adapter close → container dispose 순서로 진행합니다. Context에는 child HTTP adapter 종료가 없습니다.
2. `Application.get()`, `ApplicationContext.get()`, `Application.listen()`, `Application.dispatch()`, `Application.connectMicroservice()`, `Application.startAllMicroservices()`는 shutdown 시작 후 거부됩니다. Provider/runtime resolution 전후 모두 gate를 검사하므로 close와 겹친 비동기 해석 결과도 반환하거나 child로 연결하지 않습니다. Pending/실패 중 기존 공개 state는 유지되지만 사용 가능하다는 뜻은 아닙니다. 성공한 close 뒤 provider lookup도 disposed container에서 실패합니다.
3. Runtime cleanup과 shutdown hook의 개별 실패는 나머지 callback/hook과 이후 adapter/container 정리를 건너뛰지 않습니다. 단일 실패는 error로, 여러 실패는 `AggregateError`로 reject합니다. 완료된 phase는 재시도에서 건너뜁니다. **Runtime cleanup phase가 실패하면 등록된 callback 전체를, lifecycle hook phase가 실패하면 두 hook pass 전체를 다시 실행**하므로 이 훅들은 성공했던 작업의 재진입도 처리해야 합니다. 이는 container의 실패한 `onDestroy()`만 재시도하는 정책과 다릅니다. Readiness reset 자체가 throw하면 그 시도의 이후 phase로 진행하지 않습니다.
4. DI disposal은 materialize된 container-managed instance와 소유한 child scope를 정리하며 성공한 `onDestroy()`는 다시 호출하지 않습니다. 실패 뒤에도 container의 register/override/resolve/createRequestScope는 terminal입니다. 직접 dispose한 child의 후속 재시도는 그 caller가, parent가 시작한 실패한 child disposal은 parent hierarchy가 소유합니다. Lifecycle `onModuleDestroy()`/`onApplicationShutdown()`와 DI `onDestroy()`는 별도 계약이며 하나의 hook으로 합쳐지지 않습니다.
5. Adapter retry는 adapter 소유입니다. Runtime은 incomplete adapter phase에서 `close(signal)`을 다시 호출할 뿐 모든 adapter를 재시작하거나 같은 drain을 보장하지 않습니다. `MicroserviceApplication.close()`는 성공/실패 결과를 terminal하게 보존하므로 부모 close 재시도가 child transport teardown을 재실행하지 않습니다. `startAllMicroservices()` 실패는 먼저 시작된 child만 역순 rollback하며 원래 시작 오류를 유지합니다.
6. Bootstrap 실패 시 확보한 readiness/runtime cleanup/hook/HTTP adapter/container 정리를 시도하고 원래 오류를 보존합니다. 반환된 앱의 readiness/listen/시작 로그/signal 등록 실패도 `app.close('bootstrap-failed')`를 거칩니다. Cleanup이나 logger 실패가 원래 오류를 바꾸지 않습니다. Factory 호출 이전에 생성한 외부 자원은 여전히 application이 소유합니다.
7. Node signal은 `shutdownRegistration` callback으로 listen 후 등록합니다. 부분 등록 실패는 Node 소유자가 rollback합니다. Manual close는 해제를 한 번 시도하고 모든 runtime 정리를 계속합니다. 동시 close와 이후 close는 해제 실패를 공유하며 teardown 실패와 aggregate됩니다. Runtime teardown이 끝나면 해제 실패가 있어도 state는 `closed`입니다. Node timeout/close 실패는 로그와 `process.exitCode = 1`로 보고하며 `process.exit()`를 호출하지 않습니다.
8. Node adapter는 server drain 및 timeout 뒤 남은 연결 종료를 소유합니다. Fastify는 `app.close()` settlement를 기다리며 close 대기 시간이 제한을 넘으면 reject하지만 underlying close는 계속됩니다. `Application.dispatch()` gate는 이미 admission된 요청을 취소하지 않을 뿐, 모든 요청·DB 작업·background job의 완료를 보장하는 universal drain이 아닙니다. 애플리케이션 custom drain과 host signal handler를 쓰면 Factory `shutdownRegistration` 생략으로 이중 소유권을 피합니다.

## 범위를 명시한 예제

다음은 등록된 provider의 훅 순서와 adapter 없는 context 종료만 보여주는 TypeScript fragment입니다. 빈 root module을 이 코드 안에서 정의하므로 별도 앱 파일이나 decorator 변환은 필요하지 않습니다. HTTP 요청이나 signal handler 예제는 아닙니다.

```ts
import { defineModule, FluoFactory } from '@fluojs/runtime';
import type { OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy, OnModuleInit } from '@fluojs/runtime';

const events: string[] = [];
class Resource implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown {
  onModuleInit() { events.push('init'); }
  onApplicationBootstrap() { events.push('bootstrap'); }
  onModuleDestroy() { events.push('destroy'); }
  onApplicationShutdown(signal?: string) { events.push(`shutdown:${signal ?? 'none'}`); }
}
class RootModule {}
defineModule(RootModule, { providers: [Resource] });
const context = await FluoFactory.createApplicationContext(RootModule);
try {
  await context.get(Resource);
} finally {
  await context.close('manual');
}
// events: ['init', 'bootstrap', 'destroy', 'shutdown:manual']
```

HTTP 앱은 `FluoFactory.create(AppModule, { adapter })` 뒤 `app.listen()`과 `app.close()`를 사용합니다. Host-owned 요청은 해당 adapter 연결 recipe를 따릅니다. 적용 설명은 Book 1권 23장 `ch23-lifecycle-and-readiness`와 legacy `book/advanced/ch09-app-context`에 있습니다.

## 기계 소비 계약과 실행 근거

아래 JSON만 `tooling/governance/runtime-shutdown-terminality.test.ts`가 기계 필드로 소비합니다. `shutdownOrder`는 child close 이후 부모 runtime phase 순서입니다. 자연어 문장, Book 서사, CONTEXT 요약은 검증 key가 아닙니다. Sentinel 검사는 삭제·중복·필드 변경을 검출하지만 의미나 runtime 동작을 단독으로 증명하지 않습니다. Legacy Book의 실제 runtime source excerpt 일치 검사는 별도 consumer 검사로 유지합니다.

<!-- fluo:lifecycle-shutdown:start -->
```json
{
  "schemaVersion": 1,
  "states": [
    "bootstrapped",
    "ready",
    "closed"
  ],
  "admissionCloses": "close-start",
  "blockedOperations": [
    "Application.get()",
    "ApplicationContext.get()",
    "Application.listen()",
    "Application.dispatch()",
    "Application.connectMicroservice()",
    "Application.startAllMicroservices()"
  ],
  "stateDuringCloseOrFailure": "unchanged",
  "closedAfter": "successful-runtime-teardown",
  "admittedDispatch": "not-cancelled-by-gate",
  "shutdownOrder": [
    "readiness-reset",
    "runtime-cleanup",
    "onModuleDestroy:reverse",
    "onApplicationShutdown:reverse",
    "adapter.close",
    "container.dispose"
  ],
  "retry": {
    "runtimeCleanup": "incomplete-phase-all-registrations",
    "lifecycleHooks": "incomplete-phase-all-hooks",
    "adapter": "adapter-owned",
    "container": "failed-onDestroy-only",
    "microservice": "cached-terminal-result",
    "admissionReopens": false
  },
  "nodeSignals": {
    "defaults": [
      "SIGINT",
      "SIGTERM"
    ],
    "forceExitTimeoutMs": 30000,
    "callsProcessExit": false
  },
  "nodeAdapterShutdownTimeoutMs": 10000,
  "httpCreation": {
    "entrypoint": "FluoFactory.create",
    "removedExports": [
      "bootstrapApplication",
      "fluoFactory"
    ],
    "middleware": [
      "cors:opt-in",
      "prefix:opt-in",
      "security-headers:default-on",
      "caller",
      "module:after-match"
    ],
    "logger": "option-or-portable-console",
    "creationFailure": "original-error-after-adapter-and-runtime-cleanup",
    "listenFailure": "terminal-shutdown",
    "shutdownRegistration": "host-owned-opt-in-after-listen",
    "unregistration": "attempt-once-retain-failure"
  },
  "signalCleanupFailureState": "closed-after-runtime-teardown"
}
```
<!-- fluo:lifecycle-shutdown:end -->

| 근거 | 검증하는 경계 |
| --- | --- |
| `packages/runtime/src/index.ts`, `types.ts`, `bootstrap.ts`, `retryable-shutdown.ts`, `platform-shell.ts` | 공개 export, 상태, lifecycle 순서, gate, 완료 phase와 실패 경로 |
| `packages/runtime/src/application.test.ts`, `bootstrap.test.ts` | Pending/실패/성공 종료, provider·child resolution 경쟁, dispatch admission, hook 재실행, DI 실패 hook 재시도, bootstrap 정리, 실제 Node HTTP 및 signal timeout |
| `packages/runtime/src/http-adapter-shared.ts`, `http-adapter-shared.test.ts` | Helper 시작/등록 실패 정리, 원래 오류 유지, signal 등록 해제 |
| `packages/di/src/container.ts`, `container-disposal-retry.test.ts` | Terminal disposal, 모든 materialized hook 시도, 실패 hook만 명시적 재시도 |
| `packages/platform-nodejs/src/node/internal-node.ts`, `internal-node-shutdown.ts`; `packages/platform-fastify/src/adapter.ts`, `adapter.test.ts` | Server 생성과 listen 구분, 기본값, signal/close 소유권 및 실제 HTTP |
| `packages/platform-nextjs/src/adapter.ts`, `index.test.ts`; `packages/platform-cloudflare-workers/src/adapter.ts`, `adapter-lifecycle.test.ts` | Host-owned dispatcher 연결과 종료 경계 |

Repository root에서 실행합니다. Packages project의 global setup은 필요한 emitted dependency를 빌드합니다. 외부 DB/broker나 실제 Next.js/Workers 배포를 검증하는 명령은 아닙니다.

```bash
pnpm exec vitest run tooling/governance/runtime-shutdown-terminality.test.ts packages/runtime/src/application.test.ts packages/runtime/src/bootstrap.test.ts packages/runtime/src/http-adapter-shared.test.ts packages/di/src/container-disposal-retry.test.ts packages/platform-fastify/src/adapter.test.ts packages/platform-nextjs/src/index.test.ts packages/platform-cloudflare-workers/src/adapter-lifecycle.test.ts --maxWorkers=1
```

## 관련 문서

- [패키지 아키텍처 참조](./architecture-overview.ko.md)
- [개발 리로드 아키텍처](./dev-reload-architecture.ko.md)
- [구성 및 환경](./config-and-environments.ko.md)
- [런타임 패키지 README](../../packages/runtime/README.ko.md)
