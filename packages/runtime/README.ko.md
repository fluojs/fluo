# @konekti/runtime

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


모듈 그래프를 컴파일하고 DI, HTTP를 실행 가능한 애플리케이션 셸(shell)로 연결하는 조립 레이어입니다.

## 관련 문서

- `../../docs/concepts/architecture-overview.ko.md`
- `../../docs/concepts/lifecycle-and-shutdown.ko.md`
- `../../docs/concepts/observability.ko.md`

## 이 패키지가 하는 일

`@konekti/runtime`은 오케스트레이션(orchestration) 레이어입니다. 기능 패키지가 아니며, 다음과 같은 작업을 수행하여 모듈을 실행 중인 앱으로 변환합니다.

1. 모듈 그래프 컴파일: `imports`/`exports` 가시성(visibility)을 검증하고, 순환 참조(circular imports)를 감지하며, 해결된 모든 토큰이 접근 가능한지 확인합니다.
2. 루트 DI 컨테이너를 생성하고 모든 프로바이더와 컨트롤러를 등록합니다.
3. 싱글톤 프로바이더를 해결(resolve)하고 생명주기 훅(lifecycle hooks)을 실행합니다 (`onModuleInit` → `onApplicationBootstrap`).
4. `@konekti/http`에서 `createHandlerMapping()`과 `createDispatcher()`를 호출합니다.
5. `dispatch()`, `listen()`, `ready()`, `close()`를 포함하는 `KonektiApplication` 셸을 반환합니다.

`KonektiFactory`는 canonical public startup facade입니다. HTTP 앱의 기본 흐름은 `const app = await KonektiFactory.create(AppModule, { ...options }); await app.listen();`이며, `@konekti/platform-fastify`나 `@konekti/platform-express` 같은 트랜스포트 패키지를 선택할 때는 `options.adapter`를 전달합니다.

트랜스포트가 SSE 또는 기타 스트리밍 HTTP 응답 본문을 지원하면, 런타임이 관리하는 어댑터는 `FrameworkResponse.stream`도 노출할 수 있습니다.

## 설치

```bash
npm install @konekti/runtime
```

### 0.x 마이그레이션 노트

- Node 전용 시작 헬퍼는 `@konekti/runtime` 루트 배럴에서 분리되었습니다. `createNodeHttpAdapter`, `bootstrapNodeApplication`, `runNodeApplication`은 `@konekti/runtime/node`에서 import 하세요.
- transport 지향 multipart 파싱은 더 이상 `@konekti/runtime` 루트 배럴에서 export 되지 않습니다. 공유 Web/fetch-style 파싱 헬퍼는 이제 `@konekti/runtime/web` 아래에 있습니다.
- 공유 어댑터 부트스트랩은 더 이상 Node 전역 shutdown 등록을 암묵적으로 import 하지 않습니다. 공유 어댑터 헬퍼를 조합하는 런타임은 shutdown signal 연결을 명시적으로 제공해야 하며, `@konekti/runtime/node`는 기존 `SIGTERM` / `SIGINT` 동작을 계속 유지합니다.
- `@konekti/runtime/internal`은 이제 프레임워크 내부 wiring 토큰으로 범위를 줄였습니다. 공유 어댑터 부트스트랩 헬퍼는 `@konekti/runtime/internal/http-adapter`, 요청/응답 팩토리 헬퍼는 `@konekti/runtime/internal/request-response-factory`로 이동했습니다.
- Node 전용 응답 압축은 더 이상 `@konekti/runtime` 루트 배럴에서 export 되지 않습니다. transport 소유 응답 작성기는 어댑터 지향 `FrameworkResponse.compression` seam을 사용해야 하며, 명시적인 zlib 압축이 계속 필요한 Node 런타임은 `@konekti/runtime/node`에서 `createNodeResponseCompression` / `compressNodeResponse`를 import 하세요.
- 이제 fetch 스타일 런타임은 `@konekti/runtime/web`에서 `createWebRequestResponseFactory`, `createWebFrameworkRequest`, `dispatchWebRequest`를 import 하여 Bun, Deno, Cloudflare Workers 어댑터 전반에 걸쳐 native Web `Request` / `Response` 브리징을 공유할 수 있습니다.

