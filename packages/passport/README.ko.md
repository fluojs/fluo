# @fluojs/passport

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 인증 실행 계층으로, 어떤 `AuthStrategy`든 공통 `AuthGuard`를 통해 요청 컨텍스트(`requestContext.principal`)에 연결합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/passport
```

## 사용 시점

- 애플리케이션에 인증 및 권한 부여(RBAC/Scopes) 기능을 추가해야 할 때.
- 하나의 애플리케이션에서 여러 인증 방식(JWT, 쿠키, API 키 등)을 혼합하여 사용할 때.
- 기존 Passport.js 전략들을 fluo의 DI 및 비동기 환경에서 재사용하고 싶을 때.
- 리프레시 토큰 로테이션이나 계정 연결 정책을 구현할 때.

## 빠른 시작

### 1. 모듈 등록

사용할 전략을 정의하고 `PassportModule.forRoot(...)`를 통해 등록합니다.

```typescript
import { Inject, Module } from '@fluojs/core';
import type { GuardContext } from '@fluojs/http';
import { DefaultJwtVerifier, JwtModule } from '@fluojs/jwt';
import { AuthenticationRequiredError, PassportModule, type AuthStrategy } from '@fluojs/passport';

@Inject(DefaultJwtVerifier)
export class BearerJwtStrategy implements AuthStrategy {
  constructor(private readonly verifier: DefaultJwtVerifier) {}

  async authenticate(context: GuardContext) {
    const authorization = context.requestContext.request.headers.authorization;
    const [scheme, token] = typeof authorization === 'string' ? authorization.split(' ') : [];

    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationRequiredError('Bearer access token is required.');
    }

    return this.verifier.verifyAccessToken(token);
  }
}

@Module({
  imports: [
    JwtModule.forRoot({
      algorithms: ['HS256'],
      audience: 'my-app',
      issuer: 'my-api',
      secret: 'your-secure-secret',
    }),
    PassportModule.forRoot(
      { defaultStrategy: 'jwt' },
      [{ name: 'jwt', token: BearerJwtStrategy }],
    ),
  ],
  providers: [BearerJwtStrategy],
})
export class AuthModule {}
```

JWT 기반 passport 전략에는 두 가지 module wiring이 모두 필요합니다. `JwtModule.forRoot(...)`는 `DefaultJwtVerifier`를 등록하고, `PassportModule.forRoot(...)`는 `@UseAuth('jwt')`가 resolve할 named strategy를 등록합니다. `DefaultJwtVerifier.verifyAccessToken(...)` 결과를 반환하면 `AuthGuard`가 `requestContext.principal`에 기록하는 정규화 principal 계약(`subject`, `claims`, `issuer`, `audience`, `roles`, `scopes`)이 보존됩니다.

### 2. 라우트 보호

`@UseAuth()`와 `@RequireScopes()`를 사용하여 인증을 강제합니다.

```typescript
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { UseAuth, RequireScopes } from '@fluojs/passport';

@Controller('/profile')
export class ProfileController {
  @Get('/')
  @UseAuth('jwt')
  @RequireScopes('profile:read')
  async getProfile(input: never, ctx: RequestContext) {
    return { user: ctx.principal };
  }
}
```

## 일반적인 패턴

### Passport.js 브릿지 (Bridge)

표준 Passport.js 전략(예: `passport-google-oauth20`)을 fluo의 DI와 비동기 수명 주기에 맞춰 쉽게 변환하여 사용할 수 있습니다.

```typescript
const googleBridge = createPassportJsStrategyBridge('google', GoogleStrategy, {
  mapPrincipal: ({ user }) => ({ subject: user.id, claims: user }),
});
```

브릿지는 각 Passport.js 전략 실행을 정확히 한 번만 정착(settle)시킵니다. 전략은 바인딩된 Passport 액션(`success`, `fail`, `redirect`, `pass`, `error`) 중 하나를 호출해야 하며, promise rejection, 액션 없이 완료된 promise, 그리고 제한된 action timeout을 초과한 callback-style 실행은 요청을 미해결 상태로 두지 않고 인증 실패로 처리됩니다. 커스텀 `mapPrincipal` 함수는 비어 있지 않은 `subject`와 객체 형태의 `claims`를 포함한 유효한 fluo `Principal`을 반환해야 합니다.

### 쿠키 인증 프리셋

HTTP 쿠키에서 인증 정보를 읽는 애플리케이션이라면 `CookieAuthModule.forRoot(...)`를 사용합니다.

```typescript
import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import {
  CookieAuthModule,
  CookieAuthStrategy,
  COOKIE_AUTH_STRATEGY_NAME,
  PassportModule,
} from '@fluojs/passport';

