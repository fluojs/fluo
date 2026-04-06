# @konekti/passport

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti의 strategy-agnostic auth 실행 레이어 — 어떤 `AuthStrategy`든 generic `AuthGuard`를 통해 request context에 연결한다.

이 패키지는 bearer-token JWT 외에 두 가지 공식 preset을 함께 제공한다:
- **Cookie auth preset**: HttpOnly 쿠키 JWT 추출 + `CookieManager` 유틸리티.
- **Refresh token lifecycle**: 재생 감지(replay detection)를 포함한 refresh token 발급·로테이션·취소.

`@konekti/passport`는 이제 공식 계정 연결 확장 계약(`AccountLinkPolicy`)을 제공하며, 최종 identity 정책 결정은 애플리케이션 레벨 책임으로 남는다.

## 관련 문서

- `../../docs/concepts/auth-and-jwt.ko.md`
- `../../docs/concepts/http-runtime.ko.md`

## 이 패키지가 하는 일

`@konekti/passport`는 어떤 구체적인 auth provider(JWT 파싱, Google OAuth, local 인증 정보)도 구현하지 않는다. 역할은 **어떤 strategy를 꽂더라도** Konekti request lifecycle에서 일관되게 auth가 실행되도록 하는 것이다:

1. `UseAuth('<strategy>')`, `RequireScopes(...)` 데코레이터가 auth 메타데이터를 쓰고 route에 `AuthGuard`를 붙인다
2. request 시점에 `AuthGuard`가 requirement를 읽고, strategy를 이름으로 찾고, `strategy.authenticate(context)`를 호출하고, principal을 얻고, scope를 확인하고, `requestContext.principal`을 채운다
3. auth 에러는 `UnauthorizedException` (401) 또는 `ForbiddenException` (403)으로 매핑된다
4. Passport.js strategy는 `createPassportJsStrategyBridge()`로 bridge할 수 있다

`AuthGuard`는 generic HTTP guard 계약을 명시적으로 따른다: pipeline을 계속하려면 성공을 반환하고, auth 실패 시 `UnauthorizedException` / `ForbiddenException`을 throw하며, redirect 같은 committed-response 흐름은 핸들러를 short-circuit할 수 있다.

범위 정리:

- `@konekti/passport`는 strategy 실행, refresh token lifecycle(발급·로테이션·취소), HttpOnly cookie auth preset, 계정 연결 정책 계약을 소유한다
- 로그인 자격 증명 검증, 세션 스토리지, 동의(consent), 계정 upsert 소유권 등 더 넓은 account/session lifecycle은 애플리케이션 레벨 책임이다

## Refresh Token Lifecycle

`@konekti/passport`는 refresh token 작업을 위한 프레임워크 레벨 기본 기능을 제공한다:

- **Issue**: subject에 대한 새 refresh token 생성
- **Rotate**: 재생 감지를 포함하여 refresh token을 새 access + refresh token으로 교환
- **Revoke**: 특정 token 또는 subject의 모든 token 무효화(로그아웃)

기반 `@konekti/jwt` refresh-token 설정이 `rotation: false`이면 refresh 작업은 새 access token만 반환하고 refresh token 문자열은 만료 또는 취소 시점까지 그대로 재사용합니다. 이 섹션의 replay-detection 의미는 rotation 모드(`rotation: true`)에 적용됩니다.

### Refresh token strategy 사용

```typescript
import { Controller, Post } from '@konekti/http';
import { UseAuth, RefreshTokenStrategy } from '@konekti/passport';
import type { RequestContext } from '@konekti/http';

@Controller('/auth')
export class AuthController {
  @Post('/refresh')
  @UseAuth('refresh-token')
  async refresh(_: never, ctx: RequestContext) {
    return ctx.principal;
  }
}
```

### Refresh token 어댑터 등록

