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
import { Module } from '@fluojs/core';
import { PassportModule } from '@fluojs/passport';
import { MyJwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule.forRoot(
      { defaultStrategy: 'jwt' },
      [{ name: 'jwt', token: MyJwtStrategy }]
    ),
  ],
  providers: [MyJwtStrategy],
})
export class AuthModule {}
```

전략 등록은 `PassportModule.forRoot(...)`로 구성합니다.

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

브릿지는 각 Passport.js 전략 실행을 정확히 한 번만 정착(settle)시킵니다. 전략은 바인딩된 Passport 액션(`success`, `fail`, `redirect`, `pass`, `error`) 중 하나를 호출해야 하며, promise rejection 또는 액션 없이 완료된 promise는 요청을 미해결 상태로 두지 않고 인증 실패로 처리됩니다. 커스텀 `mapPrincipal` 함수는 비어 있지 않은 `subject`와 객체 형태의 `claims`를 포함한 유효한 fluo `Principal`을 반환해야 합니다.

### 쿠키 인증 프리셋

HTTP 쿠키에서 인증 정보를 읽는 애플리케이션이라면 `CookieAuthModule.forRoot(...)`를 사용합니다.

```typescript
import { Module } from '@fluojs/core';
import {
  CookieAuthModule,
  CookieAuthStrategy,
  COOKIE_AUTH_STRATEGY_NAME,
  PassportModule,
} from '@fluojs/passport';

@Module({
  imports: [
    CookieAuthModule.forRoot(),
    PassportModule.forRoot(
      { defaultStrategy: COOKIE_AUTH_STRATEGY_NAME },
      [{ name: COOKIE_AUTH_STRATEGY_NAME, token: CookieAuthStrategy }],
    ),
  ],
})
export class AuthModule {}
```

애플리케이션 모듈에서 cookie-auth 지원이 필요하면 `CookieAuthModule.forRoot(...)`를 `PassportModule.forRoot(...)`와 함께 import 하세요.

`CookieAuthStrategy`는 `@fluojs/jwt`가 정규화한 JWT principal 계약을 보존하며, `subject`, `claims`, `issuer`, `audience`, `roles`, `scopes`를 그대로 전달합니다.

### 리프레시 토큰 수명 주기

패키지에서 제공하는 `RefreshTokenStrategy`와 `RefreshTokenService`를 사용하여 안전한 토큰 로테이션 및 폐기 기능을 구현할 수 있습니다.

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

## 공개 API 개요

### 데코레이터
- `@UseAuth(strategyName)`: `AuthGuard`를 부착하고 사용할 전략을 설정합니다.
- `@RequireScopes(...scopes)`: 특정 권한(스코프) 요구 사항을 강제합니다.

### 주요 클래스
- `PassportModule`: passport 전략 wiring을 위한 모듈 진입점입니다.
- `AuthGuard`: 전략 체인을 실행하는 HTTP 가드입니다.
- `CookieAuthModule`: 내장 cookie-auth 프리셋의 모듈 진입점입니다.
- `CookieManager`: HttpOnly 인증 쿠키 관리를 위한 유틸리티입니다.
- `RefreshTokenModule`: 내장 refresh-token 프리셋의 모듈 진입점입니다.
- `JwtRefreshTokenAdapter`: `@fluojs/jwt`의 리프레시 로직을 패스포트 인터페이스로 연결합니다.

### 인터페이스
- `AuthStrategy`: 커스텀 인증 로직 구현을 위한 계약입니다.
- `AccountLinkPolicy`: 계정 연결 결정 로직을 위한 확장 지점입니다.

## 관련 패키지

- `@fluojs/jwt`: JWT 기반 전략을 위한 하위 토큰 코어 패키지입니다.
- `@fluojs/http`: 라우팅 및 가드 인프라를 제공하는 기본 패키지입니다.

## 예제 소스

- `packages/passport/src/guard.test.ts`: 가드 실행 및 권한 강제 패턴 예제.
- `packages/passport/src/adapters/passport-js.ts`: Passport.js 브릿지 구현체.
- `examples/auth-jwt-passport/src/auth/bearer.strategy.ts`: 표준 JWT 전략 구현 예제.
