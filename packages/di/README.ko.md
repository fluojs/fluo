# @fluojs/di

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

모든 fluo 애플리케이션을 구동하는 최소 토큰 기반 의존성 주입 컨테이너입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 기능](#주요-기능)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/di
```

## 사용 시점

- 런타임에 클래스와 의존성을 실제 인스턴스로 해석해야 할 때
- singleton, request, transient 같은 수명 주기를 관리해야 할 때
- 테스트나 환경별 설정에서 구현체를 명시적으로 교체해야 할 때
- HTTP 요청이나 백그라운드 작업마다 격리된 request scope가 필요할 때

## 빠른 시작

컨테이너는 등록된 provider를 기준으로 토큰을 인스턴스로 해석합니다.

```ts
import { Container } from '@fluojs/di';
import { Inject, Scope } from '@fluojs/core';

class Logger {
  log(message: string) {
    console.log(message);
  }
}

@Inject(Logger)
@Scope('singleton')
class UserService {
  constructor(private readonly logger: Logger) {}

  async getStatus() {
    this.logger.log('상태 확인 중...');
    return { status: 'active' };
  }
}

const container = new Container();
container.register(Logger, UserService);

const service = await container.resolve(UserService);
```

## 주요 기능

### 다양한 provider 형태 지원

- **클래스 provider**: `container.register(MyService)` 또는 `{ provide, useClass }`
- **값 provider**: `{ provide: 'API_URL', useValue: 'https://api.example.com' }`
- **팩토리 provider**: `{ provide, useFactory, inject }`

### scope-aware 수명 주기 관리

- **singleton**: 루트 컨테이너에서 한 번 생성되어 공유됩니다.
- **request**: `createRequestScope()`마다 새로 생성됩니다.
- **transient**: resolve할 때마다 새 인스턴스를 만듭니다.

### request scope 분리

```ts
const requestContainer = container.createRequestScope();
const scopedService = await requestContainer.resolve(RequestScopedService);
```

## 공개 API 개요

- `Container`
- `register(...providers)`
- `resolve<T>(token)`
- `createRequestScope()`
- `has(token)`

## 관련 패키지

- `@fluojs/core`: `@Inject()`와 `@Scope()` 데코레이터를 정의합니다.
- `@fluojs/runtime`: 부트스트랩 중 provider 등록과 모듈 그래프 조립을 담당합니다.
- `@fluojs/http`: 들어오는 요청마다 request scope를 생성합니다.

## 예제 소스

- `packages/di/src/container.ts`
- `packages/di/src/container.test.ts`
- `examples/minimal/src/app.ts`
