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
- **독립형 컨텍스트 생성**: HTTP 서버는 필요 없지만 DI가 필요한 CLI 태스크, 마이그레이션 또는 워커를 실행할 때.
- **진단 및 검사**: CLI 내보내기와 Studio 소유 그래프 보기/렌더링을 위한 기계 읽기 가능한 플랫폼 snapshot을 생산할 때.

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
  providers: [UsersService], // 이제 DatabaseService를 주입받을 수 있음
})
class UsersModule {}
```

## 동작 계약

- 요청 바디 파싱은 Web 표준 요청과 Node 기반 요청 모두에서 바이트가 스트리밍되는 동안 `maxBodySize`를 강제합니다.
- `@fluojs/runtime/node`에서는 Node 요청 바디 파싱 전에 primary `content-type` media type을 normalize한 뒤 JSON 및 멀티파트 여부를 판단하므로, 대소문자가 섞인 JSON/멀티파트 헤더도 문서화된 파서 동작을 그대로 유지합니다.
- Node 기반 및 Web 표준 요청 wrapper는 바디 파싱 전에 저비용 요청 metadata를 snapshot으로 고정한 뒤 dispatch 경계에서 `body`/`rawBody`를 한 번 materialize하므로 userland는 계속 동기 parsed 값을 관찰합니다.
- Node 기반 쿠키/쿼리 값과 Web 표준 헤더는 요청 wrapper가 생성되는 시점에 snapshot으로 고정된 뒤 요청별로 lazy하게 normalize되고 memoize됩니다. 이후 upstream 객체가 변경되어도 `FrameworkRequest` view는 바뀌지 않습니다.
- `ApplicationContext.get()`과 `Application.get()`은 bootstrap 시점에 알려진 직접 root singleton class/factory provider 조회만 memoize하며, alias, request, transient, 종료 이후, multi-provider, `container.override()` 해석 의미는 그대로 유지합니다.
- `multi: true` provider token은 context cache에 memoize되지 않습니다. 각 `get()` 호출은 DI로 위임되어 컨테이너가 새로운 contribution 배열을 조립하며, 각 contribution 자체는 해당 provider scope에 따라 재사용됩니다.
- `duplicateProviderPolicy`가 `warn` 또는 `ignore`일 때 context cache 적격성과 lifecycle hook 실행은 bootstrap이 선택한 effective winning provider를 기준으로 결정됩니다. stale losing provider는 cache entry나 lifecycle hook을 만들지 않습니다.
- 애플리케이션 또는 컨텍스트 bootstrap이 런타임 리소스나 lifecycle instance 생성 이후 실패하면 fluo는 readiness를 초기화하고, 등록된 runtime cleanup callback을 실행하며, 그 시점까지 해석된 instance의 shutdown hook을 `bootstrap-failed`로 호출하고, 컨테이너를 dispose하고, cleanup 실패를 로그로 남긴 뒤 원래 bootstrap error를 다시 던집니다.
- Bootstrap은 독립적인 singleton lifecycle provider를 병렬로 해석한 뒤 lifecycle hook은 결정적인 provider 순서대로 실행합니다.
- 멀티파트 파싱은 누적 바디 크기가 설정된 `multipart.maxTotalSize`를 넘으면 즉시 거부되며, 런타임 어댑터는 별도 재정의가 없으면 이 한도를 `maxBodySize`와 동일하게 맞춥니다.
- `createNodeHttpAdapter(...)`, `bootstrapNodeApplication(...)`, `runNodeApplication(...)`는 `maxBodySize`를 0 이상의 정수 바이트 수로만 받으며, 값이 잘못되면 어댑터 생성/부트스트랩 단계에서 즉시 실패합니다.
- 응답 스트림 백프레셔 헬퍼는 `drain`, `close`, `error` 중 어느 경우에도 `waitForDrain()`을 완료시켜 끊어진 연결에서 스트리밍 작성기가 멈추지 않도록 합니다.
- 런타임 health 모듈은 bootstrap이 ready로 표시하기 전까지 `/ready`를 HTTP 503과 `starting`으로 보고하며, 애플리케이션/컨텍스트 종료가 시작되는 즉시, 종료 시도가 실패하더라도 다시 `starting`으로 내려갑니다.
- 시그널 기반 종료 헬퍼는 bounded drain semantics를 유지하면서 timeout/실패 상황을 로그와 `process.exitCode`로 보고하지만, 최종 프로세스 종료 소유권은 주변 호스트 런타임에 남겨 둡니다.
- 플랫폼 snapshot 생산은 런타임에 남아 있고, 그래프 보기와 Mermaid 렌더링은 CLI 및 자동화 호출자가 소비하는 Studio 소유 계약입니다.

## 공개 API 개요

- `fluoFactory`: 패키지 예제에서 사용하는 런타임 부트스트랩 파사드의 lower-camel-case 별칭입니다.
- `FluoFactory`: 호환성과 명시적 static 접근을 위해 유지되는 클래스 기반 런타임 부트스트랩 파사드입니다.
- `Application`: `ApplicationContext`를 확장하며 `listen()`, `dispatch()`, `state`를 포함합니다.
- `ApplicationContext`: `get<T>(token)`, `close()` 기능을 제공하며 `container`와 `modules`에 접근할 수 있습니다.
- `LifecycleHooks`: `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, `OnApplicationShutdown`를 묶는 편의 union 타입입니다.
- `createHealthModule(options)`: bootstrap 및 shutdown 라이프사이클 전이에 맞춰 readiness marker를 관리하는 런타임 소유 `/health`, `/ready` 모듈 팩토리입니다.
- `defineModule(cls, metadata)`: 프로그래밍 방식의 모듈 정의 헬퍼입니다.
- `bootstrapApplication(options)`: 저수준 비동기 부트스트랩 함수입니다.

