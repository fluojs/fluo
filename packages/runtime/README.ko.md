# @fluojs/runtime

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

모듈 그래프를 컴파일하고 DI와 HTTP를 실행 가능한 애플리케이션 셸로 연결하는 어셈블리 레이어입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [퀵 스타트](#퀵-스타트)
- [주요 패턴](#주요-패턴)
- [동작 계약](#동작-계약)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/runtime
```

## 사용 시점

다음과 같은 경우에 이 패키지를 사용합니다:
- **fluo 애플리케이션 부트스트랩**: 모듈을 실행 중인 HTTP 서버나 마이크로서비스로 변환할 때.
- **DI 및 라이프사이클 오케스트레이션**: 모듈 그래프 컴파일, 프로바이더 연결 및 애플리케이션 훅(`onModuleInit`, `onApplicationBootstrap`)을 관리할 때.
- **독립형 컨텍스트 생성**: HTTP 서버는 필요 없지만 DI가 필요한 CLI task, script 또는 worker를 실행할 때.
- **진단 및 검사**: CLI 내보내기를 위한 기계 읽기 가능한 플랫폼 snapshot과 diagnostic issue를 생산하되, 그래프 보기와 Mermaid 표현은 Studio에 맡길 때.

## 퀵 스타트

### 최소 HTTP 애플리케이션

`fluoFactory`는 애플리케이션 생성을 위한 주요 진입점입니다.

```typescript
import { Module } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { fluoFactory } from '@fluojs/runtime';
import { createNodejsAdapter } from '@fluojs/platform-nodejs';

@Controller('/')
class AppController {
  @Get()
  index() {
    return { hello: 'world' };
  }
}

@Module({
  controllers: [AppController],
})
class AppModule {}

// 애플리케이션 생성 및 시작
const app = await fluoFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
});

await app.listen();
```

## 주요 패턴

### 애플리케이션 컨텍스트 (HTTP 제외)

백그라운드 워커나 스크립트의 경우, `createApplicationContext`를 사용하여 HTTP 설정을 건너뛸 수 있습니다.

```typescript
import { fluoFactory } from '@fluojs/runtime';

const context = await fluoFactory.createApplicationContext(AppModule);

// 컨테이너에서 직접 서비스 해석
const userService = await context.get(UserService);
await userService.doWork();

await context.close();
```

### Studio Devtools Bridge

`@fluojs/runtime`은 live Studio snapshot과 request trace를 publish할 수 있지만 `process.env`를 직접 읽지 않습니다. `fluo dev --studio`가 애플리케이션 경계에서 sidecar를 시작하고 tokenized Studio config를 만든 뒤, 앱이 runtime을 import하기 전에 해당 명시적 config를 Node 앱 child에 주입합니다. CLI가 제공한 config가 없거나 잘못되었거나 tokenized endpoint가 없으면 Studio instrumentation은 no-op이며 bootstrap 동작은 바뀌지 않습니다.

이 MVP에서 전체 지원 대상은 Node dev runner 프로젝트입니다. Bun, Deno, Cloudflare Workers의 live Studio는 dedicated bridge를 구현하고 검증하기 전까지 unsupported입니다. 해당 런타임에서도 Studio config가 없으면 bootstrap은 no-op이어야 합니다. Request trace는 body, cookie, 전체 header를 의도적으로 제외하며, runtime은 local token이 Studio event history에 남지 않도록 publish 전에 trace `url`에서 query string과 fragment를 제거합니다.

### 전역 예외 필터

부트스트랩 시 필터를 등록하여 횡단 관심사 에러를 처리합니다.

```typescript
import { fluoFactory, type ExceptionFilterHandler } from '@fluojs/runtime';

class GlobalErrorFilter implements ExceptionFilterHandler {
  async catch(error, { response }) {
    console.error('에러 발생:', error);
    response.setStatus(500);
    void response.send({ error: 'Internal Server Error' });
    return true; // 처리됨으로 표시
  }
}

const app = await fluoFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
  filters: [new GlobalErrorFilter()],
});
```

### Framework-managed response와 handler-owned response

일반 request path는 framework-managed 방식입니다. Handler가 값을 반환하면 interceptor가 그 값을 변환할 수 있고, runtime response writer가 최종 결과를 commit합니다. `@fluojs/serialization`의 `SerializerInterceptor`가 반환 DTO에 적용되는 경로도 이 경로입니다.

고급 handler는 `RequestContext.response.send(...)`, `redirect(...)`, 또는 수동 streaming helper를 호출해 response ownership을 직접 가질 수 있습니다. Response가 commit되면 `SerializerInterceptor`는 등록된 경우 serialization을 우회하고 `next.handle()`에서 받은 값을 그대로 반환합니다. 이 동작이 chain 결과를 고정하지는 않으므로 다른 interceptor는 chain 결과를 계속 변환할 수 있습니다. 이와 별개로 dispatcher는 commit된 response를 확인하고 두 번째 success-response write를 건너뛰므로 최종 interceptor-chain 결과를 쓰지 않습니다. 따라서 직접 응답을 쓰는 코드는 commit 전에 안전한 최종 payload를 만들어야 하며 serializer가 이후에 형태를 바꿀 수 없습니다.

### 모듈 구성

fluo는 엄격한 모듈 그래프를 사용합니다. 모듈은 다른 모듈에서 사용할 프로바이더를 `export`를 통해 명시적으로 공개해야 합니다.

```typescript
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService], // 외부에서 사용 가능하도록 설정
})
class DatabaseModule {}

