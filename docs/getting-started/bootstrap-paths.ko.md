# Application Bootstrap Protocol

<p><strong><kbd>한국어</kbd></strong> <a href="./bootstrap-paths.md"><kbd>English</kbd></a></p>

이 페이지는 현재 checkout의 HTTP 앱 생성 계약을 소유합니다. `FluoFactory.create(AppModule, { adapter })` → `app.listen()` → `app.close()`를 사용합니다. 기본 CLI 앱은 Node.js + Fastify를 유지합니다. Node 호스트는 `>=24.0.0 <27`을 충족해야 하며 다른 조합은 [스타터 지원 매트릭스](../reference/fluo-new-support-matrix.ko.md)를 따릅니다. 제거된 import와 기본값 변경은 [HTTP Factory migration guide](./migrate-http-factory.ko.md)를 참고하세요.

| 공개 진입점 | 선택 조건 | 완료 시점과 소유권 |
| --- | --- | --- |
| adapter를 전달하는 `@fluojs/runtime`의 `FluoFactory.create` | 모든 HTTP application shell 생성 | 모듈·lifecycle·dispatcher 초기화 후 listen 없이 반환합니다. Factory가 middleware 조합과 실패 정리를 소유합니다. 필요한 경우 `logger`와 host-owned `shutdownRegistration`을 명시하세요. |
| `@fluojs/runtime`의 `FluoFactory.createApplicationContext` | HTTP 없는 DI와 라이프사이클 작업 | HTTP listener 없이 application context를 반환하며 호출자가 닫습니다. |
| Workers/Next.js host-owned 진입점 | Fluo를 호스트 요청 dispatcher에 연결 | 활성화가 반드시 socket bind를 뜻하지는 않습니다. 요청과 shutdown은 호스트가 소유하며 [Workers](../../packages/platform-cloudflare-workers/README.ko.md) 또는 [Next.js](../../packages/platform-nextjs/README.ko.md) 계약을 따릅니다. |

`fluoFactory`, `bootstrapApplication`, platform bootstrap/run helper, adapter 생성 free function은 모든 public entrypoint에서 제거됩니다. 각 platform의 adapter class static `create(options)`를 Factory에 전달하고 host가 shutdown callback을 설치합니다. Application context와 microservice는 계속 별도 기능입니다.

### Default Node/Fastify recipe

다음은 CLI가 생성하는 `src/main.ts` 형태입니다. 생성된 `src/app.ts`, 등록된 config/greeting/health 모듈, 설치한 registry 의존성, 생성된 decorator build/test 설정이 필요합니다.

```ts
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app';

const parsedPort = Number.parseInt(process.env.PORT ?? '3000', 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 3000;

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({ port }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
```

Factory는 설정된 CORS, global prefix(`globalPrefixExclude` 포함), security headers, 호출자 middleware 순으로 조합합니다. Module middleware는 route matching 뒤에 실행됩니다. Security headers는 `securityHeaders: false`가 아니면 활성화되며 CORS와 prefix는 생략하면 꺼집니다. 호출자 middleware 배열은 변경하지 않고 복사합니다. Factory는 `options.logger` 또는 transport-neutral console logger를 선택합니다. 위 Node recipe는 기존 run helper가 사용하던 Node logger를 명시적으로 선택합니다. Native Fastify logging은 계속 비활성화됩니다.

사용자 지정 `ApplicationLogger`는 `FluoFactory.create(AppModule, { adapter, logger })`로 전달하며 같은 객체를 `APPLICATION_LOGGER`로 주입받을 수 있습니다. `app.get(publicToken<T>(...))`는 `Promise<T>`를 추론하고 class token은 class identity를 보존합니다. 일반 programmatic HTTP dispatch는 `app.dispatch(...)`를 사용하세요. 직접 `app.dispatcher.dispatch(...)`나 `app.container.resolve(...)`에 접근하면 같은 shutdown admission gate를 거치지 않습니다.

`shutdownRegistration`을 생략하면 Node signal은 등록되지 않습니다. 위 recipe의 Node callback은 listen 뒤 기본 `SIGINT`/`SIGTERM`을 등록합니다. `false` 또는 명시적 signal 목록으로 바꿀 수 있으며 `forceExitTimeoutMs`의 Node 기본값은 `30_000`입니다. `close()`는 signal 해제를 한 번 시도한 뒤 모든 runtime 정리를 진행합니다. 동시 close는 같은 결과를 받습니다. 해제 오류는 이후 close에도 유지되며 runtime 정리까지 실패하면 두 오류를 aggregate합니다. Runtime 자원 정리가 끝나면 signal 해제 오류가 있어도 `state`는 `closed`입니다.

