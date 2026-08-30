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
- **팩토리 provider**: `{ provide, useFactory, inject }`. 팩토리가 참조 클래스의 `@Scope(...)` 같은 DI metadata를 상속해야 하고 provider `scope`를 명시하지 않았다면 `resolverClass`를 함께 지정합니다.
- **별칭(Alias) provider**: `{ provide: ILogger, useExisting: PinoLogger }`를 사용하여 하나의 토큰을 기존에 등록된 다른 provider로 매핑할 수 있습니다.

### scope-aware 수명 주기 관리

- **singleton**: 루트 컨테이너에서 한 번 생성되어 공유됩니다.
- **request**: `createRequestScope()`마다 새로 생성됩니다.
- **transient**: resolve할 때마다 새 인스턴스를 만듭니다.

dispose 중에는 각 컨테이너가 single-provider cache와 multi-provider cache 전체에서 성공적으로 materialize된 cached instance를 실제 생성 순서의 역순으로 정리하므로, dependency보다 dependent를 먼저 종료합니다. 각 컨테이너는 자신이 소유한 살아 있는 request scope 자식을 먼저 재귀적으로 정리하므로, 루트가 아닌 request scope를 dispose해도 중첩 request scope를 닫은 뒤 자신의 request cache를 정리합니다. 이후 루트 dispose는 자식 dispose 중 하나 이상이 실패하더라도 루트가 소유한 singleton 정리를 계속 수행합니다. 자식/루트 dispose 실패가 여러 개 발생하면 `dispose()`는 모든 shutdown 실패를 확인할 수 있도록 `AggregateError`로 보고합니다.

`dispose()` 시작은 `resolve()`, `register()`, `override()`, `createRequestScope()`에 대해 terminal입니다. 동시 caller는 active disposal 시도를 공유합니다. `onDestroy()` hook이 실패하면 컨테이너는 실패한 hook만 이후 명시적 `dispose()` 재시도를 위해 유지하면서 child-before-parent/root 순서와 생성 역순을 보존합니다. 성공적으로 완료된 hook은 다시 실행하지 않으며, 유지된 hook이 모두 성공한 뒤 disposal은 멱등입니다.

#### disposal 재시도 ownership

Disposal 재시도는 다음 다섯 ownership 규칙을 따릅니다.

1. public `child.dispose()`를 직접 호출하면 request child는 active attempt가 settle된 뒤 parent graph에서 분리됩니다. 유지된 `onDestroy()` hook이 실패해도 분리됩니다.
2. 분리된 child 참조를 유지한 caller는 `dispose()`를 다시 호출할 수 있습니다. 이 호출은 해당 child의 실패한 hook만 재시도하며 성공한 sibling hook은 반복하지 않습니다.
3. parent 또는 root disposal이 먼저 진입한 child는 실패 후에도 parent가 계속 추적합니다. 이후 parent 또는 root `dispose()`는 parent나 root가 유지한 hook보다 그 child를 먼저 재시도합니다.
4. 동시 direct caller와 parent caller는 하나의 active attempt를 공유합니다. shared attempt를 시작한 caller가 direct 또는 parent ownership을 결정합니다. 나중에 참여한 caller는 이를 바꿀 수 없습니다.
5. parent가 유지한 child를 나중에 `child.dispose()`로 직접 재시도하면 해당 direct attempt가 settle된 뒤 child를 분리합니다. direct 재시도가 다시 실패해도 분리됩니다.

실행 가능한 근거는 graph ownership을 검증하는 `packages/di/src/container-disposal-ownership.test.ts`와 failed-hook ordering 및 idempotency를 검증하는 `packages/di/src/container-disposal-retry.test.ts`에 있습니다.

### 2.x에서 3.x로 disposal 마이그레이션

`@fluojs/di` 2.x에서는 실패한 container-managed `onDestroy()` hook을 한 번만 시도했습니다. 3.x에서는 이후 명시적 `Container.dispose()` 호출이나 동일한 컨테이너에 도달하는 application/application-context `close()`가 실패한 hook만 재시도합니다. 이미 성공적으로 완료된 hook은 exactly-once를 유지합니다. 업그레이드하기 전에 실패할 수 있는 cleanup hook이 다시 시도되어도 안전하도록 만드세요. 부분 cleanup을 끝내는 데 필요한 상태를 보존하고, 이미 해제된 resource를 허용하며, 반복된 실패를 shutdown caller에게 전달해야 합니다.

