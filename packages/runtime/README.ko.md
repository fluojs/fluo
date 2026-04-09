# @konekti/runtime

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

모듈 그래프를 컴파일하고 DI와 HTTP를 실행 가능한 애플리케이션 셸로 연결하는 어셈블리 레이어입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [퀵 스타트](#퀵-스타트)
- [주요 패턴](#주요-패턴)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @konekti/runtime
```

## 사용 시점

다음과 같은 경우에 이 패키지를 사용합니다:
- **Konekti 애플리케이션 부트스트랩**: 모듈을 실행 중인 HTTP 서버나 마이크로서비스로 변환할 때.
- **DI 및 라이프사이클 오케스트레이션**: 모듈 그래프 컴파일, 프로바이더 연결 및 애플리케이션 훅(`onModuleInit`, `onApplicationBootstrap`)을 관리할 때.
- **독립형 컨텍스트 생성**: HTTP 서버는 필요 없지만 DI가 필요한 CLI 태스크, 마이그레이션 또는 워커를 실행할 때.
- **진단 및 검사**: 기계 읽기 가능한 형태나 Mermaid 기반의 모듈 그래프 토폴로지를 내보낼 때.

## 퀵 스타트

### 최소 HTTP 애플리케이션

`KonektiFactory`는 애플리케이션 생성을 위한 주요 진입점입니다.

```typescript
import { Module } from '@konekti/core';
import { Controller, Get } from '@konekti/http';
import { KonektiFactory } from '@konekti/runtime';
import { createNodejsAdapter } from '@konekti/platform-nodejs';

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
const app = await KonektiFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
});

await app.listen();
```

## 주요 패턴

### 애플리케이션 컨텍스트 (HTTP 제외)

백그라운드 워커나 스크립트의 경우, `createApplicationContext`를 사용하여 HTTP 설정을 건너뛸 수 있습니다.

```typescript
import { KonektiFactory } from '@konekti/runtime';

const context = await KonektiFactory.createApplicationContext(AppModule);

// 컨테이너에서 직접 서비스 해석
const userService = await context.get(UserService);
await userService.doWork();

await context.close();
```

### 전역 예외 필터

부트스트랩 시 필터를 등록하여 횡단 관심사 에러를 처리합니다.

```typescript
import { KonektiFactory, type ExceptionFilterHandler } from '@konekti/runtime';

class GlobalErrorFilter implements ExceptionFilterHandler {
  async catch(error, { response }) {
    console.error('에러 발생:', error);
    response.setStatus(500);
    void response.send({ error: 'Internal Server Error' });
    return true; // 처리됨으로 표시
  }
}

const app = await KonektiFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
  filters: [new GlobalErrorFilter()],
});
```

### 모듈 구성

Konekti는 엄격한 모듈 그래프를 사용합니다. 모듈은 다른 모듈에서 사용할 프로바이더를 `export`를 통해 명시적으로 공개해야 합니다.

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

## 공개 API 개요

- `KonektiFactory`: 애플리케이션 라이프사이클 관리를 위한 정적 파사드입니다.
- `Application`: `ApplicationContext`를 확장하며 `listen()`, `dispatch()`, `state`를 포함합니다.
- `ApplicationContext`: `get<T>(token)`, `close()` 기능을 제공하며 `container`와 `modules`에 접근할 수 있습니다.
- `LifecycleHooks`: `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, `OnApplicationShutdown`.
- `defineModule(cls, metadata)`: 프로그래밍 방식의 모듈 정의 헬퍼입니다.
- `bootstrapApplication(options)`: 저수준 비동기 부트스트랩 함수입니다.

## 플랫폼 전용 서브경로

| 서브경로 | 용도 |
| :--- | :--- |
| `@konekti/runtime/node` | Node.js 전용 로거 팩토리 (`createConsoleApplicationLogger`, `createJsonApplicationLogger`) 및 종료 시그널 등록. |
| `@konekti/runtime/web` | Bun, Deno, Cloudflare Workers를 위한 공유 웹 표준 요청/응답 유틸리티. |
| `@konekti/runtime/internal` | 저수준 오케스트레이션 헬퍼 및 HTTP 어댑터 기본 로직. |

### Node 전용 서브경로 (`@konekti/runtime/node`)

로거 팩토리 및 기타 Node 전용 헬퍼는 범용 루트 진입점에 포함되지 않습니다. `./node` 서브경로에서 가져오세요:

```typescript
import { createConsoleApplicationLogger, createJsonApplicationLogger } from '@konekti/runtime/node';
```

- `createConsoleApplicationLogger()`: `process.stdout`/`process.stderr`를 사용하는 컬러 콘솔 로거.
- `createJsonApplicationLogger()`: `process.stdout`/`process.stderr`를 사용하는 구조화된 JSON 로거.

## 관련 패키지

- [@konekti/core](../core): 핵심 데코레이터 및 메타데이터 시스템.
- [@konekti/di](../di): 의존성 주입(DI) 컨테이너 구현체.
- [@konekti/http](../http): HTTP 라우팅, 컨트롤러 및 디스패처.
- [@konekti/platform-nodejs](../platform-nodejs): 공식 Node.js HTTP 어댑터.

## 예제 소스

- [examples/minimal](../../examples/minimal): 최소한의 부트스트랩 예제.
- [examples/realworld-api](../../examples/realworld-api): 복잡한 모듈 연결이 포함된 전체 애플리케이션 예제.
- [packages/runtime/src/bootstrap.test.ts](./src/bootstrap.test.ts): 부트스트랩 단계별 동작 테스트.
