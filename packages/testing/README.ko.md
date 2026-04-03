# @konekti/testing

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션 테스트를 위한 공식 모듈 구성 및 프로바이더 오버라이드 baseline입니다.

공개 계약은 의도적으로 집중된 범위를 유지합니다. 공식 CLI generated 템플릿은 이제 이 안정적인 표면 위에서 unit, slice/integration, starter e2e 스타일 흐름을 구성합니다.

## 관련 문서

- `../../docs/operations/testing-guide.ko.md`
- `../../docs/concepts/architecture-overview.ko.md`

## 이 패키지가 하는 일

`@konekti/testing`은 Konekti 모듈 그래프 안에서 격리된 테스트 환경을 구성하는 최소한의 API를 제공합니다. 루트 모듈을 넘기고, 가짜 구현이나 스파이로 교체할 프로바이더를 오버라이드하고, 그래프를 컴파일한 다음, 토큰을 resolve해서 검증하고 싶은 인스턴스를 얻으면 됩니다.

이 패키지는 프로덕션 런타임에 **참여하지 않습니다** — 테스트 모듈은 테스트 환경에서만 존재합니다. 의도적으로 baseline입니다: 완성된 픽스처 라이브러리가 아니라, 위에 무언가를 쌓을 수 있는 안정적인 기반입니다. `makeRequest`, `createMock`, `createDeepMock`, `mockToken`, `asMock` 같은 헬퍼를 포함하지만, 전체 픽스처 프레임워크를 지향하지는 않습니다.

### 목 헬퍼 빠른 예시

```typescript
import { asMock, createDeepMock, createMock, mockToken } from '@konekti/testing';
import { vi } from 'vitest';

const repo = createMock<UserRepository>({ findById: vi.fn() });
const mailer = createDeepMock(MailService);
const typedFn = asMock(vi.fn<(id: string) => Promise<User | null>>());
const repoProvider = mockToken(USER_REPOSITORY, { findById: vi.fn() });
```

## 설치

```bash
npm install --save-dev @konekti/testing
```

## 빠른 시작

### 기본 테스트 설정

```typescript
import { createTestingModule } from '@konekti/testing';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { UserService } from '../src/user/user.service';
import { USER_REPOSITORY } from '../src/user/tokens';

describe('UserService', () => {
  it('사용자를 생성한다', async () => {
    const fakeRepo = {
      create: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
      findById: vi.fn(),
    };

    const module = await createTestingModule({ rootModule: AppModule })
      .overrideProvider(USER_REPOSITORY, fakeRepo)
      .compile();

    const service = await module.resolve(UserService);

    const result = await service.createUser({ name: 'Alice' });

    expect(fakeRepo.create).toHaveBeenCalledWith({ name: 'Alice' });
    expect(result.name).toBe('Alice');
  });
});
```

### 여러 프로바이더 오버라이드

```typescript
const module = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(USER_REPOSITORY, fakeUserRepo)
  .overrideProvider(EMAIL_SERVICE, fakeEmailService)
  .overrideProvider(CONFIG_TOKEN, { dbUrl: 'sqlite::memory:' })
  .compile();
```

### 배치 오버라이드 (`overrideProviders`)

```typescript
const module = await createTestingModule({ rootModule: AppModule })
  .overrideProviders([
    [USER_REPOSITORY, fakeUserRepo],
    [EMAIL_SERVICE, fakeEmailService],
    [CONFIG_TOKEN, { dbUrl: 'sqlite::memory:' }],
  ])
  .compile();
```

### 토큰 직접 resolve

```typescript
// 클래스 참조로 resolve
const service = await module.resolve(UserService);

// DI 토큰(심볼 또는 문자열)으로 resolve
const config = await module.resolve(CONFIG_TOKEN);
```

### 다중 토큰 resolve (`resolveAll`)

```typescript
const module = await createTestingModule({ rootModule: AppModule }).compile();

const [userService, emailService, config] = await module.resolveAll([
  UserService,
  EmailService,
  CONFIG_TOKEN,
]);
```

