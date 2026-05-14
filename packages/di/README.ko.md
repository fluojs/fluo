# @fluojs/di

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

모든 fluo 애플리케이션을 구동하는 최소 토큰 기반 의존성 주입 컨테이너입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 기능](#주요-기능)
- [순환 의존성 처리](#순환-의존성-처리)
- [테스트 및 모킹](#테스트-및-모킹)
- [문제 해결](#문제-해결)
- [공개 API](#공개-api)
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
- **별칭(Alias) provider**: `{ provide: ILogger, useExisting: PinoLogger }`를 사용하여 하나의 토큰을 기존에 등록된 다른 provider로 매핑할 수 있습니다.

### scope-aware 수명 주기 관리

- **singleton**: 루트 컨테이너에서 한 번 생성되어 공유됩니다.
- **request**: `createRequestScope()`마다 새로 생성됩니다.
- **transient**: resolve할 때마다 새 인스턴스를 만듭니다.

dispose 중에는 루트 컨테이너가 먼저 살아 있는 request scope 자식을 정리한 뒤, 자식 dispose 중 하나 이상이 실패하더라도 루트가 소유한 singleton 정리를 계속 수행합니다. 자식/루트 dispose 실패가 여러 개 발생하면 `dispose()`는 모든 shutdown 실패를 확인할 수 있도록 `AggregateError`로 보고합니다.

### provider override

테스트나 request-local 경계에서 기존 등록을 의도적으로 교체해야 할 때는 `override(...providers)`를 사용합니다. override는 각 토큰의 현재 provider set을 교체하고 현재 컨테이너와 이미 materialize된 request-scope 자식의 cached instance를 무효화하며, 오래된 instance를 즉시 dispose합니다. multi provider override는 해당 토큰의 전체 multi-provider set을 교체하므로 필요한 replacement provider를 한 번에 모두 전달하세요. 같은 토큰에 single replacement와 multi replacement를 한 override 호출에서 섞으면 모호한 교체로 보고 거부합니다.

### request scope 분리

```ts
const requestContainer = container.createRequestScope();
const scopedService = await requestContainer.resolve(RequestScopedService);
```

request scope 컨테이너는 부모 체인의 provider를 해석할 수 있지만, request가 소유하는 등록은 새 singleton provider를 만들 수 없습니다. singleton provider는 request scope를 만들기 전에 루트 컨테이너에 등록하세요. request scope에 로컬 provider를 추가해야 한다면 `scope: 'request'`/`Scope.REQUEST`를 명시하거나 `override()`로 의도적인 request-local 교체를 표현하세요. multi provider에도 같은 규칙이 적용됩니다. 기본 scope의 multi provider는 루트 컨테이너에 등록하고, request-local multi provider는 request scope를 명시하거나 `override()`로 교체해야 합니다.

provider 객체는 등록 시점에 검증됩니다. 모든 객체 provider는 null이 아닌 `provide` 토큰과 정확히 하나의 전략(`useClass`, `useValue`, `useFactory`, `useExisting`)을 포함해야 합니다. 잘못된 provider 형태는 컨테이너 그래프에 영향을 주기 전에 `InvalidProviderError`를 발생시킵니다.

## 순환 의존성 처리

컨테이너는 순환 의존성을 자동으로 감지하고 `CircularDependencyError`를 발생시켜 무한 루프를 방지합니다. 여기에는 직접 참조(A→A), 이중 노드(A→B→A), 깊은 순환(A→B→C→A)이 모두 포함됩니다.

선언 순서 때문에 아직 정의되지 않은 토큰을 참조해야 한다면 `forwardRef()`를 사용하세요. `forwardRef()`는 선언 순서 문제를 위해 토큰 조회를 지연할 뿐이며, 실제 생성자 순환을 해소하지는 않습니다. 그런 순환은 여전히 `CircularDependencyError`로 거부됩니다.

```typescript
import { forwardRef } from '@fluojs/di';
import { Inject } from '@fluojs/core';

@Inject(forwardRef(() => ServiceB))
class ServiceA {
  constructor(private readonly serviceB: ServiceB) {}
}

class ServiceB {
  getStatus() {
    return 'ready';
  }
}
```

`forwardRef(...)`와 `optional(...)`은 클래스 수준 `@Inject(...)` 토큰 목록이나 provider 수준 `inject` 배열 안에서 쓰는 토큰 래퍼입니다. 이들은 데코레이터가 아니며 constructor parameter에 붙이지 않습니다.

```typescript
import { optional } from '@fluojs/di';
import { Inject } from '@fluojs/core';

@Inject(optional(AuditLogger))
class ServiceWithOptionalLogger {
  constructor(private readonly auditLogger: AuditLogger | undefined) {}
}
```

## 테스트 및 모킹

`useValue`를 사용하면 단위 테스트 중에 컨테이너의 provider를 모의 객체(mock)나 스텁(stub)으로 쉽게 교체할 수 있습니다.

```typescript
import { Container } from '@fluojs/di';

const container = new Container();
const mockDb = { query: vi.fn() };

// 실제 Database 클래스를 모의 객체 값으로 교체
container.register({ 
  provide: Database, 
  useValue: mockDb 
});

const service = await container.resolve(DataService);
// service는 실제 Database 인스턴스 대신 mockDb를 사용합니다.
```

## 문제 해결

### CircularDependencyError
의존성 그래프에서 순환이 감지될 때 발생합니다. 생성자 주입 항목을 확인하고 공유 상태 추출, 중재자 도입, 수명 주기 경계 변경 등으로 순환을 제거하세요. `forwardRef()`는 선언 순서 문제를 위해 토큰 조회만 지연하며, 실제 생성자 순환을 끊지는 않습니다.

### 토큰을 찾을 수 없음 (Token Not Found)
필요한 모든 provider가 컨테이너에 등록되어 있는지 확인하세요. `createRequestScope()`를 사용하는 경우 자식 컨테이너는 부모의 토큰을 해석할 수 있지만, 그 반대는 불가능합니다.

## 공개 API

| Export | 설명 |
|---|---|
| `Container` | 메인 DI 컨테이너 클래스입니다. |
| `register(...providers)` | 하나 이상의 프로바이더를 등록합니다. |
| `override(...providers)` | 기존 provider를 교체하고 cached instance를 무효화하며 오래된 instance를 dispose합니다. |
| `resolve<T>(token)` | 토큰을 인스턴스로 비동기 해석합니다. |
| `createRequestScope()` | 요청 스코프 의존성을 위한 자식 컨테이너를 생성합니다. |
| `has(token)` | 컨테이너나 부모에 토큰이 등록되어 있는지 확인합니다. |
| `hasRequestScopedDependency(token)` | 토큰 해석 시 provider 그래프에 request-scoped 의존성이나 순환이 있어 request-scope 컨테이너가 필요할 수 있는지 확인합니다. |
| `dispose()` | request child와 루트가 소유한 singleton instance를 정리합니다. |
| `forwardRef(fn)` | 선언 순서 문제를 위해 조회를 지연하는 토큰 래퍼를 반환합니다. 실제 생성자 순환을 해석 가능하게 만들지는 않습니다. |
| `isForwardRef(value)` | `forwardRef(...)`가 만든 값인지 확인하는 type guard입니다. 커스텀 provider tooling이 DI token wrapper와 통합될 때 사용할 수 있습니다. |
| `optional(token)` | 하나의 의존성을 optional로 표시하는 토큰 래퍼를 반환합니다. 누락된 optional dependency는 `undefined`로 해석됩니다. |
| `isOptionalToken(value)` | `optional(...)`이 만든 값인지 확인하는 type guard입니다. provider 수준 `inject` 배열을 검사할 때 사용할 수 있습니다. |
| `Scope` | `DEFAULT`, `REQUEST`, `TRANSIENT` scope 상수를 제공합니다. |
| Provider types | `Provider`, `ClassProvider`, `FactoryProvider`, `ValueProvider`, `ExistingProvider`는 `register(...)`와 `override(...)`가 받는 공개 registration shape를 설명합니다. |
| Token wrapper types | `ForwardRefFn`과 `OptionalToken`은 `forwardRef(...)`와 `optional(...)`이 반환하는 wrapper 값을 설명합니다. |
| Container helper types | `ClassType`, `Disposable`, `RequestScopeContainer`는 typed provider 선언, teardown hook, request-scope helper 경계를 지원합니다. |
| `NormalizedProvider` | 컨테이너가 검증한 provider record shape를 위한 compatibility-only 공개 타입입니다. provider를 작성할 때는 `Provider`나 구체 provider interface를 우선 사용하세요. normalized record 생성은 컨테이너가 소유합니다. |
| `DiErrorContext` | DI error에 붙는 구조화된 context입니다. 로그와 테스트가 token, scope, module, dependency chain, hint를 검사할 수 있게 합니다. |
| 에러 클래스 | `InvalidProviderError`, `ContainerResolutionError`, `RequestScopeResolutionError`, `ScopeMismatchError`, `CircularDependencyError`, `DuplicateProviderError`. |

multi-provider 토큰을 resolve하면 등록 순서대로 해석된 값의 배열이 반환됩니다.

## 관련 패키지

- `@fluojs/core`: `@Inject()`와 `@Scope()` 데코레이터를 정의합니다.
- `@fluojs/runtime`: 부트스트랩 중 provider 등록과 모듈 그래프 조립을 담당합니다.
- `@fluojs/http`: 들어오는 요청마다 request scope를 생성합니다.

## 예제 소스

- `packages/di/src/container.ts`
- `packages/di/src/container.test.ts`
- `examples/minimal/src/app.ts`
