# 라이프사이클 및 종료 보장

<p><a href="./lifecycle-and-shutdown.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 시작 단계

| 순서 | 단계 | 런타임 사실 | 근거 소스 |
| --- | --- | --- | --- |
| 1 | 모듈 부트스트랩 | `bootstrapApplication(...)`은 어떤 라이프사이클 훅보다 먼저 모듈 그래프를 컴파일하고 DI 컨테이너를 생성합니다. | `packages/runtime/src/bootstrap.ts` |
| 2 | 런타임 토큰 등록 | 모듈 컴파일이 성공한 뒤 `HTTP_APPLICATION_ADAPTER`, `PLATFORM_SHELL`, `RUNTIME_CONTAINER`, `COMPILED_MODULES` 같은 런타임 토큰이 등록됩니다. | `packages/runtime/src/bootstrap.ts` |
| 3 | 라이프사이클 인스턴스 해석 | 공개 라이프사이클 계약을 구현한 런타임 공급자와 모듈 공급자를 라이프사이클 실행 전에 해석합니다. | `packages/runtime/src/bootstrap.ts` |
| 4 | 부트스트랩 라이프사이클 | `runBootstrapHooks(...)`는 먼저 모든 해석된 라이프사이클 인스턴스의 `onModuleInit()`를 실행하고, 이어서 같은 인스턴스들의 `onApplicationBootstrap()`를 실행합니다. | `packages/runtime/src/bootstrap.ts:693-705` |
| 5 | 플랫폼 시작 | `platformShell.start()`는 부트스트랩 훅이 완료된 뒤 실행됩니다. 이 단계가 성공하기 전까지 readiness 표시는 시작 중 상태에 머뭅니다. | `packages/runtime/src/bootstrap.ts:830-841` |
| 6 | 디스패처 생성 | HTTP 디스패처는 부트스트랩 라이프사이클 경로가 끝난 뒤 생성됩니다. 타이밍 진단을 켜면 이 단계는 `create_dispatcher` phase로 노출됩니다. | `packages/runtime/src/bootstrap.ts`, `packages/runtime/src/health/diagnostics.ts` |

타이밍 진단을 `diagnostics.timing`으로 활성화하면 부트스트랩 phase 이름은 `bootstrap_module`, `register_runtime_tokens`, `resolve_lifecycle_instances`, `run_bootstrap_lifecycle`, `create_dispatcher`로 고정됩니다.

어느 부트스트랩 단계에서든 실패가 발생하면 런타임은 `bootstrap-failed` 신호 값으로 실패 정리를 수행하고 컨테이너를 해제하며, 애플리케이션을 ready 상태로 남기지 않습니다.

## 상태 신호

| 신호 또는 상태 | 보장 | 근거 소스 |
| --- | --- | --- |
| 모듈 readiness 표시 | 부트스트랩 중 `markStarting()`과 `markReady()`를 노출하는 compiled module은 라이프사이클 훅 전에 starting으로 설정되고, `platformShell.start()`가 성공한 뒤에만 ready로 전환됩니다. shutdown은 cleanup callback과 lifecycle shutdown hook 실행 전에 이 표시를 starting으로 되돌립니다. | `packages/runtime/src/bootstrap.ts:232-245`, `packages/runtime/src/bootstrap.ts:119-153`, `packages/runtime/src/bootstrap.ts:830-841` |
| 애플리케이션 상태 모델 | 공개 런타임 상태는 `bootstrapped`, `ready`, `closed`입니다. | `packages/runtime/src/types.ts:91-92` |
| listen 이전 readiness 게이트 | `Application.listen()`은 `ready()`를 호출하고, `ready()`는 `platformShell.assertCriticalReadiness()`에 위임합니다. 이 검사가 통과하기 전에는 어댑터 bind가 시작되지 않습니다. | `packages/runtime/src/bootstrap.ts:437-489` |
| ready 전이 | `Application.listen()`은 `adapter.listen(this.dispatcher)`가 성공적으로 끝난 뒤에만 애플리케이션 상태를 `ready`로 설정합니다. | `packages/runtime/src/bootstrap.ts:481-490` |
| closed 전이 | `Application.close()`는 readiness 표시 reset, 런타임 정리, 라이프사이클 종료 훅, 어댑터 종료, 컨테이너 해제가 모두 오류 없이 끝난 뒤에만 상태를 `closed`로 설정합니다. | `packages/runtime/src/bootstrap.ts:500-528` |

이 보장들은 부트스트랩 완료와 리스너 바인딩을 분리합니다. 컴파일된 애플리케이션은 트래픽을 받기 전에 `bootstrapped` 상태로 존재할 수 있습니다.

## 종료 보장

