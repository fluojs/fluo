# @konekti/testing

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션 테스트를 위한 공식 모듈 구성 및 프로바이더 오버라이드 baseline입니다.

## 관련 문서

- `../../docs/operations/testing-guide.md`
- `../../docs/concepts/architecture-overview.md`

## 이 패키지가 하는 일

`@konekti/testing`은 Konekti 모듈 그래프 안에서 격리된 테스트 환경을 구성하는 최소한의 API를 제공합니다. 루트 모듈을 넘기고, 가짜 구현이나 스파이로 교체할 프로바이더를 오버라이드하고, 그래프를 컴파일한 다음, 토큰을 resolve해서 검증하고 싶은 인스턴스를 얻으면 됩니다.

이 패키지는 프로덕션 런타임에 **참여하지 않습니다** — 테스트 모듈은 테스트 환경에서만 존재합니다. 의도적으로 baseline입니다: 완성된 픽스처 라이브러리가 아니라, 위에 무언가를 쌓을 수 있는 안정적인 기반입니다. `makeRequest`, `createMock`, `asMock` 같은 작은 헬퍼는 이미 포함하지만, 전체 픽스처 프레임워크를 지향하지는 않습니다.

## 설치

```bash
npm install --save-dev @konekti/testing
```

## 빠른 시작

### 기본 테스트 설정

```typescript
import { createTestingModule } from '@konekti/testing';
import { AppModule } from '../src/app.module';
import { UserService } from '../src/user/user.service';
import { USER_REPOSITORY } from '../src/user/tokens';

describe('UserService', () => {
  it('사용자를 생성한다', async () => {
    const fakeRepo = {
      create: jest.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
      findById: jest.fn(),
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

### 토큰 직접 resolve

```typescript
// 클래스 참조로 resolve
const service = await module.resolve(UserService);

// DI 토큰(심볼 또는 문자열)으로 resolve
const config = await module.resolve(CONFIG_TOKEN);
```

## 핵심 API

### `createTestingModule(options)`

진입점입니다. 빌더 객체를 반환합니다.

```typescript
interface TestingModuleOptions {
  rootModule: ModuleType;
}

createTestingModule(options: TestingModuleOptions): TestingModuleBuilder
```

### `TestingModuleBuilder`

`createTestingModule`이 반환하는 플루언트 빌더입니다.

| 메서드 | 설명 |
|---|---|
| `.overrideProvider(token, implementation)` | 그래프가 컴파일되기 전에 DI 토큰의 프로바이더를 `implementation`으로 교체합니다. 체이닝 가능합니다. |
| `.compile()` | 모든 오버라이드가 적용된 모듈 그래프를 컴파일합니다. `Promise<TestingModuleRef>`을 반환합니다. |

### `TestingModuleRef`

컴파일된 테스트 컨테이너입니다.

| 메서드 | 설명 |
|---|---|
| `.resolve(token)` | 컴파일된 모듈 그래프에서 프로바이더를 resolve합니다. 클래스 생성자 또는 DI 토큰을 받고 `Promise<T>`를 반환합니다. |
| `.has(token)` | 컴파일된 그래프에 해당 provider 토큰이 있는지 확인합니다. |

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
