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

### 1. 프로바이더 등록

사용할 전략을 정의하고 `createPassportProviders`를 통해 등록합니다.

```typescript
import { Module } from '@fluojs/core';
import { createPassportProviders } from '@fluojs/passport';
import { MyJwtStrategy } from './jwt.strategy';

@Module({
  providers: [
    MyJwtStrategy,
    ...createPassportProviders(
      { defaultStrategy: 'jwt' },
      [{ name: 'jwt', token: MyJwtStrategy }]
    ),
  ],
})
export class AuthModule {}
```

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

### 리프레시 토큰 수명 주기

패키지에서 제공하는 `RefreshTokenStrategy`와 `RefreshTokenService`를 사용하여 안전한 토큰 로테이션 및 폐기 기능을 구현할 수 있습니다.

```typescript
import { Controller, Post, type RequestContext } from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';

@Controller('/auth')
export class AuthController {
  @Post('/refresh')
  @UseAuth('refresh-token')
  async refresh(input: never, ctx: RequestContext) {
    return ctx.principal; // 새 토큰 쌍이 포함된 principal 반환
  }
}
```

## 공개 API 개요

### 데코레이터
- `@UseAuth(strategyName)`: `AuthGuard`를 부착하고 사용할 전략을 설정합니다.
- `@RequireScopes(...scopes)`: 특정 권한(스코프) 요구 사항을 강제합니다.

### 주요 클래스
- `AuthGuard`: 전략 체인을 실행하는 HTTP 가드입니다.
- `CookieManager`: HttpOnly 인증 쿠키 관리를 위한 유틸리티입니다.
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
