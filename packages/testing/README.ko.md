# @fluojs/testing

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션 테스트를 위한 모듈 구성 및 프로바이더 오버라이드 유틸리티입니다.

`@fluojs/testing`은 fluo 애플리케이션 테스트를 위한 공식적인 기준(Baseline)을 제공합니다. 격리된 테스트 환경을 구축하고, 의존성을 가짜(Fake)나 목(Mock)으로 교체하며, 모듈 그래프에서 직접 컴포넌트를 resolve하거나 가상 HTTP 요청을 디스패치하여 통합 테스트를 수행할 수 있게 합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [canonical TDD ladder](#canonical-tdd-ladder)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add -D @fluojs/testing vitest
```

`vitest`는 mock 헬퍼와 `@fluojs/testing/vitest` 엔트리포인트가 요구하는 peer dependency입니다.

`@fluojs/testing/vitest`를 사용할 때는 `fluoBabelDecoratorsPlugin()`이 런타임에 Babel을 호출하므로, 사용하는 워크스페이스에 `@babel/core`도 함께 설치해야 합니다.

```bash
pnpm add -D @babel/core
```

## 사용 시점

- 프로덕션 모듈 트리를 모방하는 테스트 컨테이너를 생성해야 할 때.
- 실제 서비스(데이터베이스, 메일러, 외부 API 등)를 테스트 더블로 교체하고 싶을 때.
- 라이브러리나 어댑터 패키지에서 책임별 서브패스를 통해 적합성(conformance) 및 이식성(portability) 하니스를 사용해야 할 때.
- 스타터 템플릿이나 애플리케이션 테스트에 사용할 안정적인 unit / integration / e2e 스타일 기준선이 필요할 때.

## 빠른 시작

```typescript
import { createTestingModule } from '@fluojs/testing';
import { vi } from 'vitest';

const module = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(USER_REPOSITORY, {
    create: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
  })
  .compile();

const service = await module.resolve(UserService);
```

`module.get(token)`은 동기 lookup에, `module.resolve(token)`은 비동기 resolution에, `module.resolveAll(token)`은 multi-provider 토큰의 모든 provider를 가져올 때 사용합니다.

## 주요 패턴

### 오버라이드를 이용한 유닛 테스트

```typescript
const module = await createTestingModule({ rootModule: AppModule })
  .overrideProviders([
    [USER_REPOSITORY, fakeUserRepo],
    [EMAIL_SERVICE, fakeEmailService],
  ])
  .compile();
```

Testing builder는 route-pipeline 테스트에서 cross-cutting behavior를 교체할 수 있도록 `overrideGuard(...)`, `overrideInterceptor(...)`, `overrideFilter(...)`도 지원합니다.

### `overrideModule()` 사용 시 모듈 identity 보존

`createTestingModule({ rootModule })`에는 명시적인 루트 모듈이 필요합니다. 그래야 테스트가 프로덕션 bootstrap과 같은 모듈 그래프 형태를 컴파일합니다. `overrideModule(source, replacement)`로 import된 모듈을 교체해도, 컴파일된 testing module은 provider 해석에 replacement import를 사용하면서 원래 `rootModule`과 컴파일된 `modules[].type` identity를 보존합니다. 따라서 diagnostics, graph assertion, module introspection 헬퍼는 테스트 전용 synthetic wrapper 클래스가 아니라 사용자가 작성한 애플리케이션 모듈 클래스에 계속 연결됩니다.

```typescript
const module = await createTestingModule({ rootModule: AppModule })
  .overrideModule(StripeModule, FakeStripeModule)
  .compile();

expect(module.rootModule).toBe(AppModule);
expect(module.modules.some((compiledModule) => compiledModule.type === BillingModule)).toBe(true);
```

### HTTP 통합 테스트

```typescript
import { createTestApp } from '@fluojs/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('GET', '/users/me')
  .principal({ subject: 'user-1', roles: ['member'] })
  .send();

await app.close();
```

### 명시적 서브패스의 mock 헬퍼

```typescript
import { createMock, createDeepMock } from '@fluojs/testing/mock';
import { vi } from 'vitest';

const repo = createMock<UserRepository>({ findById: vi.fn() });
const mailer = createDeepMock(MailService);
```

`asMock(value)`는 기존 값을 mock-friendly 타입으로 좁히고, `mockToken(token, value)`는 token 기반 dependency를 위한 provider override tuple을 만듭니다. `createMock(..., { strict: true })`는 지정하지 않은 member 접근을 거부합니다.

배포된 런타임 import가 안정적으로 해석되도록, mock 헬퍼를 사용할 워크스페이스에는 `vitest`를 함께 설치해야 합니다.

### 적합성 및 이식성 하니스

프레임워크 지향 플랫폼 패키지를 작성할 때는 `@fluojs/testing/platform-conformance`, `@fluojs/testing/http-adapter-portability`, `@fluojs/testing/web-runtime-adapter-portability` 같은 서브패스를 사용해 적합성 및 이식성 검증을 수행합니다.

## canonical TDD ladder

애플리케이션 기능 테스트는 가장 작은 명시적 dependency boundary에서 시작해 바깥쪽으로 확장합니다.

1. **Unit**: `src/**` 아래 service, controller, helper, failure branch 가까이에 `*.test.ts` 파일을 둡니다. 클래스를 직접 구성하고 명시적 fake를 넘기거나, typed mock이 설정을 읽기 쉽게 만들 때 `@fluojs/testing/mock` 헬퍼를 사용합니다.
2. **Slice/module integration**: DI wiring과 provider override coverage에는 `createTestingModule({ rootModule })` 또는 `Test.createTestingModule({ rootModule })` 기반 `*.slice.test.ts` 파일을 추가합니다.
3. **HTTP e2e-style**: `test/app.e2e.test.ts` 같은 app-level 테스트는 `createTestApp({ rootModule })`, `app.request(...).send()`, 또는 `app.dispatch(...)`로 virtual request pipeline을 검증합니다.
4. **Platform/conformance**: harness subpath는 일반 애플리케이션 기능 coverage가 아니라 adapter/runtime package contract에만 사용합니다.

```txt
src/users/
  users.service.test.ts
  users.controller.test.ts
  users.slice.test.ts

test/
  app.e2e.test.ts
```

fluo는 테스트가 명시적인 `rootModule`을 이름으로 지정해야 한다는 점에서 NestJS와 다릅니다. 테스트 유틸리티는 legacy TypeScript design metadata나 reflection flag에서 dependency를 추론하지 않고, 작성자가 만든 module graph를 컴파일합니다.

## 공개 API

- **루트 패키지**: `createTestingModule(...)`, `createTestApp(...)`, 모듈 introspection 헬퍼, 공용 테스트 타입
- **서브패스**: `@fluojs/testing/app`, `@fluojs/testing/module`, `@fluojs/testing/http`, `@fluojs/testing/mock`, `@fluojs/testing/types`, `@fluojs/testing/vitest`
- **Mock 서브패스**: `@fluojs/testing/mock`
- **HTTP 헬퍼**: `@fluojs/testing/http`
- **하니스 서브패스**: `platform-conformance`, `http-adapter-portability`, `web-runtime-adapter-portability`, `fetch-style-websocket-conformance`
- **도구 지원**: `@fluojs/testing/vitest`와 `fluoBabelDecoratorsPlugin()` (`vitest`와 `@babel/core`를 함께 요구)

## 관련 패키지

- `@fluojs/di`: 테스트 컨테이너가 사용하는 기반 DI 시스템입니다.
- `@fluojs/runtime`: 테스트 빌더가 확장하는 모듈 그래프 로직을 제공합니다.
- `@fluojs/http`: `TestApp`에서 사용하는 가상 디스패치 시스템입니다.

## 예제 소스

- `packages/testing/src/module.test.ts`
- `examples/minimal/src/app.test.ts`
- `examples/auth-jwt-passport/src/app.test.ts`