```typescript
import { Module } from '@konekti/core';
import {
  createPassportProviders,
  createRefreshTokenProviders,
  JwtRefreshTokenAdapter,
  RefreshTokenStrategy,
} from '@konekti/passport';

@Module({
  providers: [
    JwtRefreshTokenAdapter,
    RefreshTokenStrategy,
    ...createRefreshTokenProviders(JwtRefreshTokenAdapter),
    ...createPassportProviders(
      { defaultStrategy: 'jwt' },
      [{ name: 'refresh-token', token: RefreshTokenStrategy }],
    ),
  ],
})
export class AuthModule {}
```

### 커스텀 refresh token 서비스 구현

```typescript
import type { RefreshTokenService } from '@konekti/passport';

export class MyRefreshTokenService implements RefreshTokenService {
  async issueRefreshToken(subject: string): Promise<string> {
    // 직접 구현
  }

  async rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // 로테이션 및 재생 감지 포함 구현
  }

  async revokeRefreshToken(tokenId: string): Promise<void> {
    // 직접 구현
  }

  async revokeAllForSubject(subject: string): Promise<void> {
    // 로그아웃: subject의 모든 token 취소
  }
}
```

## Cookie Auth Preset

`@konekti/passport`는 JWT 기반 인증을 위한 공식 HttpOnly 쿠키 auth preset을 제공한다. 이 preset은 bearer 헤더 대신 보안 HttpOnly 쿠키에서 JWT 토큰을 추출한다.

### Cookie auth strategy 사용

```typescript
import { Controller, Post, Get } from '@konekti/http';
import { UseAuth, CookieAuthStrategy, CookieManager } from '@konekti/passport';
import type { RequestContext } from '@konekti/http';
import { Inject } from '@konekti/core';
import { DefaultJwtSigner } from '@konekti/jwt';

@Controller('/auth')
export class AuthController {
  @Inject([DefaultJwtSigner, CookieManager])
  constructor(
    private readonly signer: DefaultJwtSigner,
    private readonly cookieManager: CookieManager,
  ) {}

  @Post('/login')
  async login(input: { username: string }, ctx: RequestContext) {
    const accessToken = await this.signer.signAccessToken({
      sub: input.username,
      roles: ['user'],
    });

    this.cookieManager.setAccessTokenCookie(ctx.response, accessToken, 3600);

    return { success: true };
  }

  @Get('/profile')
  @UseAuth('cookie')
  async getProfile(_input: never, ctx: RequestContext) {
    return { user: ctx.principal };
  }

  @Post('/logout')
  async logout(_input: never, ctx: RequestContext) {
    this.cookieManager.clearAllCookies(ctx.response);
    return { success: true };
  }
}
```

### Cookie auth preset 등록

```typescript
import { Module } from '@konekti/core';
import { ConfigService } from '@konekti/config';
import {
  createPassportProviders,
  createCookieAuthPreset,
} from '@konekti/passport';
import { JwtModule } from '@konekti/jwt';

@Module({
  imports: [
    JwtModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        algorithms: ['HS256'],
        secret: config.getOrThrow<string>('JWT_SECRET'),
        issuer: config.getOrThrow<string>('JWT_ISSUER'),
        audience: config.getOrThrow<string>('JWT_AUDIENCE'),
        accessTokenTtlSeconds: config.get<number>('JWT_ACCESS_TTL_SECONDS') ?? 3600,
      }),
    }),
  ],
  providers: [
    ...createCookieAuthPreset({
      cookieAuth: {
        accessTokenCookieName: 'access_token',
        refreshTokenCookieName: 'refresh_token',
        requireAccessToken: true,
      },
      cookieManager: {
        cookieOptions: {
          secure: true,
          sameSite: 'strict',
          path: '/',
        },
      },
    }).providers,
    ...createPassportProviders(
      { defaultStrategy: 'cookie' },
      [createCookieAuthPreset().strategy],
    ),
  ],
})
export class AuthModule {}
```