## 빠른 시작

### 최소 Node.js 앱

```typescript
import { Module, Global } from '@konekti/core';
import { KonektiFactory } from '@konekti/runtime';
import { Controller, Get } from '@konekti/http';
import type { RequestContext } from '@konekti/http';

@Controller('/health')
class HealthController {
  @Get('/')
  check(_: never, ctx: RequestContext) {
    return { status: 'ok' };
  }
}

@Module({ controllers: [HealthController] })
class AppModule {}

const app = await KonektiFactory.create(AppModule);
await app.listen();
```

### Adapter-first 시작 경로 (Express 예시)

```typescript
import { createExpressAdapter } from '@konekti/platform-express';
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule, {
  adapter: createExpressAdapter({ port: 3000 }),
});

await app.listen();
```

`@konekti/platform-fastify`, `@konekti/platform-express`처럼 트랜스포트 패키지를 사용할 때는 위 adapter-first 형태를 사용하세요. canonical startup path는 계속 `KonektiFactory.create(...)`이며, 트랜스포트별 `run*Application()` 헬퍼는 호환/고급 경로로 유지됩니다.

### global request converters

HTTP 앱에서는 사용자가 실제로 호출하는 런타임 entrypoint를 통해 transport-wide request converter를 등록합니다.

```typescript
import { KonektiFactory } from '@konekti/runtime';

class TrimStringConverter {
  convert(value: unknown) {
    return typeof value === 'string' ? value.trim() : value;
  }
}

const app = await KonektiFactory.create(AppModule, {
  converters: [TrimStringConverter],
  port: 3000,
});

await app.listen();
```

이 converter는 HTTP 바인딩 concern입니다. 각 바인딩 필드마다 적용되며 DTO validation 전에 실행됩니다.

### 고급 부트스트랩 + 수동 listen

```typescript
import { bootstrapApplication } from '@konekti/runtime';

const app = await bootstrapApplication({
  rootModule: AppModule,
});

await app.listen();
console.log('Listening');

// 수동으로 요청 디스패치 (예: 테스트에서)
await app.dispatch(req, res);

// 정상 종료
await app.close();
```

### 독립형 애플리케이션 컨텍스트 (HTTP 어댑터 없음)

```typescript
import { KonektiFactory } from '@konekti/runtime';

const context = await KonektiFactory.createApplicationContext(AppModule);

const service = await context.get(UserService);

// ...CLI 작업, 마이그레이션, 시드(seed) 또는 워커(worker) 로직 실행

await context.close();
```

`createApplicationContext()`는 HTTP 디스패처/어댑터를 생성하지 않고 모듈 그래프와 생명주기 훅만 부트스트랩합니다. CLI 스크립트, 백그라운드 워커, 마이그레이션, 그리고 DI만 필요한 테스트에 사용하세요.

### 런타임 진단 그래프 + 부트스트랩 타이밍

```typescript
import {
  KonektiFactory,
  createRuntimeDiagnosticsGraph,
  renderRuntimeDiagnosticsMermaid,
} from '@konekti/runtime';

const context = await KonektiFactory.createApplicationContext(AppModule, {
  diagnostics: { timing: true },
});

const graph = createRuntimeDiagnosticsGraph(context.modules, context.rootModule);
console.log(JSON.stringify(graph, null, 2));
console.log(renderRuntimeDiagnosticsMermaid(graph));
console.log(context.bootstrapTiming); // diagnostics.timing이 true일 때만 채워짐

await context.close();
```