@Module({
  imports: [DatabaseModule],
providers: [UsersService], // UsersService가 DatabaseService를 주입받을 수 있음
})
class UsersModule {}
```

## 동작 계약

- 요청 바디 파싱은 Web 표준 요청과 Node 기반 요청 모두에서 바이트가 스트리밍되는 동안 `maxBodySize`를 강제합니다.
- `@fluojs/runtime/node`에서는 Node 요청 바디 파싱 전에 primary `content-type` media type을 normalize한 뒤 JSON 및 멀티파트 여부를 판단하므로, 대소문자가 섞인 JSON/멀티파트 헤더도 문서화된 파서 동작을 그대로 유지합니다.
- Node 기반 및 Web 표준 요청 wrapper는 바디 파싱 전에 저비용 요청 metadata를 snapshot으로 고정한 뒤 dispatch 경계에서 `body`/`rawBody`를 한 번 materialize하므로 userland는 계속 동기 parsed 값을 관찰합니다.
- Node 기반 쿠키/쿼리 값과 Web 표준 헤더는 요청 wrapper가 생성되는 시점에 snapshot으로 고정된 뒤 요청별로 lazy하게 normalize되고 memoize됩니다. 이후 upstream 객체가 변경되어도 `FrameworkRequest` view는 바뀌지 않습니다.
- Node 기반 request context ID는 `x-request-id`를 우선 사용하고, `x-request-id`가 없으면 `x-correlation-id`로 fallback합니다. 따라서 error response와 request-aware integration이 upstream correlation identifier를 유지합니다.
- `ApplicationContext.get()`과 `Application.get()`은 bootstrap 시점에 알려진 직접 root singleton class/factory provider 조회만 memoize하며, alias, request, transient, 종료 이후, multi-provider, `container.override()` 해석 의미는 그대로 유지합니다.
- `multi: true` provider token은 context cache에 memoize되지 않습니다. 각 `get()` 호출은 DI로 위임되어 컨테이너가 새로운 contribution 배열을 조립하며, 각 contribution 자체는 해당 provider scope에 따라 재사용됩니다.
- `duplicateProviderPolicy`가 `warn` 또는 `ignore`일 때 context cache 적격성과 lifecycle hook 실행은 bootstrap이 선택한 effective winning provider를 기준으로 결정됩니다. stale losing provider는 cache entry나 lifecycle hook을 만들지 않습니다.
- 모듈 그래프 컴파일은 cache key 생성이나 visibility 순회 전에 runtime provider와 `@Module(...)` provider 선언을 DI의 canonical normalization으로 검증합니다. 따라서 잘못된 `inject` 값, dependency wrapper/token, scope는 순회 단계 고유 오류를 노출하지 않고 `InvalidProviderError`로 실패합니다.
- 애플리케이션 또는 컨텍스트 bootstrap이 런타임 리소스나 lifecycle instance 생성 이후 실패하면 fluo는 readiness를 초기화하고, 등록된 runtime cleanup callback을 실행하며, 그 시점까지 해석된 instance의 shutdown hook을 `bootstrap-failed`로 호출하고, 컨테이너를 dispose하고, cleanup 실패를 로그로 남긴 뒤 원래 bootstrap error를 다시 던집니다.
- `Application.listen()`과 microservice `listen()`은 shutdown과 직렬화됩니다. 겹치는 startup 호출은 같은 in-flight startup을 공유하고, shutdown은 진행 중인 startup이 끝날 때까지 기다리며, shutdown과 경합한 startup은 close 시작 이후 shell을 다시 `ready`로 전이할 수 없습니다.
- 종료 시그널 등록 실패는 사용자가 관찰할 수 있습니다. `runNodeApplication(...)`, `bootstrapNodeApplication(...)`, adapter 소유 runtime helper는 이미 시작된 애플리케이션을 `bootstrap-failed`로 닫고, close 실패가 있으면 별도로 로그로 남기며, 원래 registration error로 reject합니다.
- 종료 시그널 등록 해제 실패는 애플리케이션 close를 건너뛰지 않습니다. `app.close()`는 항상 adapter shutdown, lifecycle hook, runtime cleanup callback, container dispose까지 계속 진행합니다. close 자체가 성공하면 unregistration error로 reject하고, close도 실패하면 두 실패를 모두 담은 aggregate로 reject합니다.
- 연결된 microservice는 부모 `Application`이 소유하는 child입니다. `startAllMicroservices()`는 순차적으로 시작하며 이후 child 시작이 실패하면 이미 시작된 child를 `bootstrap-failed`로 rollback하고, `Application.close(signal)`은 부모 lifecycle hook, adapter 종료, container dispose보다 먼저 연결된 child를 닫습니다.
- `FluoFactory.createMicroservice()`는 cleanup이 실패해도 원래 bootstrap/runtime 해석 오류를 보존하고 cleanup 실패는 별도로 로그로 남깁니다.
- Bootstrap은 독립적인 singleton lifecycle provider를 병렬로 해석한 뒤 lifecycle hook은 결정적인 provider 순서대로 실행합니다.
- 멀티파트 파싱은 누적 바디 크기가 설정된 `multipart.maxTotalSize`를 넘으면 즉시 거부되며, 런타임 어댑터는 별도 재정의가 없으면 이 한도를 `maxBodySize`와 동일하게 맞춥니다.
- `@fluojs/runtime/web` 멀티파트 파싱은 Node.js `Buffer` global 없이 Web 표준 `TextEncoder`와 `Uint8Array` primitive만 사용합니다. 업로드 파일의 `buffer` 값은 `Uint8Array`이며, Node 전용 consumer는 애플리케이션 경계에서 `Buffer.from(file.buffer)`로 명시적으로 변환할 수 있습니다.
- `createNodeHttpAdapter(...)`, `bootstrapNodeApplication(...)`, `runNodeApplication(...)`는 `maxBodySize`를 0 이상의 정수 바이트 수로만 받으며, 값이 잘못되면 어댑터 생성/부트스트랩 단계에서 즉시 실패합니다.
- 응답 스트림 백프레셔 헬퍼는 `drain`, `close`, `error` 중 어느 경우에도 `waitForDrain()`을 완료시켜 끊어진 연결에서 스트리밍 작성기가 멈추지 않도록 합니다.
- HTTP response writing은 단일 owner를 가집니다. Framework-managed handler 결과는 runtime이 commit하기 전에 interceptor가 변환할 수 있습니다. Handler나 response helper가 `RequestContext.response`를 commit한 뒤에는 dispatcher가 두 번째 success-response write를 건너뜁니다. `SerializerInterceptor`는 serialization을 우회하고 `next.handle()`에서 받은 값을 그대로 반환하지만, 다른 interceptor는 chain 결과를 계속 변환할 수 있습니다.
- 런타임 health 모듈은 bootstrap이 ready로 표시하기 전까지 `/ready`를 HTTP 503과 `starting`으로 보고하며, 애플리케이션/컨텍스트 종료가 시작되는 즉시, 종료 시도가 실패하더라도 다시 `starting`으로 내려갑니다.
- 런타임 health module readiness check는 현재 `RequestContext`를 받으므로, public integration이 internal runtime token을 import하지 않고도 runtime-exposed status provider를 해석할 수 있습니다.
- 시그널 기반 종료 헬퍼는 bounded drain semantics를 유지하면서 timeout/실패 상황을 로그와 `process.exitCode`로 보고하지만, 최종 프로세스 종료 소유권은 주변 호스트 런타임에 남겨 둡니다.
- 플랫폼 snapshot 및 diagnostic issue 생산은 런타임에 남아 있고, 그래프 보기, filtering 표현, Mermaid 렌더링은 CLI 및 자동화 호출자가 소비하는 Studio 소유 계약입니다.
- Runtime-connected Studio instrumentation은 명시적인 CLI 주입 Studio config로만 활성화되며 runtime package source에서 `process.env`를 직접 읽지 않습니다. 유효한 config와 tokenized endpoint가 없으면 non-Node 런타임을 포함해 Studio 관점의 runtime bootstrap은 no-op입니다.
- Studio request trace는 request/response body, cookie, 전체 header를 제외합니다. Trace `url`은 publish 전에 path-only 형태로 sanitize되어 query token과 fragment가 local Studio event history에 남지 않습니다.
- 플랫폼 component snapshot은 런타임 소유 계약 payload입니다. 각 component는 `readiness`, `health`, dependency id, telemetry tag, diagnostic issue, 그리고 `ownership.ownsResources` / `ownership.externallyManaged`를 통해 리소스 소유권을 보고합니다. Runtime은 shell snapshot에서 이 ownership flag를 보존하므로 adapter와 package integration이 fluo가 종료해야 하는 리소스와 host가 소유한 외부 관리 리소스를 구분할 수 있습니다.
- 모듈 그래프 컴파일 결과 캐시는 `moduleGraphCache: true`를 통한 opt-in입니다. 캐시 항목은 root module identity, runtime provider, validation token, module replacement pair, core metadata version, compile algorithm version으로 식별되며, 성공한 컴파일만 저장하고 호출자 mutation이 이후 bootstrap을 오염시키지 않도록 격리된 그래프 복사본을 반환합니다.
- `moduleReplacements`는 `bootstrapModule(...)` / `BootstrapModuleOptions`의 저수준 testing seam입니다. 원래 logical module identity를 보존하면서 replacement module metadata로 컴파일하고, replacement cycle은 일반 module graph validation 경로에서 거부하며, source module metadata를 mutate하지 않습니다.
- `raceWithAbort(fn, signal)`은 `fn`이 settle된 후 항상 abort listener를 제거합니다. `fn`이 promise를 반환하기 전에 동기적으로 throw하는 경우도 포함합니다. 동기 throw는 settled rejection으로 변환되어 cleanup-dependent `finally` flow가 여전히 실행되고, 반복된 실패 작업에서 listener가 leak되지 않습니다.

## 공개 API 개요

- `fluoFactory`: 패키지 예제에서 사용하는 런타임 부트스트랩 파사드의 lower-camel-case 별칭입니다.
- `FluoFactory`: 명시적 static 접근을 제공하는 클래스 기반 런타임 부트스트랩 파사드입니다.
- `Application`: `ApplicationContext`를 확장하며 `listen()`, `dispatch()`, `state`를 포함합니다.
- `ApplicationContext`: `get<T>(token)`, `close()` 기능을 제공하며 `container`, `modules`, bootstrap diagnostics에 접근할 수 있습니다.
- `LifecycleHooks`: `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, `OnApplicationShutdown`를 묶는 편의 union 타입입니다.
- `HealthModule.forRoot(options)`: bootstrap 및 shutdown 라이프사이클 전이에 맞춰 readiness marker를 관리하는 런타임 소유 `/health`, `/ready` 모듈 파사드입니다. `RuntimeHealthModule`을 반환하므로 first-party runtime-aware package가 internal runtime seam을 import하지 않고 `ReadinessCheck` function을 등록할 수 있습니다.
- `createHealthModule(options)`: 같은 런타임 health module 계약을 위한 deprecated compatibility helper입니다. 애플리케이션-facing module import에서는 `HealthModule.forRoot(...)`를 우선 사용하세요.
- `RuntimeHealthModule`: `HealthModule.forRoot(...)`가 반환하는 module class contract이며 `addReadinessCheck(...)`, `markReady()`, `markStarting()`을 포함합니다.
- `ReadinessCheck`: runtime health module이 사용하는 function type입니다. Check는 `/ready` request context를 받고 boolean 또는 promise를 반환합니다.
- `defineModule(cls, metadata)`: 프로그래밍 방식의 모듈 정의 헬퍼입니다.
- `bootstrapApplication(options)`: 저수준 비동기 부트스트랩 함수입니다.
- `bootstrapModule(...)`: 저수준 module graph bootstrap helper입니다. `BootstrapModuleOptions`에는 opt-in compile-result cache를 위한 `moduleGraphCache`와 authored module identity를 안정적으로 유지하는 testing-only module replacement compilation을 위한 `moduleReplacements` / `ModuleReplacementMap`이 포함됩니다.
- `createBootstrapTimingDiagnostics(...)`, `createRuntimeDiagnosticsGraph(...)`: CLI/support tooling을 위한 runtime 소유 diagnostics snapshot helper입니다. 이 helper들은 기계 읽기 가능한 데이터를 생산하며, Studio가 viewer parsing, graph presentation, Mermaid rendering을 소유합니다.
- `PlatformShell`, `PlatformComponent`, `PlatformShellSnapshot`, `PlatformSnapshot`, `PlatformDiagnosticIssue` 및 관련 platform report 타입: runtime-aware package가 사용하는 공개 lifecycle diagnostics 및 resource-ownership 계약입니다. `RuntimePlatformShell`은 component가 제공한 ownership을 보존하고, consumer가 internal runtime token을 import하지 않아도 validation/readiness/health diagnostics를 내보냅니다.
- `createRequestAbortContext(...)`, `trackActiveRequestTransaction(...)`, `untrackActiveRequestTransaction(...)`: runtime-aware integration이 사용하는 request abort 및 active transaction helper입니다.
- `UploadedFile`: 메모리 내 `buffer` payload를 Web 표준 `Uint8Array`로 제공하는 runtime-neutral 멀티파트 파일 descriptor입니다.

