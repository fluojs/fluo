# @konekti/passport

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti의 strategy-agnostic auth 실행 레이어 — 어떤 `AuthStrategy`든 generic `AuthGuard`를 통해 request context에 연결한다.

## 관련 문서

- `../../docs/concepts/auth-and-jwt.md`
- `../../docs/concepts/http-runtime.md`

## 이 패키지가 하는 일

`@konekti/passport`는 어떤 구체적인 auth provider(JWT 파싱, Google OAuth, local 인증 정보)도 구현하지 않는다. 역할은 **어떤 strategy를 꽂더라도** Konekti request lifecycle에서 일관되게 auth가 실행되도록 하는 것이다:

1. `UseAuth('<strategy>')`, `RequireScopes(...)` 데코레이터가 auth 메타데이터를 쓰고 route에 `AuthGuard`를 붙인다
2. request 시점에 `AuthGuard`가 requirement를 읽고, strategy를 이름으로 찾고, `strategy.authenticate(context)`를 호출하고, principal을 얻고, scope를 확인하고, `requestContext.principal`을 채운다
3. auth 에러는 `UnauthorizedException` (401) 또는 `ForbiddenException` (403)으로 매핑된다
4. Passport.js strategy는 `createPassportJsStrategyBridge()`로 bridge할 수 있다

## 설치

```bash
npm install @konekti/passport
```

## 빠른 시작

### Route에 auth requirement 선언

```typescript
import { UseAuth, RequireScopes } from '@konekti/passport';
import { Controller, Get } from '@konekti/http';
import type { RequestContext } from '@konekti/http';

@Controller('/profile')
export class ProfileController {
  @Get('/')
  @UseAuth('jwt')           // 앱에 등록된 strategy 이름
  @RequireScopes('read:profile')
  async getProfile(_: never, ctx: RequestContext) {
    return { user: ctx.principal };
  }
}
```

### Provider 등록 (auth module에서 한 번)

```typescript
import { Module } from '@konekti/core';
import { createPassportProviders } from '@konekti/passport';
import { JwtStrategy } from '@konekti/jwt';

@Module({
  providers: [
    JwtStrategy,
    ...createPassportProviders({ defaultStrategy: 'jwt' }, [{ name: 'jwt', token: JwtStrategy }]),
  ],
})
export class AuthModule {}
```

### AuthStrategy 구현

```typescript
import type { AuthStrategy, GuardContext } from '@konekti/passport';
import { AuthenticationRequiredError } from '@konekti/passport';
import { DefaultJwtVerifier } from '@konekti/jwt';

export class JwtStrategy implements AuthStrategy {
  constructor(private verifier: DefaultJwtVerifier) {}

  async authenticate(context: GuardContext) {
    const authHeader = context.requestContext.request.headers['authorization'];
    const token = authHeader?.replace(/^Bearer /, '');
    if (!token) throw new AuthenticationRequiredError();

    return this.verifier.verifyAccessToken(token);
  }
}
```

### Passport.js strategy bridge

```typescript
import { Module } from '@konekti/core';
import { createPassportJsStrategyBridge, createPassportProviders } from '@konekti/passport';
import { LocalStrategyAdapter } from './local.strategy';

const localBridge = createPassportJsStrategyBridge('local', LocalStrategyAdapter, {
  authenticateOptions: { session: false },
  mapPrincipal: ({ user }) => ({
    subject: String((user as { id: string }).id),
    claims: user as Record<string, unknown>,
  }),
});

@Module({
  providers: [
    LocalStrategyAdapter,
    ...localBridge.providers,
    ...createPassportProviders({ defaultStrategy: 'local' }, [localBridge.strategy]),
  ],
})
export class AuthModule {}
```

## 핵심 API

