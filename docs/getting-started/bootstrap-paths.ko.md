# Application Bootstrap Protocol

<p><strong><kbd>한국어</kbd></strong> <a href="./bootstrap-paths.md"><kbd>English</kbd></a></p>

## Startup Sequence

1. `FluoFactory.create(rootModule, options)`는 `packages/runtime/src/bootstrap.ts`의 `bootstrapApplication(...)`으로 위임됩니다.
2. `bootstrapModule(...)`는 루트 모듈에서 도달 가능한 모듈 그래프를 컴파일하고 import, export, provider visibility, injection metadata를 검증합니다.
3. `registerRuntimeBootstrapTokens(...)`는 선택된 HTTP 어댑터를 `HTTP_APPLICATION_ADAPTER` 토큰으로 등록하고, 런타임 platform shell을 `PLATFORM_SHELL` 토큰으로 등록합니다.
4. `resolveBootstrapLifecycleInstances(...)`는 라이프사이클 훅을 노출하는 런타임 provider와 모듈 provider를 resolve합니다.
5. `runBootstrapHooks(...)`는 모든 `onModuleInit()` 훅을 먼저 실행한 뒤, 모든 `onApplicationBootstrap()` 훅을 실행합니다.
6. `platformShell.start()`는 라이프사이클 훅이 모두 성공한 뒤에 실행됩니다. readiness는 이 start 단계가 끝난 후에만 표시됩니다.
7. `createRuntimeDispatcher(...)`가 dispatcher를 만들고, `bootstrapApplication(...)`은 `FluoApplication` 인스턴스를 반환합니다.
8. 네트워크 ingress는 애플리케이션 코드가 이후 `await app.listen()`를 호출할 때 시작됩니다. 실제 listen 동작은 각 어댑터 패키지가 담당합니다.

## Entry Points

| Path | Role |
| --- | --- |
| `examples/minimal/src/main.ts` | 기본 HTTP 부트스트랩 형태를 보여 주는 대표 애플리케이션 진입 파일입니다. `FluoFactory.create(...)`로 애플리케이션을 만들고 `app.listen()`을 호출합니다. |
| `packages/runtime/src/bootstrap.ts` | `bootstrapApplication(...)`, `FluoFactory.create(...)`, `FluoFactory.createApplicationContext(...)`, `FluoFactory.createMicroservice(...)`의 구현 소스입니다. |
| `packages/runtime/src/node.ts` | raw Node 부트스트랩 helper와 shutdown signal registration helper를 공개하는 Node 전용 subpath입니다. |
| `packages/platform-fastify/src/adapter.ts` | Fastify 경로의 `createFastifyAdapter(...)`, `bootstrapFastifyApplication(...)`, `runFastifyApplication(...)`를 노출합니다. |
| `packages/platform-cloudflare-workers/src/adapter.ts` | Worker fetch 경로의 `createCloudflareWorkerAdapter(...)`, `bootstrapCloudflareWorkerApplication(...)`, `createCloudflareWorkerEntrypoint(...)`를 노출합니다. |

## Platform Registration

- 애플리케이션 부트스트랩은 `FluoFactory.create(...)`에 전달되는 `adapter` 옵션으로 플랫폼 바인딩을 받습니다.
- 런타임 부트스트랩은 그 어댑터 인스턴스를 `HTTP_APPLICATION_ADAPTER` 토큰으로 저장하고, platform shell을 `PLATFORM_SHELL` 토큰으로 저장합니다.
- 플랫폼 패키지는 `@fluojs/platform-*` 아래에 있으며, 애플리케이션 경계에서 사용하는 어댑터 팩터리를 제공합니다. 예시는 `createFastifyAdapter(...)`, `createCloudflareWorkerAdapter(...)`입니다.
- platform shell은 라이프사이클 훅이 끝난 뒤 시작되고, 종료 정리 단계에서 중지됩니다.
- `FluoFactory.createApplicationContext(...)`는 같은 모듈 그래프와 라이프사이클 경로를 따르지만 HTTP 어댑터 등록을 생략하고 HTTP 애플리케이션 대신 application context를 반환합니다.
- 스타터 shape, runtime/platform 조합, 공개된 microservice transport 변형은 [fluo new 지원 매트릭스](../reference/fluo-new-support-matrix.ko.md)에 정리되어 있습니다.

## Shutdown Sequence

1. 종료는 애플리케이션이 명시적으로 닫히거나, 호스트 전용 helper가 shutdown signal을 등록하고 수신할 때 시작됩니다.
2. `runShutdownHooks(...)`는 라이프사이클 인스턴스를 역순으로 순회합니다.
3. 모든 `onModuleDestroy()` 훅이 실행된 뒤에야 `onApplicationShutdown(signal)` 훅이 실행됩니다.
4. platform shell은 부트스트랩 중 추가된 라이프사이클 cleanup 항목을 통해 중지됩니다.
5. 어댑터별 `close()` 로직은 런타임 계약에 따라 ingress를 drain하거나 거부합니다. 예를 들어 Fastify는 서버 close 완료를 기다리고, Cloudflare Workers는 dispatcher를 해제하기 전 진행 중 요청을 drain하는 동안 새 HTTP/WebSocket ingress를 `503`으로 거부합니다.
6. 부트스트랩이 애플리케이션 반환 전에 실패한 경우에는 shutdown hook 이후 container dispose가 실행됩니다.

## Error States

- `ModuleGraphError`: 순환 import나 잘못된 imported module처럼 모듈 그래프 컴파일 또는 검증 단계에서 발생합니다.
- `ModuleVisibilityError`: provider, controller, 또는 module export가 현재 모듈에서 보이지 않는 토큰을 참조할 때 발생합니다.
- `ModuleInjectionMetadataError`: 생성자 주입 metadata가 필수 파라미터를 모두 설명하지 못할 때 발생합니다.
- 라이프사이클 훅 실패: `onModuleInit()` 또는 `onApplicationBootstrap()`의 rejection은 readiness 표시 전에 부트스트랩을 중단합니다.
- 어댑터 또는 플랫폼 시작 실패: platform shell 시작, dispatcher 생성, 이후 adapter listen 단계에서 발생한 오류는 부트스트랩 실패로 전파됩니다.
- `InvariantError`: `FluoFactory.createMicroservice(...)`가 resolve된 런타임 토큰에서 `listen()` 구현을 찾지 못하면 발생합니다.
- 부트스트랩 실패 정리는 synthetic signal인 `bootstrap-failed`를 사용하며, 원래 오류를 다시 던지기 전에 shutdown hook과 container dispose를 실행합니다.