### 가드/인터셉터/필터 테스트 레시피

```typescript
const module = await createTestingModule({ rootModule: AppModule })
  .overrideGuard(AuthGuard)
  .overrideInterceptor(LoggingInterceptor)
  .overrideFilter(AppExceptionFilter, {
    catch() {
      throw new Error('mapped in test');
    },
  })
  .compile();
```

### `createTestApp()` 기반 HTTP 슬라이스 테스트

```typescript
import { createTestApp } from '@konekti/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('GET', '/users/me')
  .principal({ subject: 'user-1', roles: ['member'] })
  .send();

expect(response.status).toBe(200);

await app.close();
```

### GraphQL 요청 흐름 테스트 패턴

GraphQL 모듈은 `/graphql` 요청 단위 검증을 권장합니다(`packages/graphql/src/module.test.ts` 참고).

```typescript
const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('POST', '/graphql')
  .header('content-type', 'application/json')
  .body({ query: '{ echo(value: "hello") }' })
  .send();

expect(response.status).toBe(200);

await app.close();
```

### Prisma / Drizzle / Redis 테스트 패턴

영속성/캐시 모듈은 실제 외부 핸들만 오버라이드하고 모듈 그래프는 그대로 유지하는 방식을 권장합니다.

- Prisma: `PRISMA_CLIENT` 오버라이드
- Drizzle: `DRIZZLE_DATABASE`(필요 시 `DRIZZLE_DISPOSE`) 오버라이드
- Redis: `REDIS_CLIENT` 또는 `RedisService` 오버라이드

### OpenAPI 문서 검증 패턴

`/openapi.json`은 스냅샷보다 안정적인 구조 단언을 우선 권장합니다(`packages/openapi/src/openapi-module.test.ts` 참고).

```typescript
const app = await createTestApp({ rootModule: AppModule });
const response = await app.request('GET', '/openapi.json').send();

expect(response.status).toBe(200);
expect(response.body).toEqual(
  expect.objectContaining({
    openapi: '3.1.0',
    paths: expect.any(Object),
  }),
);
```

### Vitest 데코레이터 플러그인 (`@konekti/testing/vitest`)

스타터 프로젝트의 `vitest.config.ts`는 다음 subpath export를 사용합니다.

```ts
import { defineConfig } from 'vitest/config';
import { konektiBabelDecoratorsPlugin } from '@konekti/testing/vitest';

export default defineConfig({
  plugins: [konektiBabelDecoratorsPlugin()],
});
```

### 플랫폼 conformance test kit

공식 플랫폼-지향 패키지를 작성할 때는 `createPlatformConformanceHarness(...)`로 공유 라이프사이클/진단/스냅샷 계약을 고정하세요.

```ts
import { createPlatformConformanceHarness } from '@konekti/testing';

const harness = createPlatformConformanceHarness({
  createComponent: () => createQueuePlatformComponent(),
  captureValidationSideEffects: (component) => ({
    ownership: component.snapshot().ownership,
  }),
  diagnostics: {
    expectedCodes: ['QUEUE_DEPENDENCY_NOT_READY'],
  },
  scenarios: {
    degraded: {
      name: 'degraded',
      createComponent: () => createQueuePlatformComponent({ mode: 'degraded' }),
      enterState: async () => undefined,
      expectedState: 'degraded',
    },
    failed: {
      name: 'failed',
      createComponent: () => createQueuePlatformComponent({ mode: 'failed' }),
      enterState: async () => undefined,
      expectedState: 'failed',
    },
  },
});

await harness.assertAll();
```

이 test kit는 다음 invariant를 강제합니다.

- `validate()`가 `component.state()`를 전이시키지 않음
- state 외의 숨은 장수명 side effect는 `captureValidationSideEffects`를 제공한 경우에만 검증됨
- `start()`/`stop()`이 결정적/멱등임
- `snapshot()`을 degraded/failed 상태에서도 호출 가능함
- diagnostics가 안정적인 비어 있지 않은 `code`와 error 수준 `fixHint`를 유지함
- snapshot에 비밀 키 경로가 남지 않도록 sanitize됨

