# Application Bootstrap Protocol

<p><strong><kbd>한국어</kbd></strong> <a href="./bootstrap-paths.md"><kbd>English</kbd></a></p>

이 페이지는 현재 checkout의 bootstrap recipe 선택 기준을 소유합니다. 기본 CLI 애플리케이션은 Node.js + Fastify이며 `runFastifyApplication`을 사용합니다. Factory + adapter + listen으로 이름만 치환하는 경로가 아닙니다. Node 호스트는 `>=24.0.0 <27`을 충족해야 하며, 다른 runtime/platform 조합은 [스타터 지원 매트릭스](../reference/fluo-new-support-matrix.ko.md)를 따릅니다.

| 공개 진입점 | 선택 조건 | 완료 시점과 소유권 |
| --- | --- | --- |
| `@fluojs/platform-fastify`의 `runFastifyApplication` | 기본 Node/Fastify 애플리케이션 실행 | 초기화, listen, shutdown 등록이 끝난 뒤 애플리케이션으로 resolve됩니다. listen을 다시 호출하지 않습니다. |
| `@fluojs/platform-fastify`의 `bootstrapFastifyApplication` | 활성화 전에 Fastify 애플리케이션 구성 | listen이나 Node signal 등록 없이 초기화된 애플리케이션을 반환합니다. 이후 listen과 shutdown 등록은 호출자 책임입니다. |
| `@fluojs/runtime`의 `FluoFactory.create` + `@fluojs/platform-fastify`의 `createFastifyAdapter` + `app.listen()` | 명시적 저수준 조립 | 런타임 초기화는 공유하지만 미들웨어 조립, 생성 이후 실패 처리와 signal은 호출자가 소유합니다. Factory에는 공개 logger 옵션이 없으며 run helper와 자동으로 동등하지 않습니다. |
| `@fluojs/runtime`의 `FluoFactory.createApplicationContext` | HTTP 없는 DI와 라이프사이클 작업 | HTTP listener 없이 application context를 반환하며 호출자가 닫습니다. |
| Workers/Next.js host-owned 진입점 | Fluo를 호스트 요청 dispatcher에 연결 | 활성화가 반드시 socket bind를 뜻하지는 않습니다. 요청과 shutdown은 호스트가 소유하며 [Workers](../../packages/platform-cloudflare-workers/README.ko.md) 또는 [Next.js](../../packages/platform-nextjs/README.ko.md) 계약을 따릅니다. |

`fluoFactory`는 `FluoFactory`의 alias이며 다른 런타임 모델이 아닙니다.

### Default Node/Fastify recipe

다음은 CLI가 생성하는 `src/main.ts` 형태입니다. 생성된 `src/app.ts`, 등록된 config/greeting/health 모듈, 설치한 registry 의존성, 생성된 decorator build/test 설정이 필요합니다.

```ts
import { runFastifyApplication } from '@fluojs/platform-fastify';

import { AppModule } from './app';

const parsedPort = Number.parseInt(process.env.PORT ?? '3000', 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 3000;

await runFastifyApplication(AppModule, { port });
```

두 Fastify helper는 adapter를 만들고, 설정된 CORS, 설정된 global prefix(`globalPrefixExclude` 포함), security headers, 호출자 middleware 순으로 미들웨어를 조립합니다. Security headers는 `securityHeaders: false`가 아니면 활성화되며, CORS와 prefix는 생략하면 활성화되지 않습니다. 두 helper는 `options.logger` 또는 Node framework console logger를 선택합니다. `FluoFactory.create`는 런타임의 transport-neutral 기본 logger를 사용하며 공개 logger 옵션이 없습니다. [`CreateApplicationOptions`](../../packages/runtime/src/types.ts)에서 `logger`를 명시적으로 제외합니다. Native Fastify logging은 비활성화 상태입니다.

사용자 지정 `ApplicationLogger`가 필요하면 `@fluojs/runtime`의 `bootstrapApplication({ rootModule, adapter, logger })` 또는 `bootstrapFastifyApplication` / `runFastifyApplication`의 `logger` 옵션을 사용합니다.

run helper는 추가로 listen하고, listen target을 기록하며, 기본적으로 `SIGINT`/`SIGTERM`을 등록합니다. `shutdownSignals: false`는 signal을 호스트에 맡기고, 명시적 signal 목록은 기본값을 대체합니다. Listen/startup logging 실패 시 이미 닫힌 상태가 아니면 `app.close('bootstrap-failed')`를 시도합니다. Shutdown 등록 실패 시에도 같은 close를 시도합니다. Cleanup 실패는 로그로 남기고 원래 실패를 다시 던집니다. 반환된 `app.close()`는 runtime close 전에 signal을 한 번 해제하며, 해제가 throw해도 close를 시도하고, 둘 다 실패하면 `AggregateError`로 두 오류를 보고합니다. Factory와 bootstrap helper도 `bootstrapApplication`의 초기화 실패 정리를 공유하지만 이후 호출자가 수행하는 listen에 이 run-helper wrapper를 추가하지는 않습니다.

