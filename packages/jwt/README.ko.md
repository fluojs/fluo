# @fluojs/jwt

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

HTTP에 독립적인 JWT 토큰 코어로, 액세스 토큰의 서명 및 검증을 담당하며 검증된 결과를 정규화된 `JwtPrincipal` 객체로 변환합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
- [설정 가드레일](#설정-가드레일)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/jwt
```

## 사용 시점

- 백엔드 애플리케이션에서 JWT 액세스 토큰을 발행하거나 검증해야 할 때.
- 토큰의 클레임 형식과 관계없이 `JwtPrincipal` (주체, 역할, 스코프) 형태의 일관된 사용자 정보를 얻고 싶을 때.
- 재사용 감지 기능이 포함된 리프레시 토큰 로테이션을 구현할 때.

## 빠른 시작

### 모듈 등록

서명 키와 정책을 사용하여 JWT 모듈을 설정합니다.

JWT 지원은 `JwtModule.forRoot(...)` 또는 `JwtModule.forRootAsync(...)`를 통해 등록합니다.

```typescript
import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';

@Module({
  imports: [
    JwtModule.forRoot({
      algorithms: ['HS256'],
      secret: 'your-secure-secret',
      issuer: 'my-api',
      audience: 'my-app',
      accessTokenTtlSeconds: 3600,
    }),
  ],
})
export class AuthModule {}
```

### 주입된 설정을 사용하는 비동기 등록

JWT 설정이 다른 provider에서 와야 한다면, `JwtModule.forRootAsync(...)`를 사용해도 표준 module contract 안에서 안전하게 등록할 수 있습니다.

비동기 등록도 동기 경로와 동일한 JWT provider surface를 export하며, 여기에는 `RefreshTokenService`가 포함됩니다. 단, 이 서비스를 실제로 resolve하려면 `refreshToken` 옵션이 구성되어 있어야 합니다.

```typescript
import { Module, type Token } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';

const JWT_SETTINGS = Symbol('jwt-settings');

@Module({
  imports: [
    JwtModule.forRootAsync({
      inject: [JWT_SETTINGS],
      useFactory: async (settings) => ({
        accessTokenTtlSeconds: 900,
        algorithms: ['HS256'],
        audience: 'my-app',
        issuer: settings.issuer,
        secret: settings.secret,
      }),
    }),
  ],
  providers: [
    {
      provide: JWT_SETTINGS as Token<{ issuer: string; secret: string }>,
      useValue: {
        issuer: 'my-api',
        secret: 'your-secure-secret',
      },
    },
  ],
})
export class AuthModule {}
```

### 토큰 서명 및 검증

`DefaultJwtSigner`를 주입받아 토큰을 발행하고, `DefaultJwtVerifier`를 통해 검증합니다.

```typescript
import { DefaultJwtSigner, DefaultJwtVerifier } from '@fluojs/jwt';

// 서명 (Sign)
const token = await signer.signAccessToken({
  sub: 'user-123',
  roles: ['admin'],
  scopes: ['read:profile'],
});

// 검증 (Verify)
const principal = await verifier.verifyAccessToken(token);
// principal: { subject: 'user-123', roles: ['admin'], scopes: ['read:profile'], ... }
```

`JwtService.sign(payload, { expiresIn })`를 사용할 때는 payload 안에 기존 `exp` 값이 있더라도 호출 시점의 `expiresIn` 재정의가 항상 우선합니다. 따라서 토큰 수명은 호출 위치에서 결정적으로 제어됩니다.

## 일반적인 패턴

### 비대칭 서명 (RS256/ES256)

분산 시스템에서 보안을 강화하기 위해 공개키/개인키 쌍을 사용합니다.

```typescript
const signer = new DefaultJwtSigner({
  algorithms: ['RS256'],
  privateKey: '...PEM...',
});

const verifier = new DefaultJwtVerifier({
  algorithms: ['RS256'],
  publicKey: '...PEM...',
});
```

### 주체 정규화 (Principal Normalization)

`@fluojs/jwt`는 `scope` (문자열)와 `scopes` (배열) 클레임을 자동으로 감지하여 `JwtPrincipal`의 단일 `scopes: string[]` 속성으로 통합합니다. 이를 통해 권한 가드에서 일관된 로직을 적용할 수 있습니다.

### 원격 JWKS 검증

검증 키를 원격 JWKS 엔드포인트에서 가져올 때는, 느리거나 멈춘 identity provider 때문에 인증 경로가 무한정 대기하지 않도록 fetch budget을 명시적으로 제한하세요.

```typescript
const verifier = new DefaultJwtVerifier({
  algorithms: ['RS256'],
  jwksRequestTimeoutMs: 5_000,
  jwksUri: 'https://issuer.example.com/.well-known/jwks.json',
});
```

`jwksRequestTimeoutMs`의 기본값은 `5_000`이며, 예산을 넘기면 진행 중인 JWKS fetch를 abort합니다.

`JwtService.verify(token, options)`는 호출 단위의 알고리즘/클레임 정책 재정의(`issuer`, `audience`, `clockSkewSeconds`, `maxAge`, `requireExp`)를 적용하더라도, 내부 JWKS client나 정적 key-resolution cache를 다시 만들지 않습니다. 호출 단위 검증은 `jwksUri`, `keys[]`, `publicKey`, `secret`, `secretOrKeyProvider` 같은 구성된 key source 자체를 교체하지는 않습니다.

## 설정 가드레일

JWT 서명과 검증에는 `algorithms`에 지원되는 알고리즘이 하나 이상 필요합니다. 기본 signer는 `HS256`, `HS384`, `HS512`, `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`를 지원하며, 빈 알고리즘 목록은 모호한 토큰을 발행하거나 수락하지 않도록 즉시 실패합니다.

액세스 토큰 TTL도 양의 유한 숫자여야 합니다. `accessTokenTtlSeconds`를 생략하면 `DefaultJwtSigner`는 문서화된 기본값인 `3600`초를 사용합니다. 소수 초는 JWT NumericDate `exp` 클레임에 그대로 보존됩니다. `0`, 음수 또는 유한하지 않은 값이 제공되면 토큰을 발행하기 전에 `JwtConfigurationError`로 실패합니다.

## 공개 API 개요

### 주요 클래스
- `JwtModule`: DI 등록을 위한 기본 진입점입니다.
- `DefaultJwtSigner`: 클레임 자동 채우기 기능이 포함된 토큰 발행 클래스입니다.
- `DefaultJwtVerifier`: 토큰 검증 및 정규화를 담당하는 클래스입니다.
- `JwtService`: 서명과 검증 기능을 결합한 편의용 파사드(facade)입니다.

### 타입
- `JwtPrincipal`: 정규화된 사용자 식별 객체 (`subject`, `roles`, `scopes`, `claims`).
- `JwtVerifierOptions`: 알고리즘, 키, 검증 정책 설정을 위한 타입입니다.

## 관련 패키지

- `@fluojs/passport`: 이 코어 패키지를 사용하여 가드와 전략을 실행하는 인증 계층입니다.
- `@fluojs/config`: 환경별로 비밀 키와 JWT 옵션을 관리할 때 권장되는 패키지입니다.

## 예제 소스

- `packages/jwt/src/module.test.ts`: 모듈 등록 및 DI 패턴 예제.
- `packages/jwt/src/signing/signer.test.ts`: 토큰 서명 예제.
- `examples/auth-jwt-passport/src/auth/auth.service.ts`: 실제 토큰 발행 구현 예제.