direct `child.dispose()`는 이제 실패한 attempt를 포함해 attempt가 settle된 뒤 request child를 parent에서 분리합니다. direct caller가 해당 실패를 확인하거나 재시도해야 한다면 child 참조를 유지하세요. parent 또는 root가 시작한 disposal의 실패는 cleanup이 성공하거나 이후 direct child attempt가 settle될 때까지 parent hierarchy가 소유합니다. direct caller와 parent caller가 겹치면 shared attempt를 시작한 caller가 detach와 retry semantics를 소유합니다.

### provider override

테스트나 request-local 경계에서 기존 등록을 의도적으로 교체해야 할 때는 `override(...providers)`를 사용합니다. override는 각 토큰의 현재 provider set을 교체하고 현재 컨테이너와 이미 materialize된 request-scope 자식의 cached instance를 무효화하며, 다음 replacement resolution이 계속되기 전에 오래된 instance의 dispose가 끝나도록 보장합니다. multi provider override는 해당 토큰의 전체 multi-provider set을 교체하므로 필요한 replacement provider를 한 번에 모두 전달하세요. 같은 토큰에 single replacement와 multi replacement를 한 override 호출에서 섞으면 모호한 교체로 보고 거부합니다.

실패한 stale `onDestroy()` hook도 일반 disposal과 동일한 retained-retry 계약을 따릅니다. observing container의 다음 resolution이 그 실패를 한 번 노출해 replacement가 계속될 수 있게 하며, 실패한 instance는 해당 cleanup을 예약한 container가 이후 명시적 `dispose()`로 hook을 다시 호출할 때까지 retain됩니다. 이미 성공한 stale hook은 다시 실행하지 않습니다.

### request scope 분리

```ts
const requestContainer = container.createRequestScope();
const scopedService = await requestContainer.resolve(RequestScopedService);
```

request scope 컨테이너는 부모 체인의 provider를 해석할 수 있지만, request가 소유하는 등록은 새 singleton provider를 만들 수 없습니다. singleton provider는 request scope를 만들기 전에 루트 컨테이너에 등록하세요. request scope에 로컬 provider를 추가해야 한다면 `scope: 'request'`/`Scope.REQUEST`를 명시하거나 `override()`로 의도적인 request-local 교체를 표현하세요. multi provider에도 같은 규칙이 적용됩니다. 기본 scope의 multi provider는 루트 컨테이너에 등록하고, request-local multi provider는 request scope를 명시하거나 `override()`로 교체해야 합니다.

provider 객체는 등록 시점에 검증됩니다. 모든 객체 provider는 string, symbol 또는 constructable class `provide` 토큰과 정확히 하나의 전략(`useClass`, `useValue`, `useFactory`, `useExisting`)을 포함해야 합니다. alias provider의 `useExisting`에도 동일한 유효 토큰 형태가 필요합니다. class provider에서 `inject`를 생략하거나 `undefined`로 지정하면 `useClass`의 `@Inject(...)` 메타데이터로 fallback하며, 그 밖의 명시적 `inject` 값은 유효한 token 또는 올바른 `forwardRef(...)` / `optional(...)` wrapper로 구성된 배열이어야 합니다. value provider는 `inject`를 생략해야 하며, 값이 `undefined`인 경우에도 자체 속성으로 선언하면 거부됩니다. 명시적인 `scope` 값은 `singleton`, `request`, `transient` 중 하나여야 합니다. 잘못된 provider 형태는 컨테이너 그래프에 영향을 주기 전에 `InvalidProviderError`를 발생시킵니다.

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

먼저 전체 의존성 그래프를 등록한 다음, `override(...)`와 `useValue`를 사용해 기존 provider를 mock이나 stub으로 교체하세요. `register(...)`는 새 provider를 추가하며 중복 토큰을 거부하고, `override(...)`는 지원되는 교체 API입니다.

```typescript
import { Inject } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { expect, it, vi } from 'vitest';

class Database {
  async query(): Promise<readonly string[]> {
    return ['real row'];
  }
}

@Inject(Database)
class DataService {
  constructor(private readonly database: Database) {}

  async load(): Promise<readonly string[]> {
    return this.database.query();
  }
}

it('uses a mock database', async () => {
  const mockDb = { query: vi.fn().mockResolvedValue(['mock row']) };
  const container = new Container().register(Database, DataService);

  container.override({
    provide: Database,
    useValue: mockDb,
  });

  const service = await container.resolve(DataService);

  await expect(service.load()).resolves.toEqual(['mock row']);
  expect(mockDb.query).toHaveBeenCalledOnce();
});
```

## 문제 해결

### CircularDependencyError
의존성 그래프에서 순환이 감지될 때 발생합니다. 생성자 주입 항목을 확인하고 공유 상태 추출, 중재자 도입, 수명 주기 경계 변경 등으로 순환을 제거하세요. `forwardRef()`는 선언 순서 문제를 위해 토큰 조회만 지연하며, 실제 생성자 순환을 끊지는 않습니다.