### Environment and evaluation prerequisites

초기화 cleanup은 확보한 런타임 자원, lifecycle instance, container를 대상으로 하며 모든 초기화 실패에서 HTTP adapter까지 닫는다는 보장이 아닙니다. Signal 등록이 일부 handler를 설치한 뒤 throw하면 run helper는 unregister callback을 반환받지 못하므로 그 등록을 rollback할 수 없습니다. Signal 기반 timeout/실패는 로그와 `process.exitCode`로 보고하며 최종 프로세스 종료는 호스트가 소유합니다. [기존 lifecycle 계약](../architecture/lifecycle-and-shutdown.ko.md)을 참고하세요.

- `generated-app`: 생성 프로젝트 안에서 registry 의존성과 `fluo dev`/`fluo build`/`fluo start` script를 사용해 [설정 명령](./quick-start.ko.md)을 실행합니다. 기능 추가 시 `ConfigModule`, `GreetingModule`, `HealthModule.forRoot()`와 테스트를 보존합니다.
- `repository-example`: `examples/fluo-blog/00-start`는 workspace 의존성, 저장소 패키지 빌드, 번호별 checkpoint script를 사용합니다. `examples/minimal`은 별도의 명시적 조립 예제입니다. 어느 쪽도 생성 스타터를 통째로 교체하는 파일이 아닙니다.
- 표준 decorator transform을 유지하고 `experimentalDecorators`/`emitDecoratorMetadata`는 비활성화합니다. Metadata는 decorated declaration 평가 전에 존재해야 합니다. 호스트/transform이 `Symbol.metadata`를 제공하지 않으면 해당 선언 평가 전에 `@fluojs/core`의 공개 `ensureMetadataSymbol()`을 호출합니다. 진입점 본문의 호출은 static import보다 먼저 실행될 수 없으므로 이 준비가 필요한 custom bootstrap은 decorated module을 로드하기 전에 준비해야 합니다. [Decorator 계약](../architecture/decorators-and-metadata.ko.md)을 참고하고, 동작 중인 스타터의 import나 도구 설정을 일괄 교체하지 않습니다.
- `ConfigModule.forRoot(...)`는 동기적으로 config provider를 등록합니다. Config 로딩과 전달된 동기 schema 검증은 bootstrap 중 `ConfigService`를 resolve할 때 listen 전에 수행됩니다. 명시적 `loadConfig(...)`는 호출 시 실행되므로 runtime bootstrap 시작 전일 수도 있습니다. Schema 실패는 `INVALID_CONFIG`로 load를 거절하며, 생성 스타터에는 엄격한 port schema가 없습니다. [설정 규칙](../architecture/config-and-environments.ko.md)을 참고하세요.
- Port 파싱은 애플리케이션 정책입니다. CLI는 `Number.parseInt(..., 10)`를 사용하고 결과가 유한하지 않으면 `3000`으로 fallback합니다(`3000oops`는 `3000`). FluoBlog checkpoint는 이 fallback 없이 `Number(process.env.PORT ?? '3000')`를 사용합니다(`3000oops`는 `NaN`). Fastify는 변환된 숫자 option을 `0..65535` 범위의 정수로 검증하며 `0`은 OS가 선택하는 port를 허용합니다. Fastify 자체는 `PORT`를 읽지 않습니다. Book의 엄격한 10진수 `1..65535` 정책은 두 진입점과 의도적으로 다릅니다.

## Startup Sequence

아래 공통 초기화 순서는 Factory와 Fastify helper가 함께 사용합니다. 생성, lifecycle readiness, 요청 수용은 서로 다른 경계이며 상세 계약은 [Lifecycle & Shutdown Guarantees](../architecture/lifecycle-and-shutdown.ko.md)가 소유합니다.

1. `FluoFactory.create(rootModule, options)`는 `packages/runtime/src/bootstrap.ts`의 `bootstrapApplication(...)`으로 위임됩니다.
2. `bootstrapModule(...)`는 루트 모듈에서 도달 가능한 모듈 그래프를 컴파일하고 import, export, provider visibility, injection metadata를 검증합니다.
3. `registerRuntimeBootstrapTokens(...)`는 선택된 HTTP 어댑터를 `HTTP_APPLICATION_ADAPTER` 토큰으로 등록하고, 런타임 platform shell을 `PLATFORM_SHELL` 토큰으로 등록합니다.
4. `resolveBootstrapLifecycleInstances(...)`는 라이프사이클 훅을 노출하는 런타임 provider와 모듈 provider를 resolve합니다.
5. `runBootstrapHooks(...)`는 모든 `onModuleInit()` 훅을 먼저 실행한 뒤, 모든 `onApplicationBootstrap()` 훅을 실행합니다.
6. `platformShell.start()`는 라이프사이클 훅이 모두 성공한 뒤에 실행됩니다. readiness는 이 start 단계가 끝난 후에만 표시됩니다.
7. `createRuntimeDispatcher(...)`가 dispatcher를 만들고, `bootstrapApplication(...)`은 `FluoApplication` 인스턴스를 반환합니다.
8. `app.listen()`은 readiness를 검사하고 adapter를 활성화합니다. run helper는 내부에서 이를 await하고, Factory/bootstrap 호출자는 이후 직접 호출합니다. Node/Fastify에서는 서버를 bind하지만 host-owned Workers/Next.js에서는 새 socket listener 대신 dispatcher를 활성화합니다.

