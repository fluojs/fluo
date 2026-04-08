# @konekti/testing

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 애플리케이션 테스트를 위한 모듈 구성 및 프로바이더 오버라이드 유틸리티입니다.

`@konekti/testing`은 Konekti 애플리케이션 테스트를 위한 공식적인 기준(Baseline)을 제공합니다. 격리된 테스트 환경을 구축하고, 의존성을 가짜(Fake)나 목(Mock)으로 교체하며, 모듈 그래프에서 직접 컴포넌트를 resolve하거나 가상 HTTP 요청을 디스패치하여 통합 테스트를 수행할 수 있게 합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
  - [오버라이드를 이용한 유닛 테스트](#오버라이드를-이용한-유닛-테스트)
  - [HTTP 통합 테스트](#http-통합-테스트)
  - [모킹(Mocking) 유틸리티](#모킹mocking-유틸리티)
  - [플랫폼 적합성(Conformance)](#플랫폼-적합성conformance)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add -D @konekti/testing
```

## 사용 시점

- 프로덕션 모듈 트리를 모방하는 테스트 컨테이너를 생성해야 할 때.
- 실제 서비스(데이터베이스, 메일러, 외부 API 등)를 테스트 더블로 교체하고 싶을 때.
- 특정 컨트롤러나 서비스를 격리하여 "슬라이스(Slice)" 테스트를 수행해야 할 때.
- 실제 네트워크 서버를 띄우지 않고 엔드 투 엔드(E2E) 스타일의 HTTP 요청을 실행하고 싶을 때.

## 빠른 시작

가장 일반적인 진입점은 `createTestingModule`입니다. 컨테이너를 컴파일하기 전에 플루언트(Fluent) API를 사용하여 오버라이드를 구성합니다.

```typescript
import { createTestingModule } from '@konekti/testing';
import { AppModule } from './app.module';
import { UserService } from './user.service';

const module = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(UserService, {
    findAll: async () => [{ id: '1', name: 'Test User' }]
  })
  .compile();

const userService = await module.resolve(UserService);
const users = await userService.findAll();

console.log(users[0].name); // "Test User"
```

## 주요 패턴

### 오버라이드를 이용한 유닛 테스트

모듈 그래프에 등록된 모든 프로바이더(클래스, 심볼, 또는 문자열 토큰)를 오버라이드할 수 있습니다.

```typescript
const module = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(DATABASE_CONNECTION, memoryDb)
  .overrideProvider(ConfigService, testConfig)
  .compile();
```

### HTTP 통합 테스트

`createTestApp`을 사용하여 경량화된 애플리케이션 셸을 얻고, `request()` 빌더를 사용하여 가상 HTTP 요청을 디스패치합니다.

```typescript
import { createTestApp } from '@konekti/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('GET', '/users/1')
  .header('Authorization', 'Bearer token')
  .send();

expect(response.status).toBe(200);
expect(response.body.id).toBe('1');

await app.close();
```

### 모킹 유틸리티 (`@konekti/testing/mock`)

Konekti는 타입 안전한 목(Mock) 및 딥 목(Deep Mock)을 생성할 수 있는 헬퍼를 제공합니다 (Vitest/Jest 호환).

```typescript
import { createMock, createDeepMock } from '@konekti/testing/mock';

const mockSvc = createMock<AuthService>({
  validate: vi.fn().mockResolvedValue(true)
});

const deepMock = createDeepMock(DatabaseService);
```

### 플랫폼 적합성(Conformance)

라이브러리 저자를 위해, Konekti는 커스텀 어댑터나 컴포넌트가 프레임워크의 라이프사이클 및 동작 계약을 준수하는지 확인할 수 있는 하니스를 제공합니다.
- `@konekti/testing/platform-conformance`
- `@konekti/testing/http-adapter-portability`

## 공개 API 개요

### 메인 모듈 (`@konekti/testing`)
- `createTestingModule({ rootModule })`: 테스트 컨테이너를 구성하고 컴파일합니다.
- `createTestApp({ rootModule })`: 테스트 가능한 애플리케이션 인스턴스를 생성합니다.
- `extractModuleProviders(Module)`: 모듈 메타데이터를 검사하는 유틸리티입니다.

### 서브 경로 (Sub-paths)
- `@konekti/testing/mock`: 목 및 딥 목 유틸리티.
- `@konekti/testing/http`: 로우(Raw) HTTP 요청 헬퍼.
- `@konekti/testing/vitest`: Konekti 표준 데코레이터를 위한 Vitest 플러그인.

## 관련 패키지

- `@konekti/di`: 테스트 컨테이너가 사용하는 기반 DI 시스템입니다.
- `@konekti/runtime`: 테스트 빌더가 확장하는 모듈 그래프 로직을 제공합니다.
- `@konekti/http`: `TestApp`에서 사용하는 가상 디스패치 시스템입니다.

## 예제 소스

- `packages/testing/src/module.test.ts`: 컨테이너 오버라이드에 대한 표준 예제.
- `packages/testing/src/surface.test.ts`: 공개 API 표면에 대한 개요.