### Environment and evaluation prerequisites

Factory 생성 실패는 확보한 runtime 자원, lifecycle instance, 전달된 adapter, container를 정리합니다. Readiness, listen, startup logging, shutdown registration 실패 시 `app.close('bootstrap-failed')`를 호출하며 cleanup이나 logger가 실패해도 원래 오류를 보존합니다. Node registration은 부분 설치된 handler를 rollback합니다. Custom host registration은 unregister callback을 반환하기 전의 rollback을 직접 소유합니다. Signal 기반 timeout/실패는 로그와 `process.exitCode`로 보고하며 최종 프로세스 종료는 호스트가 소유합니다. [Lifecycle 계약](../architecture/lifecycle-and-shutdown.ko.md)을 참고하세요.

- `generated-app`: 생성 프로젝트 안에서 registry 의존성과 `fluo dev`/`fluo build`/`fluo start` script를 사용해 [설정 명령](./quick-start.ko.md)을 실행합니다. 기능 추가 시 `ConfigModule`, `GreetingModule`, `HealthModule.forRoot()`와 테스트를 보존합니다.
- `repository-example`: `examples/fluo-blog/00-start`는 workspace 의존성, 저장소 패키지 빌드, 번호별 checkpoint script를 사용합니다. `examples/minimal`은 별도의 명시적 조립 예제입니다. 어느 쪽도 생성 스타터를 통째로 교체하는 파일이 아닙니다.
- 표준 decorator transform을 유지하고 `experimentalDecorators`/`emitDecoratorMetadata`는 비활성화합니다. Metadata는 decorated declaration 평가 전에 존재해야 합니다. 호스트/transform이 `Symbol.metadata`를 제공하지 않으면 해당 선언 평가 전에 `@fluojs/core`의 공개 `ensureMetadataSymbol()`을 호출합니다. 진입점 본문의 호출은 static import보다 먼저 실행될 수 없으므로 이 준비가 필요한 custom bootstrap은 decorated module을 로드하기 전에 준비해야 합니다. [Decorator 계약](../architecture/decorators-and-metadata.ko.md)을 참고하고, 동작 중인 스타터의 import나 도구 설정을 일괄 교체하지 않습니다.
- `ConfigModule.forRoot(...)`는 동기적으로 config provider를 등록합니다. Config 로딩과 전달된 동기 schema 검증은 bootstrap 중 `ConfigService`를 resolve할 때 listen 전에 수행됩니다. 명시적 `loadConfig(...)`는 호출 시 실행되므로 runtime bootstrap 시작 전일 수도 있습니다. Schema 실패는 `INVALID_CONFIG`로 load를 거절하며, 생성 스타터에는 엄격한 port schema가 없습니다. [설정 규칙](../architecture/config-and-environments.ko.md)을 참고하세요.
- Port 파싱은 애플리케이션 정책입니다. CLI는 `Number.parseInt(..., 10)`를 사용하고 결과가 유한하지 않으면 `3000`으로 fallback합니다(`3000oops`는 `3000`). FluoBlog checkpoint는 이 fallback 없이 `Number(process.env.PORT ?? '3000')`를 사용합니다(`3000oops`는 `NaN`). Fastify는 변환된 숫자 option을 `0..65535` 범위의 정수로 검증하며 `0`은 OS가 선택하는 port를 허용합니다. Fastify 자체는 `PORT`를 읽지 않습니다. Book의 엄격한 10진수 `1..65535` 정책은 두 진입점과 의도적으로 다릅니다.

## Startup Sequence

아래 공통 초기화 순서는 Factory와 Fastify helper가 함께 사용합니다. 생성, lifecycle readiness, 요청 수용은 서로 다른 경계이며 상세 계약은 [Lifecycle & Shutdown Guarantees](../architecture/lifecycle-and-shutdown.ko.md)가 소유합니다.