| 영역 | 보장 | 경계 |
| --- | --- | --- |
| 훅 순서 | `runShutdownHooks(...)`는 라이프사이클 인스턴스의 역순으로 `onModuleDestroy()`를 실행한 뒤, 다시 역순으로 `onApplicationShutdown(signal?)`를 실행합니다. | `packages/runtime/src/bootstrap.ts:710-722` |
| 종료 경로 순서 | `closeRuntimeResources(...)`는 먼저 런타임 정리 콜백을 실행하고, 그다음 종료 훅, 그다음 `adapter.close(signal)`, 마지막으로 컨테이너 해제를 수행합니다. | `packages/runtime/src/bootstrap.ts:119-153` |
| 멱등 close 진입 | `Application.close()`와 `ApplicationContext.close()`는 진행 중인 closing promise를 재사용하며, 첫 번째 close가 성공한 뒤에는 즉시 반환합니다. | `packages/runtime/src/bootstrap.ts:500-528`, `packages/runtime/src/bootstrap.ts:548-576` |
| 부트스트랩 실패 정리 | 시작 도중 라이프사이클 인스턴스가 이미 생성된 뒤 실패하면, 런타임은 `bootstrap-failed` 신호로 같은 종료 훅을 실행하고 컨테이너 해제를 시도합니다. | `packages/runtime/src/bootstrap.ts:155-189` |
| Microservice ownership | `Application.connectMicroservice()`로 연결한 microservice는 해당 애플리케이션이 소유하는 child입니다. `startAllMicroservices()`는 뒤쪽 child 시작 실패 시 이미 시작된 child를 `bootstrap-failed`로 rollback하며, `Application.close(signal)`은 부모 runtime cleanup, lifecycle hook, adapter close, container dispose보다 먼저 연결된 microservice를 닫습니다. | `packages/runtime/src/bootstrap.ts` |
| Microservice ingress | Microservice close 시작은 terminal ingress gate를 동기적으로 설정합니다. 겹친 `listen()`이 settle되는 동안 새 `send()`와 `emit()` 호출은 runtime 또는 transport handoff 전에 reject되며, close 시도가 실패해도 ingress는 다시 열리지 않습니다. | `packages/runtime/src/bootstrap.ts`, `packages/microservices/src/service.ts` |
| Cron scheduler ownership | `@fluojs/cron`은 decorator로 발견한 cron task를 application bootstrap 중 시작하고, 이미 시작된 registry에 dynamic cron task가 추가되면 즉시 시작하며, shutdown 중 active task execution을 설정된 timeout 안에서 drain합니다. 같은 timeout은 shutdown 중 Redis owned-lock release I/O에도 적용됩니다. Distributed lock release는 task execution 뒤에 실행됩니다. Release 실패 또는 release I/O timeout 시 local ownership은 shutdown retry/reporting을 위해 유지되고, bounded shutdown timeout이 만료되면 아직 실행 중인 lock은 보존됩니다. | `packages/cron/src/service.ts`, `packages/cron/src/distributed-lock-manager.ts` |
| Node 신호 범위 | Node 기반 종료 등록은 기본적으로 `SIGINT`와 `SIGTERM`을 감시합니다. | `packages/runtime/src/node/internal-node-shutdown.ts:4-15` |
| 호스트 타임아웃 경계 | Node 신호 등록은 기본 강제 종료 타임아웃으로 `30_000` ms를 사용합니다. 타임아웃이 나면 실패를 로그로 남기고 `process.exitCode = 1`을 설정하지만, 호스트 프로세스를 직접 종료하지는 않습니다. | `packages/runtime/src/node/internal-node-shutdown.ts:6-15`, `packages/runtime/src/node/internal-node-shutdown.ts:77-109` |
| 어댑터 드레인 타임아웃 | Node HTTP 어댑터는 drain semantics로 서버를 종료하고, `shutdownTimeoutMs`가 지나면 남은 연결을 강제로 닫습니다. 어댑터 기본값은 `10_000` ms입니다. | `packages/runtime/src/node/internal-node.ts:67`, `packages/runtime/src/node/internal-node.ts:169-179`, `packages/runtime/src/node/internal-node.ts:335-367` |

런타임은 종료 훅을 명시적 계약으로만 제공합니다. 신호 등록은 범용 런타임 표면이 아니라 주변 호스트나 어댑터 헬퍼의 책임입니다.

## 관련 문서

- [패키지 아키텍처 참조](./architecture-overview.ko.md)
- [개발 리로드 아키텍처](./dev-reload-architecture.ko.md)
- [구성 및 환경](./config-and-environments.ko.md)
- [런타임 패키지 README](../../packages/runtime/README.ko.md)