`createRuntimeDiagnosticsGraph()`는 `CompiledModule[]`를 기준으로 버전 고정(`version: 1`)된 기계 판독용 모듈 그래프를 생성합니다. 여기에는 모듈 import/export 관계, 프로바이더/토큰 소속, 프로바이더 scope/type 주석, 컨트롤러 소속 관계가 포함됩니다. `renderRuntimeDiagnosticsMermaid()`는 빠른 구조 확인을 위한 모듈 레벨 Mermaid 그래프를 출력합니다.

### 마이크로서비스 팩토리 (비 HTTP 트랜스포트)

```typescript
import { Module } from '@konekti/core';
import { KonektiFactory } from '@konekti/runtime';
import { MessagePattern, MicroservicesModule, TcpMicroserviceTransport } from '@konekti/microservices';

class MathHandler {
  @MessagePattern('math.sum')
  sum(input: { a: number; b: number }) {
    return input.a + input.b;
  }
}

@Module({
  imports: [MicroservicesModule.forRoot({ transport: new TcpMicroserviceTransport({ port: 4001 }) })],
  providers: [MathHandler],
})
class AppModule {}

const microservice = await KonektiFactory.createMicroservice(AppModule);
await microservice.listen();
```

`createMicroservice()`는 HTTP 어댑터 없이 모듈 그래프를 부트스트랩하고, 구성된 마이크로서비스 런타임 토큰을 해결하며, 트랜스포트 생명주기 제어를 위한 `listen()` + `close()`를 노출합니다.

### 하이브리드 구성 (한 프로세스 내 HTTP + 마이크로서비스)

```typescript
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule);
await app.connectMicroservice();
await app.startAllMicroservices();
await app.listen();
```

### 로우(Raw) 웹훅 바디 (선택 사항)

```typescript
import { Controller, Post, type RequestContext } from '@konekti/http';
import { KonektiFactory } from '@konekti/runtime';

@Controller('/webhooks')
class WebhookController {
  @Post('/stripe')
  verify(_input: undefined, context: RequestContext) {
    const rawBody = context.request.rawBody;

    if (!rawBody) {
      throw new Error('rawBody must be enabled for signature verification.');
    }

    const signature = context.request.headers['stripe-signature'];
    return verifyStripeSignature(rawBody, signature);
  }
}

const app = await KonektiFactory.create(AppModule, {
  rawBody: true,
});

await app.listen();
```

`rawBody`는 선택 사항(opt-in)이며 파싱된 `request.body`와 함께 원래의 요청 바이트를 보존합니다. 내장 Node 어댑터와 Fastify/Express 플랫폼 어댑터는 이를 JSON/텍스트 같은 멀티파트가 아닌 바디에 적용하며, 옵션이 비활성화되어 있거나 요청이 멀티파트 파싱을 사용하는 경우에는 `request.rawBody`를 설정하지 않습니다.

### 호스트 바인딩 및 HTTPS

```typescript
import { readFileSync } from 'node:fs';

const app = await KonektiFactory.create(AppModule, {
  host: '127.0.0.1',
  https: {
    cert: readFileSync('./certs/dev.crt'),
    key: readFileSync('./certs/dev.key'),
  },
  port: 8443,
});

await app.listen();
```

`host`가 설정되면 Node 어댑터는 기본 인터페이스 바인딩 대신 해당 호스트에 명시적으로 바인딩합니다. `https`가 제공되면 어댑터는 HTTPS 서버를 시작하고 시작 로그에 `https://...` URL을 보고합니다. 공개 URL이 실제 바인딩 대상과 다른 경우 시작 로그에 두 URL이 모두 포함됩니다. `https` 객체는 Node의 `node:https.createServer`로 전달되므로 호출자는 `key`와 `cert` 같은 유효한 TLS 자료를 제공해야 합니다.

### 애플리케이션 라우트를 위한 글로벌 접두사(Prefix)

```typescript
const app = await KonektiFactory.create(AppModule, {
  globalPrefix: '/api',
  globalPrefixExclude: ['/internal/*'],
});

await app.listen();
```