### 토큰을 찾을 수 없음 (Token Not Found)
필요한 모든 provider가 컨테이너에 등록되어 있는지 확인하세요. `createRequestScope()`를 사용하는 경우 자식 컨테이너는 부모의 토큰을 해석할 수 있지만, 그 반대는 불가능합니다.

## 공개 API

| Surface | 종류 | 설명 |
|---|---|---|
| `Container` | Root export | 메인 DI 컨테이너 클래스입니다. |
| `container.register(...providers)` | `Container` instance method | 하나 이상의 프로바이더를 등록합니다. |
| `container.override(...providers)` | `Container` instance method | 기존 provider를 교체하고 cached instance를 무효화하며 다음 replacement resolution이 계속되기 전에 오래된 instance dispose가 settle되도록 보장합니다. |
| `container.resolve<T>(token)` | `Container` instance method | 토큰을 인스턴스로 비동기 해석합니다. |
| `container.inspectResolutionState()` | `Container` instance method | snapshot read-only map view, frozen provider record, controlled cache adoption을 통해 cache ownership을 보존해야 하는 testing/tooling helper를 위한 지원 대상 framework-owned container introspection seam을 노출합니다. 애플리케이션 코드는 `has(...)`와 `resolve(...)`를 우선 사용하세요. |
| `container.createRequestScope()` | `Container` instance method | 요청 스코프 의존성을 위한 자식 컨테이너를 생성합니다. |
| `container.has(token)` | `Container` instance method | 컨테이너나 부모에 토큰이 등록되어 있는지 확인합니다. |
| `container.hasRequestScopedDependency(token)` | `Container` instance method | 토큰 해석 시 provider 그래프에 request-scoped 의존성이나 순환이 있어 request-scope 컨테이너가 필요할 수 있는지 확인합니다. |
| `container.dispose()` | `Container` instance method | parent/root cache보다 request child를 먼저 정리하고 active 시도를 공유하며, 이후 명시적 호출에서 실패한 `onDestroy()` hook만 재시도합니다. |
| `forwardRef(fn)` | 선언 순서 문제를 위해 조회를 지연하는 토큰 래퍼를 반환합니다. 실제 생성자 순환을 해석 가능하게 만들지는 않습니다. |
| `isForwardRef(value)` | `forwardRef(...)`가 만든 값인지 확인하는 type guard입니다. 커스텀 provider tooling이 DI token wrapper와 통합될 때 사용할 수 있습니다. |
| `optional(token)` | 하나의 의존성을 optional로 표시하는 토큰 래퍼를 반환합니다. 누락된 optional dependency는 `undefined`로 해석됩니다. |
| `isOptionalToken(value)` | `optional(...)`이 만든 값인지 확인하는 type guard입니다. provider 수준 `inject` 배열을 검사할 때 사용할 수 있습니다. |
| `Scope` | `DEFAULT`, `REQUEST`, `TRANSIENT` scope 상수를 제공합니다. |
| Provider types | `Provider`, `ClassProvider`, `FactoryProvider`, `ValueProvider`, `ExistingProvider`는 `register(...)`와 `override(...)`가 받는 공개 registration shape를 설명합니다. |
| Token wrapper types | `ForwardRefFn`과 `OptionalToken`은 `forwardRef(...)`와 `optional(...)`이 반환하는 wrapper 값을 설명합니다. |
| Container helper types | `ClassType`, `Disposable`, `RequestScopeContainer`는 typed provider 선언, teardown hook, request-scope helper 경계를 지원합니다. |
| Container introspection helper types | `ContainerResolutionState`, `ContainerResolutionCacheOwner`, `ContainerFactoryResolutionState`는 `inspectResolutionState()`가 반환하는 read-only graph/cache view와 controlled cache adoption helper를 설명합니다. |
| `FactoryResolutionKind` | Root export | container 진단과 introspection을 위해 factory provider가 동기적으로 반환했는지(`sync`) 또는 promise를 통해 반환했는지(`async`)를 분류합니다. |
| `NormalizedProvider` | 컨테이너가 검증한 provider record shape를 위한 compatibility-only 공개 타입입니다. provider를 작성할 때는 `Provider`나 구체 provider interface를 우선 사용하세요. normalized record 생성은 컨테이너가 소유합니다. |
| `@fluojs/di/internal` | sibling fluo package가 자체 순회 전에 컨테이너의 canonical provider validation을 적용할 수 있도록 `validateProviderInputs(...)`를 노출하는 package-integration seam입니다. 애플리케이션 코드는 계속 `Container`를 통해 provider를 등록해야 합니다. |
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