@Module({
  imports: [
    CookieAuthModule.forRoot(),
    JwtModule.forRoot({
      algorithms: ['HS256'],
      secret: 'your-secure-secret',
    }),
    PassportModule.forRoot(
      { defaultStrategy: COOKIE_AUTH_STRATEGY_NAME },
      [{ name: COOKIE_AUTH_STRATEGY_NAME, token: CookieAuthStrategy }],
    ),
  ],
})
export class AuthModule {}
```

애플리케이션 모듈에서 cookie-auth 지원이 필요하면 `CookieAuthModule.forRoot(...)`, `JwtModule.forRoot(...)`, `PassportModule.forRoot(...)`를 함께 import 하세요. Cookie preset은 `CookieAuthStrategy`와 cookie option을 제공하고, JWT 검증은 여전히 `@fluojs/jwt`에서 오며, passport registry는 여전히 `PassportModule.forRoot(...)`에서 옵니다.

`CookieAuthStrategy`는 `@fluojs/jwt`가 정규화한 JWT principal 계약을 보존하며, `subject`, `claims`, `issuer`, `audience`, `roles`, `scopes`를 그대로 전달합니다.

Cookie access token은 비어 있지 않은 문자열이어야 합니다. `requireAccessToken: false`일 때만 누락된 cookie가 `{ authenticated: false }`로 resolve될 수 있으며, 존재하지만 malformed인 cookie 값은 JWT 검증 전에 항상 인증 실패로 처리됩니다.

보호된 라우트는 계속 `@UseAuth(...)`를 사용해야 합니다. `requireAccessToken: false`를 설정해도 쿠키가 없을 때는 익명 principal이 아니라 명시적인 미인증 결과를 반환하므로, 보호된 라우트는 요청을 계속 거부합니다.

로그인 사용자와 게스트 호출자를 모두 허용하려는 라우트에서만 `@UseOptionalAuth(...)`를 사용하세요.

```typescript
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { UseOptionalAuth } from '@fluojs/passport';

@Controller('/session')
export class SessionController {
  @Get('/')
  @UseOptionalAuth('cookie')
  getSession(_input: never, ctx: RequestContext) {
    return { subject: ctx.principal?.subject ?? null };
  }
}
```

### 리프레시 토큰 수명 주기

패키지는 안전한 토큰 rotation과 revocation을 위해 built-in `RefreshTokenStrategy`, `RefreshTokenModule`, `RefreshTokenService` contract를 제공합니다.

```typescript
import { Module } from '@fluojs/core';
import { Controller, Post, type RequestContext } from '@fluojs/http';
import {
  PassportModule,
  REFRESH_TOKEN_STRATEGY_NAME,
  RefreshTokenModule,
  RefreshTokenStrategy,
  UseAuth,
} from '@fluojs/passport';

@Module({
  imports: [
    RefreshTokenModule.forRoot(MyRefreshTokenService),
    PassportModule.forRoot(
      { defaultStrategy: REFRESH_TOKEN_STRATEGY_NAME },
      [{ name: REFRESH_TOKEN_STRATEGY_NAME, token: RefreshTokenStrategy }],
    ),
  ],
  providers: [MyRefreshTokenService],
})
export class AuthModule {}