`globalPrefix`는 모든 라우트에 기본적으로 적용되므로, `/app/info`와 같은 컨트롤러 라우트는 `/api/app/info`가 되고 `/health` 같은 런타임 소유 엔드포인트도 `/api/health`가 됩니다. 특정 경로를 접두사 없이 유지하려면 `globalPrefixExclude`를 사용하세요.

`globalPrefixExclude`는 `/internal/ping`과 같은 정확한 경로와 `/internal/*`과 같은 후행 `/*` 패턴을 지원합니다. 런타임은 매칭 전에 중복된 슬래시와 후행 슬래시를 정규화하며, `globalPrefix: '/'`는 아무런 동작을 하지 않는 것(no-op)으로 처리합니다. 이전 운영 엔드포인트 동작을 유지하려면 `globalPrefixExclude: ['/health', '/ready', '/openapi.json', '/docs', '/metrics']`를 명시적으로 전달하세요.

### 글로벌 예외 필터

```typescript
import { NotFoundException } from '@konekti/http';
import type { ExceptionFilterHandler } from '@konekti/runtime';

class DomainExceptionFilter implements ExceptionFilterHandler {
  catch(error, context) {
    if (error instanceof UserNotFoundError) {
      context.response.setStatus(404);
      void context.response.send({ message: error.message });
      return true;
    }

    return undefined;
  }
}

const app = await KonektiFactory.create(AppModule, {
  filters: [new DomainExceptionFilter()],
});

await app.listen();
```

`filters`는 핸들러, 가드, 인터셉터 또는 미들웨어에서 예외가 발생할 때 순서대로 실행되는 글로벌 예외 필터를 등록합니다. 응답을 작성한 후 체인을 중단하려면 `true`를 반환하고, 다음 필터로 넘어가서 최종적으로 내장 HTTP 예외 직렬화기(serializer)에 도달하게 하려면 `undefined`를 반환하세요.

### 중복 프로바이더 진단

```typescript
await bootstrapApplication({
  duplicateProviderPolicy: 'throw',
  rootModule: AppModule,
});
```

`duplicateProviderPolicy`는 부트스트랩 중에 여러 모듈이 동일한 프로바이더 토큰을 등록할 때 발생하는 상황을 제어합니다. 로그를 남기고 계속하려면 `'warn'`, `DuplicateProviderError`로 즉시 실패하게 하려면 `'throw'`, 기존의 마지막 등록 우선 동작을 유지하려면 `'ignore'`를 사용하세요.

### 버전 관리 전략

```typescript
import { Controller, Get, Version, VersioningType } from '@konekti/http';
import { runNodeApplication } from '@konekti/runtime/node';

@Version('1')
@Controller('/users')
class UsersController {
  @Get('/')
  listUsers() {
    return [];
  }
}

await runNodeApplication(AppModule, {
  versioning: {
    header: 'X-API-Version',
    type: VersioningType.HEADER,
  },
});
```

런타임은 네 가지 버전 관리 전략을 지원합니다.

- `VersioningType.URI` (기본값): `/v1/users`
- `VersioningType.HEADER`: 구성된 헤더에서 읽음
- `VersioningType.MEDIA_TYPE`: `v=`와 같은 키를 사용하여 `Accept` 파싱
- `VersioningType.CUSTOM`: 커스텀 추출 함수 사용

`@Version()` 데코레이터 사용법은 전략에 관계없이 동일합니다. `versioning`이 생략된 경우 URI 버전 관리가 기본값으로 유지됩니다.

### 임포트(imports) 및 익스포트(exports)가 포함된 모듈

```typescript
import { Module } from '@konekti/core';
import { PrismaModule } from '@konekti/prisma';

@Module({
  imports: [PrismaModule.forRoot({ client: prismaClient })],
  providers: [UserService, UserRepository],
  controllers: [UserController],
  exports: [UserService],
})
export class UsersModule {}

@Module({
  imports: [UsersModule],
  // UsersModule이 UserService를 익스포트하므로 주입 가능
})
export class AppModule {}
```

### 런타임 소유 플랫폼 셸 등록