| Export | 위치 | 설명 |
|---|---|---|
| `AuthStrategy` | `src/types.ts` | 인터페이스: `authenticate(context) → AuthStrategyResult` |
| `AuthStrategyResult` | `src/types.ts` | `Principal` 또는 `{ handled: true, principal? }` |
| `AuthGuard` | `src/guard.ts` | auth requirement를 읽고 strategy를 호출하는 generic guard |
| `UseAuth(strategyName)` | `src/decorators.ts` | strategy 설정 + route에 `AuthGuard` 부착 |
| `RequireScopes(...scopes)` | `src/decorators.ts` | 필요한 scope 선언 + `AuthGuard` 부착 |
| `createPassportProviders(opts)` | `src/module.ts` | strategy registry와 default strategy wiring 등록 |
| `createPassportJsStrategyBridge(...)` | `src/passport-js.ts` | Passport.js strategy를 Konekti `AuthStrategy`로 감쌈 |
| `AuthRequirement` | `src/types.ts` | `{ strategy?, scopes? }` — class + method 레벨에서 merge됨 |

## 구조

### Guard 실행 흐름

```text
@UseAuth / @RequireScopes가 있는 route에 request 도착
  → AuthGuard.canActivate(context)
  → merge된 auth requirement 읽기 (class + method)
  → strategy 이름 결정 (명시적 또는 default)
  → request-scoped container에서 strategy resolve
  → strategy.authenticate(context)
  → strategy가 auth error를 throw하면 → UnauthorizedException (401) 또는 ForbiddenException (403)로 매핑
  → principal이 반환되면 → scope 확인
  → scope가 없으면 → ForbiddenException (403) throw
  → requestContext.principal = principal
```

### auth 메타데이터가 merge 시맨틱을 사용하는 이유

`@UseAuth`와 `@RequireScopes`는 class 레벨과 method 레벨 모두에 적용할 수 있다. guard는 merge된 requirement를 읽는다: class 레벨의 strategy에 method별 scope를 추가하는 패턴이 일반적이다. `src/metadata.ts`의 메타데이터 레이어가 이 merge 로직을 소유한다.

### AuthGuard는 설계상 provider에 독립적이다

`AuthGuard`는 JWT, Google, 또는 어떤 구체 provider도 참조하지 않는다. 오직:
- strategy *이름* 파악
- DI container에서 strategy *인스턴스* 찾기
- `authenticate` 호출
- 결과를 `principal` 또는 exception으로 매핑

이는 새로운 auth strategy 추가 시 `AuthStrategy`를 구현하고 등록하기만 하면 된다는 것을 의미한다 — guard는 변경되지 않는다.

### Passport.js bridge

`createPassportJsStrategyBridge()`는 Passport.js의 `success`/`fail`/`redirect`/`error` callback 프로토콜을 Konekti의 `AuthStrategyResult`로 변환한다. `mapPrincipal` 인수는 passport user 객체를 Konekti `Principal` shape으로 정규화한다. bridge는 계정 upsert나 JWT 발급을 소유하지 않는다 — 그것들은 app service 코드의 책임이다.

public package는 auth error 클래스, bridge 타입, metadata helper, `AUTH_STRATEGY_REGISTRY`, `PASSPORT_OPTIONS`도 `src/index.ts`에서 함께 export한다.

## 파일 읽기 순서 (기여자용)

1. `src/types.ts` — `AuthStrategy`, `AuthStrategyResult`, `AuthRequirement`, `GuardContext`
2. `src/metadata.ts` — class + method requirement 저장과 merge
3. `src/decorators.ts` — `UseAuth`, `RequireScopes` — 메타데이터 쓰기 + `AuthGuard` 부착
4. `src/errors.ts` — auth-specific 에러 타입
5. `src/guard.ts` — `AuthGuard` — strategy lookup, authenticate, scope 확인, principal 채우기
6. `src/module.ts` — `createPassportProviders`
7. `src/passport-js.ts` — `createPassportJsStrategyBridge`
8. `src/guard.test.ts` — non-JWT strategy 흐름, 401/403 매핑, principal 채우기, scope 강제, Passport.js bridge 경로

## 관련 패키지

- `@konekti/jwt` — JWT token 검증을 사용해 `AuthStrategy`를 구현; strategy 코드는 이 패키지가 아니라 앱에 있음
- `@konekti/http` — `AuthGuard`는 `@konekti/http` dispatcher의 guard chain에서 동작

## 한 줄 mental model

```text
@konekti/passport = strategy-agnostic auth 실행: 어떤 AuthStrategy든 → AuthGuard → RequestContext의 principal
```
