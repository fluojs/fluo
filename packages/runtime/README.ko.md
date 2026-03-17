# @konekti/runtime

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


module graph을 컴파일하고 config, DI, HTTP를 실행 가능한 application shell로 연결하는 조립 레이어.

## 관련 문서

- `../../docs/concepts/architecture-overview.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/concepts/observability.md`

## 이 패키지가 하는 일

`@konekti/runtime`은 orchestration 레이어다. 기능 패키지가 아니라 모듈을 실행 중인 앱으로 바꾸는 것이 역할이다:

1. module graph 컴파일: `imports`/`exports` visibility 검증, circular import 감지, resolve될 토큰이 모두 접근 가능한지 확인
2. root DI container 생성, 모든 provider와 controller 등록
3. `@konekti/config`를 통해 config 로드, `ConfigService` 등록
4. singleton provider resolve 및 lifecycle hook 실행 (`onModuleInit` → `onApplicationBootstrap`)
5. `@konekti/http`의 `createHandlerMapping()`과 `createDispatcher()` 호출
6. `dispatch()`, `listen()`, `ready()`, `close()`를 가진 `KonektiApplication` shell 반환

Node.js 앱의 경우 `runNodeApplication()`이 canonical startup 경로다 — HTTP adapter, 기본 CORS, startup 로깅, graceful shutdown signal wiring을 처리한다.

## 설치

```bash
npm install @konekti/runtime
```

## 빠른 시작

### 최소 Node.js 앱

```typescript
import { Module, Global } from '@konekti/core';
import { runNodeApplication } from '@konekti/runtime';
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

await runNodeApplication(AppModule, { mode: 'dev' });
```

### 수동 listen으로 full bootstrap

```typescript
import { bootstrapApplication } from '@konekti/runtime';

const app = await bootstrapApplication({
  rootModule: AppModule,
  mode: 'dev',
});

await app.listen();
console.log('Listening');

// 수동으로 request dispatch (예: 테스트에서)
await app.dispatch(req, res);

// Graceful shutdown
await app.close();
```

### imports와 exports를 가진 모듈

```typescript
import { Module } from '@konekti/core';
import { createPrismaModule } from '@konekti/prisma';

@Module({
  imports: [createPrismaModule({ client: prismaClient })],
  providers: [UserService, UserRepository],
  controllers: [UserController],
  exports: [UserService],
})
export class UsersModule {}

@Module({
  imports: [UsersModule],
  // UsersModule이 UserService를 export하기 때문에 주입 가능
})
export class AppModule {}
```

## 핵심 API

| Export | 위치 | 설명 |
|---|---|---|
| `runNodeApplication(rootModule, options)` | `src/node.ts` | Node용 bootstrap + listen + shutdown wiring |
| `bootstrapNodeApplication(rootModule, options)` | `src/node.ts` | Node 기본값으로 bootstrap만 (listen 없음) |
| `bootstrapApplication(options)` | `src/bootstrap.ts` | 범용 bootstrap — `Application` 반환 |
| `bootstrapModule(module)` | `src/bootstrap.ts` | 하위 레벨: module graph 컴파일 + container 구성 |
| `defineModule(cls, metadata)` | `src/bootstrap.ts` | 데코레이터 없이 module 메타데이터를 붙이는 하위 레벨 helper |
| `Application` | `src/types.ts` | 인터페이스: `config`, `container`, `dispatcher`, `dispatch()`, `ready()`, `listen()`, `close()` |
| `@Module(metadata)` | `@konekti/core` | module의 provider, controller, import, export 선언 |
| `@Global()` | `@konekti/core` | 모듈을 전역적으로 visible하게 표시 |

## 구조

### Bootstrap 흐름

```text
runNodeApplication(options)  [또는 bootstrapApplication]
  → loadConfig(...)               (@konekti/config)
  → ConfigService provider 등록
  → compileModuleGraph()
      → imports/exports visibility 검증
      → circular import 감지
      → 모든 provider + controller 수집
  → root Container 생성        (@konekti/di)
  → bootstrap-level provider 등록
  → module provider + controller 등록
  → singleton 인스턴스 resolve
  → onModuleInit hook
  → onApplicationBootstrap hook
  → createHandlerMapping()     (@konekti/http)
  → createDispatcher()         (@konekti/http)
  → KonektiApplication 반환
```

### Module graph 컴파일은 순회가 아니라 증명이다

`compileModuleGraph()`는 단순히 노드를 방문하는 것 이상을 한다. 다음을 검증한다:
- controller나 service가 필요한 모든 provider 토큰이 접근 가능한지 (local, export된 모듈에서 import, 또는 global)
- 모듈이 소유하지 않거나 re-export할 수 없는 토큰을 export하려 하지 않는지
- `imports` 체인에 circular dependency가 없는지

이 중 하나라도 실패하면 provider가 인스턴스화되기 전에 bootstrap이 throw한다. 이것은 의도적인 설계 선택 — 깨진 앱은 첫 번째 요청에서 조용히 실패하는 것이 아니라 startup 시 크게 실패한다.

### Lifecycle hook 순서

```text
시작:   onModuleInit → onApplicationBootstrap
종료:   onModuleDestroy (역순) → onApplicationShutdown (역순)
```

Request-scoped provider와 transient provider는 lifecycle hook 대상에서 제외된다 — singleton-scoped provider만 참여한다.

### KonektiApplication은 thin shell이다

`KonektiApplication`은 어떤 런타임 부분도 재구현하지 않는다. 조립된 config, container, dispatcher에 대한 참조를 보관하고 상태 전환을 관리한다: `bootstrapped` → `ready` → `closed`.

추가 public export로는 `KonektiFactory`, `createHealthModule`, `createNodeHttpAdapter`, `parseMultipart`, `compressResponse`, `createConsoleApplicationLogger`, `createJsonApplicationLogger`, `APPLICATION_LOGGER`, `raceWithAbort`, `createAbortError` 등이 있다.

### 런타임이 소유하는 Node startup concerns

`runNodeApplication()`은 애플리케이션 코드에 있으면 안 되는 Node-specific startup 세부사항을 통합한다:
- HTTP adapter 생성과 바인딩
- 기본 CORS middleware
- config에서 port 결정
- Startup 로그
- `SIGTERM`/`SIGINT` → `app.close()` wiring
- Request abort signal → `FrameworkRequest.signal` bridge

## 파일 읽기 순서 (기여자용)

1. `packages/core/src/decorators.ts` — `@Module()`, `@Global()` 메타데이터 writer
2. `src/types.ts` — `Application` 인터페이스, module 메타데이터 shape
3. `src/errors.ts` — bootstrap 에러 타입
4. `src/bootstrap.ts` — `compileModuleGraph`, `bootstrapModule`, `bootstrapApplication`
5. `src/node.ts` — `bootstrapNodeApplication`, `runNodeApplication`
6. `src/bootstrap.test.ts` — module graph 컴파일, visibility/export 규칙
7. `src/application.test.ts` — lifecycle hook, close 경로, bootstrap 실패 unwind

## 관련 패키지

- `@konekti/config` — bootstrap 시 사용되는 `loadConfig`와 `ConfigService` 제공
- `@konekti/di` — `bootstrapModule`이 provider를 등록하는 `Container`
- `@konekti/http` — `bootstrapApplication`이 호출하는 `createHandlerMapping`과 `createDispatcher`

## 한 줄 mental model

```text
@konekti/runtime = 메타데이터로 검증된 module graph → 조립된 config/DI/HTTP application shell
```