> Config-first 원칙: Konekti는 환경 값을 애플리케이션 경계에서 해석한 뒤 타입이 지정된 옵션/프로바이더로 auth 모듈에 전달합니다. `../../docs/concepts/config-and-environments.ko.md`를 참고하세요.

### Cookie manager 유틸리티

`CookieManager` 클래스는 auth 쿠키 관리를 위한 유틸리티를 제공한다:

```typescript
import { CookieManager } from '@konekti/passport';
import type { FrameworkResponse } from '@konekti/http';

// access token 쿠키 설정
cookieManager.setAccessTokenCookie(response, accessToken, 3600);

// refresh token 쿠키 설정
cookieManager.setRefreshTokenCookie(response, refreshToken, 604800);

// 두 토큰 동시 설정
cookieManager.setAuthCookies(response, accessToken, 3600, refreshToken, 604800);

// access token 쿠키 삭제
cookieManager.clearAccessTokenCookie(response);

// refresh token 쿠키 삭제
cookieManager.clearRefreshTokenCookie(response);

// 모든 auth 쿠키 삭제 (로그아웃)
cookieManager.clearAllCookies(response);
```

### 보안 기본값

Cookie auth preset은 보안 기본값을 사용한다:

- **HttpOnly**: `true` (JavaScript 접근 차단)
- **Secure**: `true` (프로덕션에서 HTTPS 전용)
- **SameSite**: `strict` (CSRF 방지)
- **Path**: `/` (애플리케이션 전체에서 사용 가능)

이 기본값은 `CookieManagerConfig`로 재정의할 수 있다.

### Preset 소유 범위 vs 애플리케이션 정책

**Preset이 소유하는 것:**
- HttpOnly 쿠키에서 JWT 추출
- 보안 플래그를 포함한 쿠키 헤더 구성
- `@konekti/jwt` verifier와의 통합

**애플리케이션 정책 (preset이 소유하지 않는 것):**
- 로그인 엔드포인트 구현 (자격 증명 검증)
- 사용자 세션 스토리지 (JWT 외에 필요한 경우)
- 라우트별 쿠키 도메인 및 경로 커스터마이징
- 멀티 테넌트 쿠키 격리
- 쿠키 동의 준수

## Account Linking Policy 계약

`@konekti/passport`는 계정 소유권 자체를 프레임워크로 끌어오지 않으면서도, 애플리케이션이 일관되게 계정 연결을 구현할 수 있도록 최소 계약을 제공한다:

- `AccountLinkPolicy.evaluate(context)`로 애플리케이션 정책 결정을 정의
- `resolveAccountLinking(context, policy, options)`로 결과를 정규화하고 conflict/reject 시맨틱을 강제
- `createConservativeAccountLinkPolicy()`는 모호한 후보 연결 시 명시적 확인을 요구하는 공식 baseline 정책

### 프레임워크 동작 vs 애플리케이션 정책 경계

**프레임워크 소유 동작:**
- 계정 연결 계약 타입 및 DI 토큰(`ACCOUNT_LINKING_POLICY`)
- 결정 정규화(`linked`, `create-account`, `skipped`)
- 명시적 타입 에러(`AccountLinkConflictError`, `AccountLinkRejectedError`)

**애플리케이션 소유 동작:**
- 계정 후보 탐색(이메일/provider/메타데이터 기준 조회)
- 동의 UI 및 명시적 링크 확인 UX
- 계정 upsert/merge 트랜잭션 및 감사 로깅

### 공통 플로우 매핑

| 플로우 | 일반적인 입력 컨텍스트 | 기대 정책 결정 |
|---|---|---|
| 첫 외부 로그인 | `candidates: []` | `create-account` |
| 기존 계정 매칭 | `candidates: [account]`, 아직 확인 없음 | `conflict` (명시적 확인 필요) |
| 명시적 링크 확인 | `linkAttempt.confirmedByUser === true` 이고 대상이 후보에 포함 | `link` |
| 링크 거절 | 사용자가 확인 거절 또는 대상 계정이 유효하지 않음 | `reject` |