## 플랫폼 전용 서브경로

| 서브경로 | 용도 |
| :--- | :--- |
| `@fluojs/runtime/node` | 로거 팩토리, Node 어댑터/부트스트랩 헬퍼, 종료 시그널 등록을 위한 지원되는 Node.js 전용 진입점입니다. |
| `@fluojs/runtime/web` | Bun, Deno, Cloudflare Workers를 위한 공유 웹 표준 요청/응답 유틸리티. |
| `@fluojs/runtime/internal` | 저수준 오케스트레이션 헬퍼 및 HTTP 어댑터 기본 로직. |
| `@fluojs/runtime/internal-node` | 어댑터/패키지 호환 계층이 사용하는 Node 전용 내부 seam이며, 애플리케이션 코드에서는 `@fluojs/runtime/node`를 우선 사용하세요. |

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

공개 Node 런타임 surface에서 `maxBodySize`는 바이트 수를 나타내는 숫자만 허용합니다. `'1mb'` 같은 값은 나중에 암묵 변환되지 않고 어댑터 생성 시점에 즉시 거부됩니다.

- `createConsoleApplicationLogger()`: `process.stdout`/`process.stderr`를 사용하는 컬러 콘솔 로거.
- `createJsonApplicationLogger()`: `process.stdout`/`process.stderr`를 사용하는 구조화된 JSON 로거.
- `createNodeHttpAdapter()`: 어댑터 우선 런타임 구성을 위한 raw Node `http`/`https` 어댑터 팩토리입니다. primary Node 요청 `content-type`을 JSON/멀티파트 판별 전에 normalize하며, `maxBodySize`는 숫자 바이트 수만 받습니다.
- `bootstrapNodeApplication()` / `runNodeApplication()`: 호환 패키지와 직접 Node 런타임 흐름에서 사용하는 Node 전용 부트스트랩 헬퍼.
- `createNodeShutdownSignalRegistration()`, `defaultNodeShutdownSignals()`, `registerShutdownSignals()`: 호스트가 명시적으로 시그널 wiring을 제어할 때 쓰는 종료 등록 헬퍼.

더 저수준의 Node compression internals는 공개 `@fluojs/runtime/node` 계약이 아니라 `@fluojs/runtime/internal-node` seam 뒤에 둡니다.

## 관련 패키지

- [@fluojs/core](../core): 핵심 데코레이터 및 메타데이터 시스템.
- [@fluojs/di](../di): 의존성 주입(DI) 컨테이너 구현체.
- [@fluojs/http](../http): HTTP 라우팅, 컨트롤러 및 디스패처.
- [@fluojs/platform-nodejs](../platform-nodejs): 공식 Node.js HTTP 어댑터.
- [@fluojs/studio](../studio): 런타임이 생산한 snapshot을 위한 뷰어 및 렌더링 헬퍼.

## 예제 소스

- [examples/minimal](../../examples/minimal): 최소한의 부트스트랩 예제.
- [examples/realworld-api](../../examples/realworld-api): 복잡한 모듈 연결이 포함된 전체 애플리케이션 예제.
- [packages/runtime/src/bootstrap.test.ts](./src/bootstrap.test.ts): 부트스트랩 단계별 동작 테스트.