## 플랫폼 전용 서브경로

애플리케이션-facing 런타임 헬퍼에는 `@fluojs/runtime/node`와 `@fluojs/runtime/web`를 사용하세요. 공개된 `internal*` 서브경로는 first-party adapter와 runtime-aware package를 위한 package-integration seam으로 예약되어 있습니다. 이 표는 패키지 작성자가 경계를 식별할 수 있도록 문서화하지만, 해당 seam을 애플리케이션 수준 helper 계약으로 취급하지는 않습니다.

| 서브경로 | 용도 |
| :--- | :--- |
| `@fluojs/runtime/node` | 로거 팩토리, Node 어댑터/부트스트랩 헬퍼, 종료 시그널 등록을 위한 지원되는 Node.js 전용 진입점입니다. |
| `@fluojs/runtime/web` | Bun, Deno, Cloudflare Workers를 위한 공유 Web 표준 요청/응답 유틸리티입니다. `createWebRequestResponseFactory`, `dispatchWebRequest`, `createWebFrameworkRequest`, `parseMultipart`를 포함합니다. |
| `@fluojs/runtime/internal` | runtime wiring token과, compiled module graph의 provider scope와 정렬되어야 하는 first-party adapter가 사용하는 runtime-owned class metadata reader를 위한 internal package-integration seam입니다. |
| `@fluojs/runtime/internal-node` | adapter/runtime plumbing을 위한 Node 전용 internal seam이며, 애플리케이션 코드에서는 `@fluojs/runtime/node`를 우선 사용하세요. |
| `@fluojs/runtime/internal/http-adapter` | platform package를 위한 internal HTTP adapter seam입니다. |
| `@fluojs/runtime/internal/request-response-factory` | platform package를 위한 internal request/response factory seam입니다. |