## 핵심 API

### `createTestingModule(options)`

진입점입니다. 빌더 객체를 반환합니다.

```typescript
interface TestingModuleOptions {
  rootModule: ModuleType;
}

createTestingModule(options: TestingModuleOptions): TestingModuleBuilder
```

### `createPlatformConformanceHarness(options)`

공식 플랫폼-지향 패키지를 위한 공유 conformance 테스트 하니스입니다.

`captureValidationSideEffects`는 선택 사항입니다. 이 옵션이 없으면 validation side-effect 커버리지는 상태 전이 가드(`validate()`가 `component.state()`를 바꾸지 않아야 함)까지로 제한됩니다.

### `TestingModuleBuilder`

`createTestingModule`이 반환하는 플루언트 빌더입니다.

| 메서드 | 설명 |
|---|---|
| `.overrideProvider(token, implementation)` | 그래프가 컴파일되기 전에 DI 토큰의 프로바이더를 `implementation`으로 교체합니다. 체이닝 가능합니다. |
| `.overrideProviders(overrides)` | 여러 provider 오버라이드를 `[token, value]` 배열로 한 번에 적용합니다. |
| `.overrideGuard(guard, fake?)` | 가드를 항상 통과하는 기본 fake(또는 사용자 fake)로 교체합니다. |
| `.overrideInterceptor(interceptor, fake?)` | 인터셉터를 패스스루 기본 fake(또는 사용자 fake)로 교체합니다. |
| `.overrideFilter(filter, fake?)` | 필터 토큰을 fake로 교체합니다. |
| `.overrideModule(module, replacement)` | import된 모듈을 replacement 모듈로 교체합니다. |
| `.compile()` | 모든 오버라이드가 적용된 모듈 그래프를 컴파일합니다. `Promise<TestingModuleRef>`을 반환합니다. |

### `TestingModuleRef`

컴파일된 테스트 컨테이너입니다.

| 메서드 | 설명 |
|---|---|
| `.resolve(token)` | 컴파일된 모듈 그래프에서 프로바이더를 resolve합니다. 클래스 생성자 또는 DI 토큰을 받고 `Promise<T>`를 반환합니다. |
| `.resolveAll(tokens)` | 여러 토큰을 순서대로 resolve합니다. 실패 시 집계 에러를 반환합니다. |
| `.has(token)` | 컴파일된 그래프에 해당 provider 토큰이 있는지 확인합니다. |
| `.dispatch(request)` | 컴파일된 모듈 디스패처를 통해 요청을 실행하고 `TestResponse`를 반환합니다. |

`get()`은 **동기 전용 편의 API**입니다. async factory/provider가 섞인 경우에는 `resolve()`를 사용하세요.

### 모듈 메타데이터 추출 유틸리티

```typescript
import {
  extractModuleProviders,
  extractModuleControllers,
  extractModuleImports,
} from '@konekti/testing';
```

커스텀 테스트 빌더 구성이나 모듈 단위 검증에서 메타데이터 심볼에 직접 접근하지 않고 사용할 수 있습니다.

### `createTestApp(options)`

요청-응답 스타일 테스트를 위해 사용합니다. `bootstrapApplication` 기반의 테스트 애플리케이션을 생성합니다.

```typescript
import { createTestApp } from '@konekti/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('POST', '/users')
  .body({ name: 'Alice' })
  .header('x-request-id', 'req-1')
  .query('scope', 'admin')
  .send();

expect(response.status).toBe(201);

await app.close();
```

### `TestApp.dispatch(request)`

빌더를 쓰지 않고 요청을 바로 실행하고 싶을 때 사용합니다.

```typescript
const response = await app.dispatch({
  method: 'GET',
  path: '/users/me',
  principal: {
    subject: 'user-1',
    roles: ['admin'],
    claims: { tenant: 'acme' },
  },
});

expect(response.status).toBe(200);
```