### 예시: 로컬 자격 증명 플로우 (외부 연결 없음)

```typescript
import { AuthenticationFailedError } from '@konekti/passport';

export async function loginWithPassword(email: string, password: string) {
  const account = await accountRepository.findByEmail(email);
  if (!account || !(await passwordHasher.verify(password, account.passwordHash))) {
    throw new AuthenticationFailedError('Invalid credentials.');
  }

  return account;
}
```

### 예시: 외부 provider 플로우 + 명시적 링크 확인

```typescript
import {
  AccountLinkConflictError,
  AccountLinkRejectedError,
  createConservativeAccountLinkPolicy,
  resolveAccountLinking,
} from '@konekti/passport';

const policy = createConservativeAccountLinkPolicy();

export async function handleGoogleCallback(identity: {
  email?: string;
  providerSubject: string;
}) {
  const candidates = await accountRepository.findCandidatesForExternalIdentity(identity);

  try {
    const resolution = await resolveAccountLinking(
      {
        candidates,
        identity: {
          email: identity.email,
          emailVerified: true,
          provider: 'google',
          providerSubject: identity.providerSubject,
        },
      },
      policy,
    );

    if (resolution.status === 'linked') {
      return accountRepository.attachExternalIdentity(resolution.accountId, 'google', identity.providerSubject);
    }

    if (resolution.status === 'create-account') {
      return accountRepository.createFromExternalIdentity('google', identity.providerSubject, identity.email);
    }

    return { next: 'manual-review' };
  } catch (error) {
    if (error instanceof AccountLinkConflictError) {
      return {
        candidateAccountIds: error.candidateAccountIds,
        next: 'ask-link-confirmation',
      };
    }

    if (error instanceof AccountLinkRejectedError) {
      return { next: 'link-rejected' };
    }

    throw error;
  }
}
```

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

class BearerAuthStrategy {
  async authenticate() {
    return { claims: {}, subject: 'user-1' };
  }
}

@Module({
  providers: [
    BearerAuthStrategy,
    ...createPassportProviders({ defaultStrategy: 'jwt' }, [{ name: 'jwt', token: BearerAuthStrategy }]),
  ],
})
export class AuthModule {}
```

### AuthStrategy 구현

```typescript
import type { AuthStrategy, GuardContext } from '@konekti/passport';
import { AuthenticationRequiredError } from '@konekti/passport';