### Node 전용 서브경로 (`@fluojs/runtime/node`)

로거 팩토리와 지원되는 기타 Node 전용 헬퍼는 범용 루트 진입점에 포함되지 않습니다. `./node` 서브경로에서 가져오세요:

```typescript
import {
  bootstrapNodeApplication,
  createConsoleApplicationLogger,
  createJsonApplicationLogger,
  createNodeHttpAdapter,
  runNodeApplication,
} from '@fluojs/runtime/node';
```

```typescript
const adapter = createNodeHttpAdapter({
  port: 3000,
  maxBodySize: 1_048_576,
});
```

공개 Node 런타임 surface에서 `maxBodySize`, `retryDelayMs`, `retryLimit`, `shutdownTimeoutMs`는 숫자로 표현된 0 이상의 정수만 허용합니다. `'1mb'`, 소수 retry 횟수, 음수 shutdown timeout 같은 값은 나중에 암묵 변환되지 않고 어댑터 생성 시점에 즉시 거부됩니다. Node request context ID는 `x-request-id`를 우선 사용하며, 없으면 `x-correlation-id`를 runtime error response와 request-aware integration의 request ID fallback으로 사용합니다.

- `createConsoleApplicationLogger()`: `process.stdout`/`process.stderr`를 사용하는 컬러 콘솔 로거입니다. 기본값은 pretty 형식입니다. 더 간결한 `[fluo] LEVEL [context] message` 줄을 원하면 `{ mode: 'minimal' }`, 런타임 로거 출력을 숨기려면 `{ mode: 'silent' }`, 낮은 심각도 메시지를 걸러내려면 `{ level: 'warn' }` 같은 threshold, 결정적인 비컬러 출력을 원하면 `{ color: false }`를 전달하세요.
- `createJsonApplicationLogger()`: `process.stdout`/`process.stderr`를 사용하는 구조화된 JSON 로거.
- `createNodeHttpAdapter()`: 어댑터 우선 런타임 구성을 위한 raw Node `http`/`https` 어댑터 팩토리입니다. primary Node 요청 `content-type`을 JSON/멀티파트 판별 전에 normalize하며, `maxBodySize`, `retryDelayMs`, `retryLimit`, `shutdownTimeoutMs`는 0 이상의 정수만 받습니다.
- `bootstrapNodeApplication()` / `runNodeApplication()`: 직접 Node runtime flow에서 사용하는 Node 전용 부트스트랩 헬퍼.
- `createNodeShutdownSignalRegistration()`, `defaultNodeShutdownSignals()`, `registerShutdownSignals()`: 호스트가 명시적으로 시그널 wiring을 제어할 때 쓰는 종료 등록 헬퍼.