1. `FluoFactory.create(rootModule, options)`가 `packages/runtime/src/bootstrap.ts`에서 HTTP 생성 구현을 직접 소유하며 forwarding 자유 함수는 없습니다.
2. `bootstrapModule(...)`는 루트 모듈에서 도달 가능한 모듈 그래프를 컴파일하고 import, export, provider visibility, injection metadata를 검증합니다.
3. `registerRuntimeBootstrapTokens(...)`는 선택된 HTTP 어댑터를 `HTTP_APPLICATION_ADAPTER` 토큰으로 등록하고, 런타임 platform shell을 `PLATFORM_SHELL` 토큰으로 등록합니다.
4. `resolveBootstrapLifecycleInstances(...)`는 라이프사이클 훅을 노출하는 런타임 provider와 모듈 provider를 resolve합니다.
5. `runBootstrapHooks(...)`는 모든 `onModuleInit()` 훅을 먼저 실행한 뒤, 모든 `onApplicationBootstrap()` 훅을 실행합니다.
6. `platformShell.start()`는 라이프사이클 훅이 모두 성공한 뒤에 실행됩니다. readiness는 이 start 단계가 끝난 후에만 표시됩니다.
7. `createRuntimeDispatcher(...)`가 Factory에서 조합한 middleware로 dispatcher를 만들고 `FluoFactory.create(...)`가 `FluoApplication` 인스턴스를 반환합니다.
8. `app.listen()`은 readiness를 검사하고 adapter를 활성화합니다. run helper는 내부에서 이를 await하고, Factory/bootstrap 호출자는 이후 직접 호출합니다. Node/Fastify에서는 서버를 bind하지만 host-owned Workers/Next.js에서는 새 socket listener 대신 dispatcher를 활성화합니다.

## Entry Points

| Path | Role |
| --- | --- |
| `packages/cli/src/new/scaffold.ts` | Node logger/signal 의존성을 명시한 Node HTTP Factory 진입점과 config/greeting/health 등록을 생성합니다. |
| `examples/minimal/src/main.ts` | Fastify adapter를 전달한 `FluoFactory.create(...)` 이후 `app.listen()`을 호출하는 명시적 저수준 조립입니다. 생성 스타터가 아닙니다. |
| `packages/runtime/src/bootstrap.ts` | `FluoFactory.create(...)`, `FluoFactory.createApplicationContext(...)`, `FluoFactory.createMicroservice(...)`의 실제 구현입니다. |
| `packages/platform-nodejs/src/index.ts` | 플랫폼이 소유하는 raw Node adapter, logging, filesystem, shutdown signal helper의 구현 소스입니다. |
| `packages/platform-fastify/src/adapter.ts` | Fastify 경로의 `FastifyHttpApplicationAdapter.create(...)`를 노출합니다. |
| `packages/platform-cloudflare-workers/src/adapter.ts` | Worker fetch 경로의 `createCloudflareWorkerAdapter(...)`, `bootstrapCloudflareWorkerApplication(...)`, `createCloudflareWorkerEntrypoint(...)`를 노출합니다. |

## Platform Registration

- 애플리케이션 부트스트랩은 `FluoFactory.create(...)`에 전달되는 `adapter` 옵션으로 플랫폼 바인딩을 받습니다.
- 런타임 부트스트랩은 그 어댑터 인스턴스를 `HTTP_APPLICATION_ADAPTER` 토큰으로 저장하고, platform shell을 `PLATFORM_SHELL` 토큰으로 저장합니다.
- 플랫폼 패키지는 `@fluojs/platform-*` 아래에 있으며, 애플리케이션 경계에서 사용하는 adapter class를 제공합니다. 예시는 `FastifyHttpApplicationAdapter.create(...)`, `CloudflareWorkerHttpApplicationAdapter.create(...)`입니다.
- platform shell은 라이프사이클 훅이 끝난 뒤 시작되고, 종료 정리 단계에서 중지됩니다.
- `FluoFactory.createApplicationContext(...)`는 같은 모듈 그래프와 라이프사이클 경로를 따르지만 HTTP 어댑터 등록을 생략하고 HTTP 애플리케이션 대신 application context를 반환합니다.
- 스타터 shape, runtime/platform 조합, 공개된 microservice transport 변형은 [fluo new 지원 매트릭스](../reference/fluo-new-support-matrix.ko.md)에 정리되어 있습니다.

## Shutdown Sequence