```typescript
import type { PlatformComponent } from '@konekti/runtime';

const redisComponent: PlatformComponent = createRedisPlatformComponent();
const queueComponent: PlatformComponent = createQueuePlatformComponent();

const app = await KonektiFactory.create(AppModule, {
  platform: {
    components: [
      { component: redisComponent, dependencies: [] },
      { component: queueComponent, dependencies: ['redis.default'] },
    ],
  },
});

await app.listen();
```

런타임은 컴포넌트 ID/의존성 엣지를 검증하고, 부트스트랩 시 의존성 순서대로 컴포넌트를 시작하며, 종료 시 역순으로 중지합니다. 이제 `listen()`은 이 런타임 소유 플랫폼 셸의 critical readiness를 강제합니다.

## 주요 API

| 익스포트(Export) | 위치 | 설명 |
|---|---|---|
| `KonektiFactory.create(rootModule, options)` | `src/bootstrap.ts` | canonical HTTP 애플리케이션 진입점 — `Application` 반환 |
| `@konekti/runtime/node` → `runNodeApplication(rootModule, options)` | `src/node.ts` | Node 부트스트랩 + listen + 종료 wiring을 위한 호환 래퍼 |
| `@konekti/runtime/node` → `bootstrapNodeApplication(rootModule, options)` | `src/node.ts` | Node 기본값으로 부트스트랩만 수행 (수신 없음) |
| `@konekti/runtime/web` → `dispatchWebRequest({ request, dispatcher, ... })` | `src/web.ts` | native Web `Request`를 프레임워크 계약으로 변환하고 native Web `Response`를 반환하는 공유 fetch-style 어댑터 진입점 |
| `@konekti/runtime/web` → `createWebRequestResponseFactory(options)` | `src/web.ts` | Bun, Deno, Cloudflare Worker 스타일 어댑터를 위한 공유 request/response factory seam |
| `bootstrapApplication(options)` | `src/bootstrap.ts` | 일반적인 부트스트랩 — `Application` 반환 |
| `PlatformOptionsBase`, `PlatformComponent`, `PlatformComponentRegistration`, `PlatformState`, `PlatformValidationResult`, `PlatformReadinessReport`, `PlatformHealthReport`, `PlatformDiagnosticIssue`, `PlatformSnapshot`, `PlatformShellSnapshot`, `PlatformShell` | `src/platform-contract.ts` | 런타임, CLI, Studio 정렬 툴링에서 공유하는 플랫폼 계약 spine 타입. |
| `PLATFORM_SHELL` | `src/tokens.ts` | 현재 플랫폼 셸 오케스트레이터와 snapshot/report API를 노출하는 런타임 토큰. |
| `createRuntimeDiagnosticsGraph(modules, rootModule)` | `src/diagnostics.ts` | 컴파일된 모듈에서 버전 고정 런타임 진단 그래프 내보내기 |
| `renderRuntimeDiagnosticsMermaid(graph)` | `src/diagnostics.ts` | 진단 페이로드에서 모듈 레벨 Mermaid 그래프 텍스트 생성 |
| `KonektiFactory.createApplicationContext(rootModule, options)` | `src/bootstrap.ts` | HTTP 런타임 없이 DI/생명주기 컨텍스트 부트스트랩 |
| `KonektiFactory.createMicroservice(rootModule, options)` | `src/bootstrap.ts` | DI/생명주기 컨텍스트를 부트스트랩하고 트랜스포트 기반 마이크로서비스 런타임 연결 |
| `bootstrapModule(rootModule, options)` | `src/bootstrap.ts` | 하위 레벨 부트스트랩 기준선: 모듈 그래프를 컴파일하고 런타임/모듈 프로바이더를 포함한 루트 컨테이너를 초기화 |
| `defineModule(cls, metadata)` | `src/bootstrap.ts` | 데코레이터 없이 모듈 메타데이터를 연결하는 하위 레벨 헬퍼 |
| `Application` | `src/types.ts` | 인터페이스: `container`, `modules`, `rootModule`, `state`, `dispatcher`, `dispatch()`, `ready()`, `listen()`, `close()` |
| `@Module(metadata)` | `@konekti/core` | 모듈 프로바이더, 컨트롤러, 임포트, 익스포트 선언 |
| `@Global()` | `@konekti/core` | 모듈을 전역적으로 가시성 있게 표시 |

