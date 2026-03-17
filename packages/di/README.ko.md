# @konekti/di

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


모든 Konekti 앱을 구동하는 최소 토큰 기반 DI 컨테이너.

## 관련 문서

- `../../docs/concepts/di-and-modules.md`
- `../../docs/concepts/architecture-overview.md`

## 이 패키지가 하는 일

`@konekti/di`는 명시적 토큰 기반 의존성 주입 컨테이너를 제공한다. 세 가지 provider shape(class, factory, value), 세 가지 scope(singleton, request, transient), 네 가지 메서드로 구성된 public API를 처리한다. 목표는 full-featured DI 프레임워크가 아니라, Konekti의 bootstrap과 request lifecycle 시나리오를 안정적으로 처리하는 최소 컨테이너다.

애플리케이션 클래스에 붙이는 `@Inject()`와 `@Scope()` 데코레이터는 `@konekti/core`에 있다. 이 패키지는 그 메타데이터를 읽어 토큰을 인스턴스로 바꾸는 컨테이너 런타임을 소유한다.

## 설치

```bash
npm install @konekti/di
```

## 빠른 시작

```typescript
import { Container } from '@konekti/di';
import { Inject, Scope } from '@konekti/core';

const LOGGER = Symbol('Logger');

class Logger {
  log(msg: string) { console.log(msg); }
}

@Inject([LOGGER])
@Scope('singleton')
class UserService {
  constructor(private logger: Logger) {}

  greet(name: string) {
    this.logger.log(`Hello, ${name}`);
  }
}

const container = new Container();
container.register(
  { provide: LOGGER, useClass: Logger },
  UserService,
);

const svc = container.resolve<UserService>(UserService);
svc.greet('world');
```

### Request scope

```typescript
const requestContainer = container.createRequestScope();

// request-scoped provider는 요청마다 격리된다
const handler = requestContainer.resolve<RequestHandler>(RequestHandler);
```

## 핵심 API

| Export | 위치 | 설명 |
|---|---|---|
| `Container` | `src/container.ts` | DI 컨테이너 |
| `container.register(...providers)` | `src/container.ts` | 하나 이상의 provider 등록 |
| `container.has(token)` | `src/container.ts` | 토큰 등록 여부 확인 |
| `container.resolve<T>(token)` | `src/container.ts` | 토큰을 인스턴스로 resolve |
| `container.createRequestScope()` | `src/container.ts` | 단일 요청용 child container 생성 |
| `ClassProvider` | `src/types.ts` | `{ provide, useClass, scope? }` |
| `FactoryProvider` | `src/types.ts` | `{ provide, useFactory, inject?, scope? }` |
| `ValueProvider` | `src/types.ts` | `{ provide, useValue }` |
| `Scope` | `src/types.ts` | `'singleton' \| 'request' \| 'transient'` |

추가 public export로는 `Provider`, `RequestScopeContainer`, `NormalizedProvider`, 그리고 `src/errors.ts`의 타입이 있는 DI 에러들이 있다.

## 구조

### Provider 정규화

들어오는 모든 provider shape — 순수 class, `useClass`, `useFactory`, `useValue` — 는 저장 전에 `NormalizedProvider`로 정규화된다. 덕분에 resolve 경로가 shape에 따라 분기하지 않아도 된다: 어떤 inject list를 쓸지, 어떤 scope인지, 어떤 instantiation 경로인지를 항상 알 수 있다.

### Scope-aware 캐싱

컨테이너는 **provider를 어디서 찾는가**와 **인스턴스를 어디에 캐시하는가**를 분리한다:

- **singleton** → root 컨테이너에 캐시, 모든 요청에서 공유
- **request** → `createRequestScope()`로 생성된 child 컨테이너에 캐시
- **transient** → resolve할 때마다 새 인스턴스 생성, 캐시하지 않음

provider는 root에 등록되지만 request child에 캐시될 수 있다. 이것이 request-scoped provider가 재등록 없이 요청마다 분리되는 메커니즘이다.

### root에서 request-scoped provider를 resolve하면 왜 실패하나

root 컨테이너에서 `request`-scoped provider를 직접 resolve하면 에러가 발생한다. 이것은 의도적인 안전장치다 — request scope에는 request boundary가 필요하고, root에서 resolve를 허용하면 request 의존성이 조용히 singleton처럼 동작하게 된다.

### Instantiation 경로

```text
value   → 값을 직접 반환
factory → inject deps resolve 후 useFactory(...deps) 호출
class   → inject deps resolve 후 new useClass(...deps) 호출
```

## 파일 읽기 순서 (기여자용)

1. `packages/core/src/decorators.ts` — `@Inject()`, `@Scope()` 데코레이터 정의
2. `src/types.ts` — `ClassProvider`, `FactoryProvider`, `ValueProvider`, `Scope`
3. `src/container.ts` — `normalizeProvider`, `register`, `resolve`, `createRequestScope`
4. `src/errors.ts` — 타입이 있는 DI 에러
5. `src/container.test.ts` — singleton 캐싱, factory 주입, request 격리

## 관련 패키지

- `@konekti/core` — `Token`, `@Inject()`, `@Scope()` 데코레이터 정의
- `@konekti/runtime` — bootstrap 시 module graph를 조립하고 `container.register()` 호출
- `@konekti/http` — 들어오는 HTTP 요청마다 request scope container 생성

## 한 줄 mental model

```text
@konekti/di = normalized provider와 scope-aware cache로 토큰을 실제 인스턴스로 바꾸는 최소 컨테이너
```
