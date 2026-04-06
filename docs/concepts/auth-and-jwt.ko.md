# auth and jwt

<p><a href="./auth-and-jwt.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 인증과 JWT 지원이 Konekti 패키지에 어떻게 분산되어 있는지 설명합니다.

## 패키지 경계

- **`@konekti/jwt`**: 핵심 JWT 규약, 서명, 검증, 클레임(claim) 유효성 검사, principal 정규화.
- **`@konekti/passport`**: 전략 등록, 범용 인증 가드 연결, 전략 어댑터 규약.
- **`@konekti/http`**: 가드 오케스트레이션, `RequestContext` 관리, 런타임 실행.
- **`@konekti/config`**: 키 자료(key material), 발행자(issuer), 대상(audience) 관리.

## 책임 분담

- **토큰 추출**: 전략별 어댑터 로직.
- **서명 및 클레임 검증**: `JwtVerifier`가 처리합니다.
- **principal 정규화**: `JwtVerifier`가 처리합니다.
- **라우트 레벨 인증 요구사항**: passport 메타데이터 및 인증 가드를 통해 관리합니다.
- **컨텍스트 첨부**: 검증된 principal을 `RequestContext`에 첨부합니다.
- **에러 매핑**: passport 및 HTTP 예외 레이어에서 처리합니다.

## 요청 흐름

일반적인 인증된 요청은 다음 경로를 따릅니다:

1.  **HTTP 요청** 도착.
2.  **인증 가드**가 필요한 전략을 식별.
3.  **인증 전략**이 자격 증명(예: JWT)을 검증.
4.  **Principal** 추출 및 정규화.
5.  **`RequestContext.principal`** 데이터 채우기.
6.  **Controller/Service**가 인증된 principal과 함께 실행.

## 핵심 원칙

- JWT는 하나의 특정 전략일 뿐, 전체 인증 모델이 아닙니다.
- `@konekti/passport`는 전략에 구애받지 않습니다(strategy-agnostic).
- `@konekti/jwt`는 트랜스포트에 구애받지 않습니다(transport-agnostic).
- 애플리케이션 코드는 원시 페이로드 대신 정규화된 principal과 상호작용해야 합니다.

## JWT 지원 범위

### 알고리즘

- **HMAC**: `HS256`, `HS384`, `HS512`.
- **비대칭**: `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`.

### 키 관리

비대칭 알고리즘의 경우, `JwtVerifierOptions`에 `privateKey`와 `publicKey`(PEM 문자열 또는 `KeyObject`)를 제공하세요. `kid`(Key ID) 헤더를 사용하는 `keys` 배열을 통해 키 로테이션이 지원됩니다.

## 표준 인증 패턴

권장 인증 패턴은 두 가지입니다:

1. **Bearer 토큰 인증** — `Authorization: Bearer <token>` 헤더를 통한 인증
2. **Cookie 인증** — HttpOnly 보안 쿠키를 통한 인증 (공식 preset)

### 공식 Cookie auth preset

`@konekti/passport`는 JWT 기반 인증을 위한 공식 HttpOnly 쿠키 auth preset을 제공합니다:

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

> Config-first 원칙: env 기반 비밀값은 애플리케이션 경계에서 해석하고, auth 모듈에는 타입이 지정된 옵션/프로바이더만 전달하세요. `./config-and-environments.ko.md`를 참고하세요.

Preset에 포함된 것:
- `CookieAuthStrategy`: HttpOnly 쿠키에서 JWT 추출
- `CookieManager`: auth 쿠키 설정/삭제 유틸리티
- 보안 기본값: `HttpOnly: true`, `Secure: true`, `SameSite: strict`

전체 cookie auth lifecycle 세부 정보는 `@konekti/passport` 문서를 참조하세요.

### 애플리케이션 레벨 정책

다음 영역은 애플리케이션 특정 사항으로 남아 있습니다:

- 로그인 엔드포인트 구현 (자격 증명 검증)
- 사용자 세션 스토리지 (JWT 외에 필요한 경우)
- 라우트별 쿠키 도메인 및 경로 커스터마이징
- 멀티 테넌트 쿠키 격리
- 쿠키 동의 준수

### 프레임워크 레벨 Refresh Token Lifecycle

`@konekti/passport`는 `RefreshTokenService`를 통해 refresh token 작업을 위한 프레임워크 레벨 기본 기능을 제공합니다:

- **Issue**: subject에 대한 새 refresh token 생성.
- **Rotate**: 재생 감지를 포함하여 refresh token을 새 access + refresh token으로 교환.
- **Revoke**: 특정 token 또는 subject의 모든 token 무효화(로그아웃).

`RefreshTokenStrategy`는 request body(`refreshToken`), `Authorization: Bearer` 헤더, 또는 커스텀 `x-refresh-token` 헤더에서 refresh token을 추출합니다. 프레임워크가 헤더 형태(문자열 또는 문자열 배열) 정규화를 내부적으로 처리합니다.

## 추가 정보

- **`@konekti/jwt`**: `../../packages/jwt/README.md`
- **`@konekti/passport`**: `../../packages/passport/README.md`
- **`@konekti/http`**: `../../packages/http/README.md`