`@konekti/runtime` 루트 배럴은 의도적으로 transport-neutral 경계를 유지합니다. Node 부트스트랩/종료 헬퍼는 `@konekti/runtime/node`, `dispatchWebRequest()` / `parseMultipart()` 같은 공유 fetch-style 요청/응답 헬퍼는 `@konekti/runtime/web`에서 import 하세요. `@konekti/runtime/internal`은 이제 프레임워크 내부 wiring 토큰(`RUNTIME_CONTAINER`, `COMPILED_MODULES`, `HTTP_APPLICATION_ADAPTER`, `APPLICATION_LOGGER`, `PLATFORM_SHELL`) 전용이며, transport 헬퍼 seam은 명시적인 internal 서브패스로 분리되었습니다.

## 아키텍처

### 부트스트랩 흐름

```text
KonektiFactory.create(options)  [또는 bootstrapApplication]
  → compileModuleGraph()
      → 임포트/익스포트 가시성 검증
      → 순환 참조 감지
      → 모든 프로바이더 + 컨트롤러 수집
  → 루트 컨테이너(Container) 생성 (@konekti/di)
  → 부트스트랩 레벨 프로바이더 등록
  → 모듈 프로바이더 + 컨트롤러 등록
  → 싱글톤 인스턴스 해결(resolve)
  → onModuleInit 훅
  → onApplicationBootstrap 훅
  → createHandlerMapping()     (@konekti/http)
  → createDispatcher()         (@konekti/http)
  → KonektiApplication 반환
```

### 모듈 그래프 컴파일은 순회가 아닌 증명입니다

`compileModuleGraph()`는 노드를 방문하는 것 이상의 역할을 합니다. 다음을 검증합니다.
- 컨트롤러나 서비스가 필요한 모든 프로바이더 토큰에 접근 가능한지 (로컬, 익스포트된 모듈로부터 임포트됨, 또는 글로벌)
- 모듈이 소유하지 않았거나 재익스포트할 수 없는 토큰을 익스포트하려고 하지 않는지
- 순환 `imports` 체인이 존재하지 않는지

이 중 하나라도 실패하면 프로바이더가 인스턴스화되기 전에 부트스트랩이 예외를 발생시킵니다. 이는 의도적인 설계 선택입니다. 깨진 앱은 첫 번째 요청에서 조용히 실패하는 것이 아니라 시작 시 명확하게 실패하게 됩니다.

### 복구 지향 오류 출력

모든 부트스트랩/모듈 그래프 오류는 어떤 문제가 어디서 왜 발생했고, 어떻게 복구해야 하는지 설명하는 구조화된 컨텍스트 필드를 포함합니다. 오류 메시지에는 다음이 덧붙습니다.

- **Module** — 오류가 감지된 모듈
- **Token** — 관련된 토큰(해당 시)
- **Phase** — 부트스트랩 단계 (예: `module graph compilation`, `provider visibility validation`, `export validation`, `provider registration`)
- **Hint** — 권장 복구 방법

오류는 동일한 필드를 가진 기계 판독 가능한 `meta` 객체도 포함하므로 구조화 로깅/모니터링에도 활용할 수 있습니다.

### 생명주기 훅 순서

```text
시작: onModuleInit → onApplicationBootstrap
종료: onModuleDestroy (역순) → onApplicationShutdown (역순)
```

요청 스코프(Request-scoped) 및 트랜지언트(transient) 프로바이더는 생명주기 훅에서 제외되며, 싱글톤 스코프 프로바이더만 참여합니다.

### KonektiApplication은 얇은 셸(shell)입니다