런타임 애플리케이션 로깅은 CLI lifecycle reporting과 별개입니다. 애플리케이션/런타임 자체가 내는 로그를 바꾸고 싶을 때 `ApplicationLogger`를 설정하세요:

```typescript
import { createConsoleApplicationLogger, createJsonApplicationLogger } from '@fluojs/runtime/node';

const minimalLogger = createConsoleApplicationLogger({ mode: 'minimal', level: 'warn' });
const jsonLogger = createJsonApplicationLogger();
```

개발 명령의 raw child-process 출력이 필요하면 대신 `fluo dev --verbose` 같은 CLI reporter flag를 사용하세요.

더 저수준의 Node compression internals는 공개 `@fluojs/runtime/node` 계약이 아니라 `@fluojs/runtime/internal-node` seam 뒤에 둡니다.

## 관련 패키지

- [@fluojs/core](../core): 핵심 데코레이터 및 메타데이터 시스템.
- [@fluojs/di](../di): 의존성 주입(DI) 컨테이너 구현체.
- [@fluojs/http](../http): HTTP 라우팅, 컨트롤러 및 디스패처.
- [@fluojs/serialization](../serialization): Framework-managed 상태로 아직 commit되지 않은 HTTP handler 결과를 decorator metadata에 따라 shaping합니다.
- [@fluojs/platform-nodejs](../platform-nodejs): 공식 Node.js HTTP 어댑터.
- [@fluojs/studio](../studio): 런타임이 생산한 snapshot과 diagnostic issue를 위한 viewer, filtering, rendering helper.

## 예제 소스

- [examples/minimal](../../examples/minimal): 최소한의 부트스트랩 예제.
- [examples/realworld-api](../../examples/realworld-api): 복잡한 모듈 연결이 포함된 전체 애플리케이션 예제.
- [packages/runtime/src/bootstrap.test.ts](./src/bootstrap.test.ts): 부트스트랩 단계별 동작 테스트.