@Controller('/auth')
export class AuthController {
  @Post('/refresh')
  @UseAuth('refresh-token')
  async refresh(input: never, ctx: RequestContext) {
    return ctx.principal; // 새 토큰 쌍이 포함된 principal 반환
  }
}
```

`RefreshTokenModule.forRoot(...)`를 `PassportModule.forRoot(...)`와 함께 import 하여 refresh-token 전략과 공유 `REFRESH_TOKEN_SERVICE` alias를 같은 모듈 wiring에서 사용하세요.

`RefreshTokenStrategy`는 `body.refreshToken`, `Authorization: Bearer ...`, `x-refresh-token`에서 token을 읽습니다. Malformed non-string token은 인증 실패로 처리됩니다. Rotation 후에는 `@fluojs/jwt`가 반환한 정규화 access-token principal subject를 신뢰합니다. `JwtRefreshTokenAdapter`는 `secret`과 backing store가 필요하며, `store: 'memory'`는 development 및 single-instance deployment용이고 rotation은 store consume contract를 통해 재사용을 감지합니다.

### Account linking과 status

Identity-link 결정을 모델링하려면 `createConservativeAccountLinkPolicy(...)`와 `resolveAccountLinking(...)`을 사용합니다. 기본 conservative policy는 모호하지 않은 단일 existing account link 또는 user-confirmed match만 연결하고, 여러 existing link는 conflict로 보고하며, 그 외에는 create/skip/reject/conflict를 결정적으로 처리합니다.

`createPassportPlatformStatusSnapshot(...)`와 `createPassportPlatformDiagnosticIssues(...)`는 등록된 strategy, default strategy 설정, preset, refresh-token store readiness에 대한 readiness/health diagnostic을 노출합니다.

## 공개 API 개요

### 데코레이터
- `@UseAuth(strategyName)`: `AuthGuard`를 부착하고 사용할 전략을 설정합니다.
- `@UseOptionalAuth(strategyName)`: `AuthGuard`를 부착하지만 전략이 자격 증명 누락을 보고하면 스코프가 없는 라우트는 계속 진행할 수 있게 합니다.
- `@RequireScopes(...scopes)`: 특정 권한(스코프) 요구 사항을 강제합니다.

### 모듈 및 가드 진입점
- `PassportModule`: passport 전략 wiring을 위한 모듈 진입점입니다.
- `AuthGuard`: 전략 체인을 실행하고 required scope를 강제하는 HTTP 가드입니다.
- `PassportModuleOptions`, `AuthStrategyRegistration`, `AuthStrategyRegistry`, `AuthGuardContract`: Strategy registry 및 guard wiring 계약입니다.

### 전략 계약 및 에러
- `AuthStrategy`: 커스텀 인증 로직 구현을 위한 계약입니다.
- `AuthRequirement`: 선택된 strategy, optional-auth mode, required scope를 담는 route-level metadata입니다.
- `AuthStrategyResult`, `AuthOptionalResult`, `AuthHandledResult`: Principal, 의도적으로 누락된 credential, 이미 처리된 response를 표현하는 strategy return variant입니다.
- `AuthStrategyResolutionError`, `AuthenticationRequiredError`, `AuthenticationFailedError`, `AuthenticationExpiredError`: Registry miss, 누락된 credential, 잘못된 credential, 만료된 credential에 대해 guard와 strategy adapter가 사용하는 공개 error입니다.

### Metadata 및 scope helper
- `defineAuthRequirement(...)`, `getOwnAuthRequirement(...)`, `getAuthRequirement(...)`: Custom decorator나 tooling을 `AuthGuard`와 통합할 때 auth requirement metadata를 읽고 쓰는 공개 helper입니다.
- Scope requirement는 일반적으로 `@RequireScopes(...)`로 작성합니다. 더 낮은 수준의 scope normalization helper는 internal로 남아 있으며 package root export의 일부가 아닙니다.

### Cookie auth preset
- `CookieAuthModule`: 내장 cookie-auth preset의 모듈 진입점입니다.
- `CookieAuthStrategy`, `COOKIE_AUTH_STRATEGY_NAME`, `COOKIE_AUTH_OPTIONS`, `DEFAULT_COOKIE_AUTH_OPTIONS`: Cookie strategy wiring token과 기본값입니다.
- `CookieAuthOptions`, `CookieAuthPresetConfig`, `CookieManagerConfig`, `CookieOptions`, `SetCookieOptions`: Cookie strategy 및 response cookie 설정 타입입니다.
- `CookieManager`: HttpOnly access/refresh token cookie를 설정하고 제거하는 유틸리티입니다.
- Cookie helper: `createCookieAuthPreset`, `createCookieAuthStrategyRegistration`, `createCookieManager`, `normalizeCookieAuthOptions`.

### Refresh token preset
- `RefreshTokenModule`: 내장 refresh-token preset의 모듈 진입점입니다.
- `RefreshTokenStrategy`, `REFRESH_TOKEN_STRATEGY_NAME`, `REFRESH_TOKEN_SERVICE`: Refresh-token strategy 및 service alias wiring입니다.
- `RefreshTokenService`, `RefreshTokenInput`, `RefreshTokenAuthResult`: Application service contract와 exchange payload shape입니다.
- `JwtRefreshTokenAdapter`: `@fluojs/jwt`의 refresh logic을 passport interface로 연결합니다.
- `REFRESH_TOKEN_MODULE_OPTIONS`, `RefreshTokenModuleOptions`: 필수 `secret`과 `store` 계약을 포함하는 JWT 기반 refresh-token adapter 설정 token 및 option입니다.
- Refresh helper: `createRefreshTokenStrategyRegistration`.

### Passport.js bridge
- `createPassportJsStrategyBridge(...)`: Passport.js strategy를 fluo `AuthStrategy`로 변환합니다.
- `PassportJsAuthStrategy`, `PassportJsStrategyLike`, `PassportJsPrincipalMapperInput`, `PassportJsPrincipalMapper`, `PassportJsAuthStrategyOptions`, `PassportJsStrategyBridge`: Bridge strategy, mapper, 설정, provider bundle 계약입니다.

### Account linking
- `ACCOUNT_LINKING_POLICY`: Account-linking policy implementation을 등록하기 위한 DI token입니다.
- `createConservativeAccountLinkPolicy(...)`, `resolveAccountLinking(...)`: Identity-link 결정을 위한 conservative default policy와 resolver입니다.
- `AccountIdentity`, `AccountLinkCandidate`, `AccountLinkAttempt`, `AccountLinkContext`, `AccountLinkPolicy`, `AccountLinkPolicyDecision`, `AccountLinkingOptions`, `AccountLinkingResolution`: Account-linking input, policy, result 계약입니다.
- `AccountLinkConflictError`, `AccountLinkRejectedError`: 모호하거나 거부된 account-linking attempt에서 발생하는 error입니다.

### Status 및 diagnostics
- `createPassportPlatformStatusSnapshot(...)`: Strategy registry, preset readiness, ownership, telemetry label을 위한 runtime platform snapshot을 생성합니다.
- `createPassportPlatformDiagnosticIssues(...)`: Empty registry, 누락된 default strategy, cookie preset readiness, refresh-token backing store readiness 문제에 대한 diagnostic issue를 생성합니다.
- `PassportPlatformStatusSnapshot`, `PassportStatusAdapterInput`: Status helper input/output 계약입니다.

`UseOptionalAuth`는 scope가 필요 없는 route에서만 credential 누락을 우회합니다. Scoped route에는 여전히 principal이 필요합니다. Passport.js bridge의 `redirect()`는 response를 commit하고 protected handler를 건너뛰며, `pass()`와 Passport action 없이 완료된 strategy는 인증 실패입니다.

## 관련 패키지

- `@fluojs/jwt`: JWT 기반 전략을 위한 하위 토큰 코어 패키지입니다.
- `@fluojs/http`: 라우팅 및 가드 인프라를 제공하는 기본 패키지입니다.

## 예제 소스

- `packages/passport/src/guard.test.ts`: 가드 실행 및 권한 강제 패턴 예제.
- `packages/passport/src/adapters/passport-js.ts`: Passport.js 브릿지 구현체.
- `examples/auth-jwt-passport/src/auth/bearer.strategy.ts`: 표준 JWT 전략 구현 예제.