`KonektiApplication`은 런타임의 어떤 부분도 재구현하지 않습니다. 조립된 설정, 컨테이너, 디스패처에 대한 참조를 유지하며 상태 전이를 관리합니다: `부트스트랩됨` → `준비됨` → `닫힘`.

추가적인 루트 공개 익스포트에는 `KonektiFactory`, `createHealthModule`, `createConsoleApplicationLogger`, `createJsonApplicationLogger`, `APPLICATION_LOGGER`, `PLATFORM_SHELL`, `raceWithAbort`, `createAbortError`와 같은 헬퍼들이 포함됩니다. 공유 multipart 및 fetch-style 요청/응답 헬퍼는 `@konekti/runtime/web`, Node 전용 헬퍼는 `@konekti/runtime/node`에 위치합니다.

`@konekti/runtime/web` 서브패스는 fetch 스타일 어댑터 작업을 transport-neutral하게 유지합니다. native Web `Request`를 `FrameworkRequest`로 변환하고, 기존 raw-body/multipart/error-envelope 계약을 유지하며, `FrameworkResponse.stream`을 Web Stream 기반 capability로 노출하고, 프레임워크 응답 쓰기를 다시 native Web `Response`로 마무리합니다.

`createHealthModule()`은 런타임 소유의 활성/준비 상태 쌍을 노출합니다. `/health`는 `200 { status: 'ok' }`를 반환하는 활성(liveness) 엔드포인트이며, `/ready`는 시작 상태와 등록된 준비 상태 확인(readiness checks) 결과를 `starting`, `ready`, `unavailable` 상태로 반영합니다.

### `@konekti/runtime/node`로 격리된 Node 시작 관심사

`@konekti/runtime/node` 서브패스는 transport-agnostic 런타임 루트 밖에서 Node 전용 시작 세부사항을 묶습니다.
- HTTP 어댑터 생성 및 바인딩
- 선택적인 Node 소유 응답 압축 헬퍼 (`createNodeResponseCompression`, `compressNodeResponse`)
- 기본 CORS 미들웨어
- 런타임 옵션(`port`, 기본 `3000`)으로 포트 결정
- 시작 로그
- Node 소유 시작 경로를 위한 명시적 `SIGTERM`/`SIGINT` → `app.close()` 등록
- 요청 중단 시그널 → `FrameworkRequest.signal` 브리지

Node 어댑터는 종료 시 새로운 연결 수락을 중단하고, 시작된 요청들을 정해진 시간 동안 드레인(drain)하며, 유휴 상태의 keep-alive 연결을 닫고, 종료 타임아웃이 만료되면 남은 연결들을 강제로 종료합니다. 기본 10초 드레인 윈도우를 변경하려면 `@konekti/runtime/node` 부트스트랩 옵션의 `shutdownTimeoutMs`를 사용하세요.

## 기여자를 위한 파일 읽기 순서

1. `packages/core/src/decorators.ts` — `@Module()`, `@Global()` 메타데이터 작성자
2. `src/types.ts` — `Application` 인터페이스, 모듈 메타데이터 형태
3. `src/errors.ts` — 부트스트랩 오류 유형
4. `src/bootstrap.ts` — `compileModuleGraph`, `bootstrapModule`, `bootstrapApplication`
5. `src/node.ts` — `bootstrapNodeApplication`, `runNodeApplication`
6. `src/bootstrap.test.ts` — 모듈 그래프 컴파일, 가시성/익스포트 규칙
7. `src/application.test.ts` — 생명주기 훅, 종료 경로, 부트스트랩 실패 시 되돌리기(unwind)

## 관련 패키지

- `@konekti/di` — `bootstrapModule`이 프로바이더를 등록하는 `Container`
- `@konekti/http` — `bootstrapApplication`에 의해 호출되는 `createHandlerMapping`과 `createDispatcher`

## 한 줄 멘탈 모델

```text
@konekti/runtime = 메타데이터로 검증된 모듈 그래프 → 조립된 DI/HTTP 애플리케이션 셸
```