export class ApiKeyStrategy implements AuthStrategy {
  async authenticate(context: GuardContext) {
    const apiKey = context.requestContext.request.headers['x-api-key'];
    if (!apiKey) {
      throw new AuthenticationRequiredError();
    }

    return {
      claims: { apiKey },
      scopes: ['read:profile'],
      subject: 'api-key-user',
    };
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
| `AuthStrategy` | `src/types.ts` | 인터페이스: `authenticate(context) → principal \| handled result` |
| `AuthStrategyResult` | `src/types.ts` | `Principal` 또는 `{ handled: true, principal? }` |
| `AuthGuard` | `src/guard.ts` | auth requirement를 읽고 strategy를 호출하는 generic guard |
| `UseAuth(strategyName)` | `src/decorators.ts` | strategy 설정 + route에 `AuthGuard` 부착 |
| `RequireScopes(...scopes)` | `src/decorators.ts` | 필요한 scope 선언 + `AuthGuard` 부착 |
| `createPassportProviders(opts)` | `src/module.ts` | strategy registry와 default strategy wiring 등록 |
| `createPassportJsStrategyBridge(...)` | `src/passport-js.ts` | Passport.js strategy를 Konekti `AuthStrategy`로 감쌈 |
| `AuthRequirement` | `src/types.ts` | `{ strategy?, scopes? }` — class + method 레벨에서 merge됨 |
| `AccountLinkPolicy` | `src/account-linking.ts` | 애플리케이션이 제공한 후보 데이터로 identity-linking 결정을 내리는 확장 계약 |
| `resolveAccountLinking(...)` | `src/account-linking.ts` | 정책 결과(`linked`, `create-account`, `skipped`) 정규화 + conflict/reject 타입 에러 처리 |
| `createConservativeAccountLinkPolicy()` | `src/account-linking.ts` | 명시적 확인 전에는 모호한 연결을 허용하지 않는 기본 보수 정책 |
| `ACCOUNT_LINKING_POLICY` | `src/account-linking.ts` | 정책 구현 연결을 위한 DI 토큰 |
| `AccountLinkConflictError` | `src/account-linking.ts` | 하나 이상 후보가 매칭되어 명시적 확인이 필요한 경우 throw |
| `AccountLinkRejectedError` | `src/account-linking.ts` | 정책에 의해 링크가 거절된 경우 throw |
| `RefreshTokenService` | `src/refresh-token.ts` | refresh token lifecycle 작업을 위한 인터페이스 |
| `RefreshTokenStrategy` | `src/refresh-token.ts` | refresh token 인증을 위한 auth strategy |
| `JwtRefreshTokenAdapter` | `src/jwt-refresh-token-adapter.ts` | `@konekti/jwt`의 `RefreshTokenService`를 passport 인터페이스로 연결 |
| `createRefreshTokenProviders(service)` | `src/refresh-token.ts` | DI에 refresh token 서비스 등록 |
| `CookieAuthStrategy` | `src/cookie-auth.ts` | HttpOnly 쿠키에서 JWT를 추출하는 auth strategy |
| `CookieManager` | `src/cookie-manager.ts` | auth 쿠키 설정/삭제 유틸리티 |
| `createCookieAuthPreset(config)` | `src/cookie-auth-module.ts` | cookie auth provider와 strategy 등록 생성 |
| `createPassportPlatformStatusSnapshot(input)` | `src/status.ts` | strategy/preset/의존성 준비도와 정책 경계를 공유 플랫폼 스냅샷 형태로 매핑 |
| `createPassportPlatformDiagnosticIssues(input)` | `src/status.ts` | `AUTH_PASSPORT_*` 진단 코드와 fix hint/의존성 경계를 생성 |

## 플랫폼 상태 스냅샷 시맨틱

`createPassportPlatformStatusSnapshot(...)`은 인증 패키지 준비도를 공유 플랫폼 모델로 보고할 때 사용합니다.

- `details.strategyRegistry`로 등록된 strategy 목록과 default strategy 정합성을 노출합니다.
- `details.presets.cookieAuth`로 cookie preset 활성화/준비도를 노출합니다.
- `details.presets.refreshToken.backingStore`로 refresh-token 백킹 의존성 준비도와 dependency ID를 노출합니다.
- `details.policyBoundary`로 프레임워크 소유 인증 기본 기능과 애플리케이션 소유 로그인/세션 정책을 분리합니다.
- `details.telemetry.labels`는 공통 라벨(`component_id`, `component_kind`, `operation`, `result`)을 따릅니다.

`createPassportPlatformDiagnosticIssues(...)`은 레지스트리/preset/의존성 오구성을 안정적인 `AUTH_PASSPORT_*` 코드로 보고하며, 프레임워크가 애플리케이션 로그인/세션 정책을 소유한다고 암시하지 않습니다.

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

`createPassportJsStrategyBridge()`는 Passport.js의 `success`/`fail`/`redirect`/`error` callback 프로토콜을 Konekti의 `AuthStrategyResult`로 변환한다. `mapPrincipal` 인수는 passport user 객체를 Konekti `Principal` shape으로 정규화한다. bridge는 계정 upsert나 JWT 발급을 소유하지 않는다 — 그것들은 app service 코드의 책임이다. identity linking은 `AccountLinkPolicy` + `resolveAccountLinking` 계약 경계를 사용한다.

public package는 auth error 클래스, bridge 타입, metadata helper, strategy/decorator 계약을 `src/index.ts`에서 export한다. registry/options 토큰은 `createPassportProviders`와 `AuthGuard` 내부 wiring 상세로 유지된다.

### 0.x 마이그레이션 노트

`0.x`에서 `AUTH_STRATEGY_REGISTRY`, `PASSPORT_OPTIONS`는 `@konekti/passport`의 public package surface에서 제거되었고 내부 wiring 상세로 전환되었다. 애플리케이션이 이 토큰들을 직접 import하고 있었다면, 지원되는 public contract인 `createPassportProviders(...)`, `UseAuth(...)`, `RequireScopes(...)`, `AuthStrategy` 기반 등록으로 마이그레이션해야 한다.

## 파일 읽기 순서 (기여자용)

1. `src/types.ts` — `AuthStrategy`, `AuthStrategyResult`, `AuthRequirement`, `GuardContext`
2. `src/account-linking.ts` — 계정 연결 계약, conservative baseline 정책, conflict/reject 시맨틱
3. `src/metadata.ts` — class + method requirement 저장과 merge
4. `src/decorators.ts` — `UseAuth`, `RequireScopes` — 메타데이터 쓰기 + `AuthGuard` 부착
5. `src/errors.ts` — auth-specific 에러 타입
6. `src/guard.ts` — `AuthGuard` — strategy lookup, authenticate, scope 확인, principal 채우기
7. `src/refresh-token.ts` — `RefreshTokenService`, `RefreshTokenStrategy` — refresh token lifecycle 기본 기능
8. `src/jwt-refresh-token-adapter.ts` — `JwtRefreshTokenAdapter` — `@konekti/jwt`를 passport 인터페이스로 연결
9. `src/cookie-auth.ts` — `CookieAuthStrategy` — HttpOnly 쿠키에서 JWT 추출
10. `src/cookie-manager.ts` — `CookieManager` — 쿠키 설정/삭제 유틸리티
11. `src/cookie-auth-module.ts` — `createCookieAuthPreset` — cookie auth provider와 strategy 등록
12. `src/module.ts` — `createPassportProviders`
13. `src/passport-js.ts` — `createPassportJsStrategyBridge`
14. `src/account-linking.test.ts` — happy-path linking, conflict 처리, non-linking fallback, 명시적 거절 플로우 테스트
15. `src/guard.test.ts` — non-JWT strategy 흐름, 401/403 매핑, principal 채우기, scope 강제, Passport.js bridge 경로
16. `src/refresh-token.test.ts` — refresh token lifecycle, 로테이션, 재생 감지, 취소
17. `src/cookie-auth.test.ts` — cookie auth strategy 및 cookie manager 테스트
18. `src/status.ts` — strategy/preset/의존성 준비도와 정책 경계를 공유 플랫폼 상태/진단 형태로 매핑
19. `src/status.test.ts` — 플랫폼 상태 스냅샷/진단 회귀 테스트

## 관련 패키지

- `@konekti/jwt` — token-core 서명/검증 구현
- `@konekti/http` — `AuthGuard`는 `@konekti/http` dispatcher의 guard chain에서 동작

## 한 줄 mental model

```text
@konekti/passport = strategy-agnostic auth 실행: 어떤 AuthStrategy든 → AuthGuard → RequestContext의 principal
                 + refresh token lifecycle: 발급 → 로테이션 → 취소 (재생 감지 포함)  (프레임워크 소유)
                 + cookie auth preset: HttpOnly 쿠키 JWT 추출 + 쿠키 관리 유틸리티   (프레임워크 소유)
                 + 계정 연결 정책 계약: evaluate → resolve → conflict/reject 시맨틱   (프레임워크 경계 소유)
                 + 로그인 흐름, 세션 스토어, 동의, 계정 upsert/merge 구현            (애플리케이션 소유)
```
