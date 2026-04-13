# @fluojs/testing

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션 테스트를 위한 모듈 구성 및 프로바이더 오버라이드 유틸리티입니다.

`@fluojs/testing`은 fluo 애플리케이션 테스트를 위한 공식적인 기준(Baseline)을 제공합니다. 격리된 테스트 환경을 구축하고, 의존성을 가짜(Fake)나 목(Mock)으로 교체하며, 모듈 그래프에서 직접 컴포넌트를 resolve하거나 가상 HTTP 요청을 디스패치하여 통합 테스트를 수행할 수 있게 합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [공개 API 개요](#공개-api-개요)
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

배포된 런타임 import가 안정적으로 해석되도록, mock 헬퍼를 사용할 워크스페이스에는 `vitest`를 함께 설치해야 합니다.

### 적합성 및 이식성 하니스

프레임워크 지향 플랫폼 패키지를 작성할 때는 `@fluojs/testing/platform-conformance`, `@fluojs/testing/http-adapter-portability`, `@fluojs/testing/web-runtime-adapter-portability` 같은 서브패스를 사용해 적합성 및 이식성 검증을 수행합니다.

## 공개 API 개요

- **루트 패키지**: `createTestingModule(...)`, `createTestApp(...)`, 모듈 introspection 헬퍼, 공용 테스트 타입
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