1. 종료는 애플리케이션이 명시적으로 닫히거나, 호스트 전용 helper가 shutdown signal을 등록하고 수신할 때 시작됩니다.
2. `runShutdownHooks(...)`는 라이프사이클 인스턴스를 역순으로 순회합니다.
3. 모든 `onModuleDestroy()` 훅이 실행된 뒤에야 `onApplicationShutdown(signal)` 훅이 실행됩니다.
4. platform shell은 부트스트랩 중 추가된 라이프사이클 cleanup 항목을 통해 중지됩니다.
5. 어댑터별 `close()` 로직은 런타임 계약에 따라 ingress를 drain하거나 거부합니다. 예를 들어 Fastify는 서버 close 완료를 `shutdownTimeoutMs`까지 대기합니다. 그 대기가 timeout되면 caller-facing `close()` promise를 reject하지만, 기반 Fastify close와 adapter cleanup은 settle될 때까지 계속됩니다. Cloudflare Workers는 dispatcher를 해제하기 전 진행 중 요청을 drain하는 동안 새 HTTP/WebSocket ingress를 `503`으로 거부합니다.
6. 부트스트랩이 애플리케이션 반환 전에 실패한 경우에는 shutdown hook 이후 container dispose가 실행됩니다.

## Error States

- `ModuleGraphError`: 순환 import나 잘못된 imported module처럼 모듈 그래프 컴파일 또는 검증 단계에서 발생합니다.
- `ModuleVisibilityError`: provider, controller, 또는 module export가 현재 모듈에서 보이지 않는 토큰을 참조할 때 발생합니다.
- `ModuleInjectionMetadataError`: 생성자 주입 metadata가 필수 파라미터를 모두 설명하지 못할 때 발생합니다.
- 라이프사이클 훅 실패: `onModuleInit()` 또는 `onApplicationBootstrap()`의 rejection은 readiness 표시 전에 부트스트랩을 중단합니다.
- 어댑터 또는 플랫폼 시작 실패: platform shell과 dispatcher 실패는 생성을 reject합니다. 이후 readiness/listen/setup 실패는 Factory가 close한 뒤 reject하므로 terminal shell에서 시작을 재시도하지 말고 새 앱을 만드세요. Adapterless `listen()`은 사용 오류이며 미시작 shell을 보존하므로 dispatch나 명시적 close가 가능합니다.
- `InvariantError`: `FluoFactory.createMicroservice(...)`가 resolve된 런타임 토큰에서 `listen()` 구현을 찾지 못하면 발생합니다.
- 부트스트랩 실패 정리는 synthetic signal인 `bootstrap-failed`를 사용하며, 원래 오류를 다시 던지기 전에 shutdown hook과 container dispose를 실행합니다.

## Evidence

- [공통 helper 구현](../../packages/runtime/src/http-adapter-shared.ts)과 [테스트](../../packages/runtime/src/http-adapter-shared.test.ts): middleware, 완료 시점, 실패/signal cleanup.
- [Fastify 구현](../../packages/platform-fastify/src/adapter.ts)과 [테스트](../../packages/platform-fastify/src/adapter.test.ts): 숫자 검증, logging, listen, Node signal 연결.
- [Runtime bootstrap](../../packages/runtime/src/bootstrap.ts)과 [테스트](../../packages/runtime/src/bootstrap.test.ts): 공통 초기화와 실패 정리.
- [CLI scaffold](../../packages/cli/src/new/scaffold.ts)와 [테스트](../../packages/cli/src/new/scaffold.test.ts): 생성 import, 등록, script, port parser.
- [명시적 minimal 진입점](../../examples/minimal/src/main.ts), [FluoBlog checkpoint 진입점](../../examples/fluo-blog/00-start/src/main.ts), [Book 첫 애플리케이션](../../book/01-fluoblog/ch01-first-app.ko.md): 서로 다른 환경과 애플리케이션 정책.

지원되는 Node에서 의존성을 설치한 저장소 checkout을 기준으로 `pnpm docs:sync-check`는 웹사이트 counterpart 존재를, `pnpm exec vitest run --project tooling tooling/governance/verify-standard-decorator-docs.test.ts`는 기존 decorator 문서 검사를 수행합니다. 이 검사는 locale 의미, 네트워크 동작, 최신 배포 패키지 내용을 증명하지 않으며 실제 범위별 실행과 한계는 별도로 기록합니다.