## Entry Points

| Path | Role |
| --- | --- |
| `packages/cli/src/new/scaffold.ts` | 기본 Node/Fastify `runFastifyApplication(...)` 진입점과 config/greeting/health 등록을 생성합니다. |
| `examples/minimal/src/main.ts` | Fastify adapter를 전달한 `FluoFactory.create(...)` 이후 `app.listen()`을 호출하는 명시적 저수준 조립입니다. 생성 스타터가 아닙니다. |
| `packages/runtime/src/bootstrap.ts` | `bootstrapApplication(...)`, `FluoFactory.create(...)`, `FluoFactory.createApplicationContext(...)`, `FluoFactory.createMicroservice(...)`의 구현 소스입니다. |
| `packages/platform-nodejs/src/index.ts` | 플랫폼이 소유하는 raw Node adapter, bootstrap, logging, filesystem, shutdown signal helper의 구현 소스입니다. |
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
5. 어댑터별 `close()` 로직은 런타임 계약에 따라 ingress를 drain하거나 거부합니다. 예를 들어 Fastify는 서버 close 완료를 `shutdownTimeoutMs`까지 대기합니다. 그 대기가 timeout되면 caller-facing `close()` promise를 reject하지만, 기반 Fastify close와 adapter cleanup은 settle될 때까지 계속됩니다. Cloudflare Workers는 dispatcher를 해제하기 전 진행 중 요청을 drain하는 동안 새 HTTP/WebSocket ingress를 `503`으로 거부합니다.
6. 부트스트랩이 애플리케이션 반환 전에 실패한 경우에는 shutdown hook 이후 container dispose가 실행됩니다.

## Error States

- `ModuleGraphError`: 순환 import나 잘못된 imported module처럼 모듈 그래프 컴파일 또는 검증 단계에서 발생합니다.
- `ModuleVisibilityError`: provider, controller, 또는 module export가 현재 모듈에서 보이지 않는 토큰을 참조할 때 발생합니다.
- `ModuleInjectionMetadataError`: 생성자 주입 metadata가 필수 파라미터를 모두 설명하지 못할 때 발생합니다.
- 라이프사이클 훅 실패: `onModuleInit()` 또는 `onApplicationBootstrap()`의 rejection은 readiness 표시 전에 부트스트랩을 중단합니다.
- 어댑터 또는 플랫폼 시작 실패: platform shell과 dispatcher 실패는 공통 초기화를 reject합니다. 이후 listen 실패는 해당 listen을 reject하며, run helper는 앞에서 설명한 생성 이후 close 시도를 추가합니다.
- `InvariantError`: `FluoFactory.createMicroservice(...)`가 resolve된 런타임 토큰에서 `listen()` 구현을 찾지 못하면 발생합니다.
- 부트스트랩 실패 정리는 synthetic signal인 `bootstrap-failed`를 사용하며, 원래 오류를 다시 던지기 전에 shutdown hook과 container dispose를 실행합니다.

## Evidence

- [공통 helper 구현](../../packages/runtime/src/http-adapter-shared.ts)과 [테스트](../../packages/runtime/src/http-adapter-shared.test.ts): middleware, 완료 시점, 실패/signal cleanup.
- [Fastify 구현](../../packages/platform-fastify/src/adapter.ts)과 [테스트](../../packages/platform-fastify/src/adapter.test.ts): 숫자 검증, logging, listen, Node signal 연결.
- [Runtime bootstrap](../../packages/runtime/src/bootstrap.ts)과 [테스트](../../packages/runtime/src/bootstrap.test.ts): 공통 초기화와 실패 정리.
- [CLI scaffold](../../packages/cli/src/new/scaffold.ts)와 [테스트](../../packages/cli/src/new/scaffold.test.ts): 생성 import, 등록, script, port parser.
- [명시적 minimal 진입점](../../examples/minimal/src/main.ts), [FluoBlog checkpoint 진입점](../../examples/fluo-blog/00-start/src/main.ts), [Book 첫 애플리케이션](../../book/01-fluoblog/ch01-first-app.ko.md): 서로 다른 환경과 애플리케이션 정책.

지원되는 Node에서 의존성을 설치한 저장소 checkout을 기준으로 `pnpm docs:sync-check`는 웹사이트 counterpart 존재를, `pnpm exec vitest run --project tooling tooling/governance/verify-standard-decorator-docs.test.ts`는 기존 decorator 문서 검사를 수행합니다. 이 검사는 locale 의미, 네트워크 동작, 최신 배포 패키지 내용을 증명하지 않으며 실제 범위별 실행과 한계는 별도로 기록합니다.