`app.dispatch(request)`는 `app.request(...).send()`와 같은 테스트 파이프라인을 그대로 사용하며,
`method`, `path`, `query`, `headers`, `body`, `principal`을 동일한 형태로 받습니다.

`createTestApp()`는 내부적으로 `bootstrapApplication`을 호출하며, 실제 앱 파이프라인을 유지하면서도 테스트 실행에 맞춘 경량 클라이언트를 제공합니다.

### `request()` 빌더

`request()`는 체이닝 가능한 빌더를 반환해 테스트 요청을 구성합니다.

```typescript
const response = await app
  .request('GET', '/me')
  .principal({
    subject: 'user-1',
    roles: ['admin'],
    claims: { tenant: 'acme' },
  })
  .send();

expect(response.body).toEqual({
  subject: 'user-1',
  roles: ['admin'],
  claims: { tenant: 'acme' },
});

const defaultResponse = await app
  .request('GET', '/me')
  .principal({ roles: ['anonymous'] })
  .send();

expect(defaultResponse.body).toEqual({
  subject: 'test',
  claims: {},
  roles: ['anonymous'],
});
```

`principal`은 `subject`(우선) 또는 `id`(호환성)를 통해 주체를 구성할 수 있으며, 둘 다 없으면 `subject: 'test'`로 기본 주입됩니다.

## 구조

```
createTestingModule({ rootModule })
    │
    ▼
TestingModuleBuilder
    │  .overrideProvider(token, impl)  ← 오버라이드 누적
    │  .overrideProvider(token, impl)
    │
    ▼
.compile()
    │  rootModule로부터 모듈 그래프 구성
    │  모든 프로바이더 오버라이드 적용
    ▼
TestingModuleRef
    │
    ▼
.resolve(token)  → 그래프에서 인스턴스 반환
createTestApp({ rootModule })  → 테스트 앱 생성 후 request() 호출 가능
```

오버라이드는 모듈 그래프가 구성된 **이후** 적용되어, 실제 프로바이더를 공급한 가짜 구현으로 교체합니다. 그래프의 나머지 부분은 그대로 유지되므로, 명시적으로 오버라이드한 토큰만 대체됩니다.

## 파일 읽기 순서 (기여자용)

이 패키지는 의도적으로 작게 유지되어 있습니다. 전체 구현을 한 번에 읽을 수 있습니다:

1. `src/types.ts` — `TestingModuleOptions`, `TestingModuleBuilder`, `TestingModuleRef` 인터페이스; 공개 계약(contract)
2. `src/module.ts` — `createTestingModule()` 구현; 빌더 패턴과 `.compile()`이 동작하는 방식
3. `src/index.ts` — 공개 표면; 무엇이 export되고 무엇이 아닌지
4. `src/module.test.ts` — 테스트 스위트; 의도된 사용 패턴과 엣지 케이스 확인

## 관련 패키지

| 패키지 | 관계 |
|---|---|
| `@konekti/di` | `TestingModuleRef`가 래핑하고 `.resolve()`가 위임하는 DI 컨테이너 |
| `@konekti/runtime` | `compile()`이 사용하는 모듈 그래프 구성 로직 |
| `@konekti/runtime` | 라이프사이클 인터페이스; 테스트 모드에서 `TestingModuleRef`는 라이프사이클 훅을 트리거하지 않음 |
| `@konekti/prisma` | 일반적인 오버라이드 대상 — `PRISMA_CLIENT`를 가짜로 교체해 실제 DB 연결 방지 |
| `@konekti/jwt` | 일반적인 오버라이드 대상 — JWT 검증기를 교체해 실제 토큰 없이 인증 흐름 테스트 |

## 한 줄 mental model

> `@konekti/testing` = 실제 모듈 그래프를 그대로 구성하고, 가짜로 바꿀 것만 교체하고, 검증하고 싶은 것만 resolve한다 — 마법도 없고, 별도 테스트 프레임워크도 없다.
