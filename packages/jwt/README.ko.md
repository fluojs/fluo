# @konekti/jwt

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


HTTP에 의존하지 않는 JWT 토큰 코어입니다. 액세스 토큰을 서명하고 이를 정규화된 `JwtPrincipal`로 검증합니다.

현재 공식 문서와 예제에서는 이 패키지를 베어러 토큰(bearer-token) 인증을 통해 사용합니다. 더 광범위한 세션/쿠키 정책은 현재 프레임워크의 기본 제공 범위를 벗어납니다.

## 관련 문서

- `../../docs/concepts/auth-and-jwt.ko.md`
- `../../docs/concepts/architecture-overview.ko.md`

## 이 패키지가 하는 일

`@konekti/jwt`는 라우트나 가드에 대해 알지 못합니다. 다음 작업을 수행합니다.

- HS256, HS384, HS512와 같은 HMAC 알고리즘으로 액세스 토큰을 서명합니다 (`DefaultJwtSigner.signAccessToken`).
- RS256, RS384, RS512, ES256, ES384, ES512와 같은 비대칭 알고리즘으로 액세스 토큰을 서명합니다.
- 토큰을 검증합니다: 형태(shape) → 알고리즘 → 서명 → 클레임(claims: `exp`, `nbf`, `iss`, `aud`).
- 검증된 클레임을 `JwtPrincipal`로 정규화합니다 (`subject`, `roles`, `scopes`, `claims`).

현재 스코프 참고 사항:

- 제공되는 알고리즘: `HS256`, `HS384`, `HS512`, `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`.
- 리프레시 토큰 발행·로테이션·폐기/로그아웃 흐름은 `@konekti/passport`의 `RefreshTokenService` 인터페이스를 통해 제공합니다.

## 설치

```bash
npm install @konekti/jwt
```

## 빠른 시작

### DI에 등록

```typescript
import { Module } from '@konekti/core';
import { ConfigService } from '@konekti/config';
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
})
export class AuthModule {}
```

> Config-first 원칙: Konekti는 환경 값을 애플리케이션 경계에서 해석한 뒤 타입이 지정된 옵션/프로바이더로 패키지 모듈에 전달합니다. `../../docs/concepts/config-and-environments.ko.md`를 참고하세요.

## Refresh token 통합

refresh token lifecycle(발행, 로테이션, replay detection이 포함된 폐기)에는 `@konekti/passport`를 사용하세요:

```typescript
import { Module } from '@konekti/core';
import { ConfigService } from '@konekti/config';
import { JwtModule } from '@konekti/jwt';
import {
  createPassportProviders,
  createRefreshTokenProviders,
  JwtRefreshTokenAdapter,
  RefreshTokenStrategy,
} from '@konekti/passport';

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
        refreshToken: {
          secret: config.getOrThrow<string>('REFRESH_TOKEN_SECRET'),
          expiresInSeconds: config.get<number>('REFRESH_TOKEN_TTL_SECONDS') ?? 604800,
          rotation: true,
        },
      }),
    }),
  ],
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

전체 refresh token lifecycle 세부 정보는 `@konekti/passport` 문서를 참고하세요.

### 런타임 모듈 엔트리포인트

`JwtModule`의 공식 런타임 모듈 엔트리포인트는 다음 두 가지입니다.

- `JwtModule.forRoot(options)`
- `JwtModule.forRootAsync({ inject?, useFactory })`

`JwtModule.register(...)`는 지원되는 런타임 엔트리포인트 계약에 포함되지 않습니다.

### 토큰 서명

```typescript
import { Inject } from '@konekti/core';
import { DefaultJwtSigner } from '@konekti/jwt';

@Inject([DefaultJwtSigner])
export class AuthService {
  constructor(private signer: DefaultJwtSigner) {}

  async issueToken(userId: string, roles: string[]) {
    return this.signer.signAccessToken({
      sub: userId,
      roles,
      scopes: ['read:profile'],
    });
    // → 'eyJhbGci...'
  }
}
```

### 토큰 검증

```typescript
import { DefaultJwtVerifier } from '@konekti/jwt';

const verifier = await container.resolve(DefaultJwtVerifier);
const principal = await verifier.verifyAccessToken(token);
// principal: { subject: 'user-123', roles: ['admin'], scopes: ['read:profile'], claims: {...} }
```

### 독립형 사용 (DI 없음)

```typescript
import { DefaultJwtSigner, DefaultJwtVerifier } from '@konekti/jwt';

const opts = { algorithms: ['HS256'], secret: 'super-secret', issuer: 'test', audience: 'test', accessTokenTtlSeconds: 60 };
const signer = new DefaultJwtSigner(opts);
const verifier = new DefaultJwtVerifier(opts);

const token = await signer.signAccessToken({ sub: 'u1', roles: [] });
const principal = await verifier.verifyAccessToken(token);
```

### 비대칭 알고리즘 (RS256 / ES256)

RS* 또는 ES* 알고리즘을 사용할 때는 `privateKey`와 `publicKey` (PEM 문자열 또는 Node.js `KeyObject`)를 전달하세요.

```typescript
import { generateKeyPairSync } from 'node:crypto';
import { DefaultJwtSigner, DefaultJwtVerifier } from '@konekti/jwt';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const signer = new DefaultJwtSigner({
  algorithms: ['RS256'],
  issuer: 'my-app',
  audience: 'my-app-clients',
  accessTokenTtlSeconds: 3600,
  privateKey,
});
const verifier = new DefaultJwtVerifier({
  algorithms: ['RS256'],
  issuer: 'my-app',
  audience: 'my-app-clients',
  publicKey,
});

const token = await signer.signAccessToken({ sub: 'u1' });
const principal = await verifier.verifyAccessToken(token);
```

키 로테이션을 위해서는 `kid`와 함께 `keys` 배열을 사용하세요.

```typescript
const signer = new DefaultJwtSigner({
  algorithms: ['RS256'],
  keys: [{ kid: 'v2', privateKey, publicKey }],
});
const verifier = new DefaultJwtVerifier({
  algorithms: ['RS256'],
  keys: [{ kid: 'v2', publicKey }],
});
```

## 주요 API

| 익스포트(Export) | 위치 | 설명 |
|---|---|---|
| `DefaultJwtVerifier` | `src/verifier.ts` | `verifyAccessToken(token) → Promise<JwtPrincipal>` |
| `DefaultJwtSigner` | `src/signer.ts` | `signAccessToken(claims) → Promise<string>` |
| `createJwtCoreProviders(options)` | `src/module.ts` | 옵션, 검증기, 서명기를 한 번에 등록 |
| `JwtPrincipal` | `src/types.ts` | `{ subject, issuer?, audience?, roles?, scopes?, claims }` |
| `JwtClaims` | `src/types.ts` | 로우(Raw) 클레임 형태 |
| `JwtVerifierOptions` | `src/types.ts` | `{ secret?, privateKey?, publicKey?, issuer?, audience?, algorithms?, accessTokenTtlSeconds?, keys? }` |
| `JwtVerifier` | `src/types.ts` | 커스텀 검증기 구현을 위한 인터페이스 |
| `JwtSigner` | `src/types.ts` | 커스텀 서명기 구현을 위한 인터페이스 |
| `createJwtPlatformStatusSnapshot(input)` | `src/status.ts` | JWT 소유권/준비도/헬스 및 정책 경계를 공유 플랫폼 스냅샷 형태로 매핑 |
| `createJwtPlatformDiagnosticIssues(input)` | `src/status.ts` | refresh-token 백킹 의존성 준비도 문제를 `AUTH_JWT_*` 진단 코드로 노출 |

## 플랫폼 상태 스냅샷 시맨틱

`createJwtPlatformStatusSnapshot(...)`을 사용하면 토큰 동작 자체를 바꾸지 않고 JWT의 플랫폼 정렬 신호를 노출할 수 있습니다.

- `ownership`에서 JWT 기본 기능은 프레임워크 제공, 키/세션 정책은 외부(애플리케이션) 관리임을 명시합니다.
- `details.policyBoundary`가 프레임워크 소유 기능과 애플리케이션 소유 정책을 분리합니다.
- refresh 모드가 켜져 있으면 `details.refreshToken.backingStore`로 백킹 의존성 준비도를 노출할 수 있습니다.
- `details.telemetry.labels`는 공통 라벨(`component_id`, `component_kind`, `operation`, `result`)을 따릅니다.

`createJwtPlatformDiagnosticIssues(...)`는 `fixHint`, `dependsOn`(선택)을 포함한 안정적인 `AUTH_JWT_*` 진단 항목을 생성합니다.

## 아키텍처

### 검증기 파이프라인

```text
verifyAccessToken(token)
  1. 헤더 + 페이로드 + 서명을 분리하고 base64url로 디코딩
  2. 알고리즘이 허용 목록에 있는지 확인
  3. 서명 검증 — HS*의 경우 HMAC(createHmac), RS*/ES*의 경우 비대칭(createVerify) 사용
  4. 클레임 검증: exp, nbf, iss, aud
  5. normalizePrincipal(payload) → JwtPrincipal
```

### 주체(Principal) 정규화

`normalizePrincipal()`은 상위 레이어에 안정적인 형태를 제공합니다.
- `sub` 필수 — 누락 시 예외 발생
- `roles`를 배열로 정규화 (undefined → `[]`)
- 공백으로 구분된 `scope` 문자열과 `scopes` 배열을 하나의 `scopes: string[]`으로 통합
- 원래의 로우 클레임을 `claims`에 보존

이로 인해 호출자(예: 패스포트 전략)는 클레임 형태의 변종에 따라 분기 처리를 할 필요가 없습니다.

### 서명기 기본값

`signAccessToken`에 전달된 클레임에 `iss`, `aud`, `iat` 또는 `exp`가 없는 경우, 서명기는 옵션에서 해당 값을 채웁니다. 이를 통해 프레임워크 레벨의 액세스 토큰이 항상 필수 메타데이터를 갖도록 보장합니다.

### 알고리즘 설계

"이 알고리즘이 허용 목록에 있는가?"와 "이 구현이 이를 지원하는가?"라는 두 가지 별도의 확인 과정이 존재합니다. HMAC 알고리즘(HS*)은 공유 비밀키와 함께 `createHmac`을 사용하고, 비대칭 알고리즘(RS*, ES*)은 키 쌍과 함께 `createVerify`/`createSign`을 사용합니다. 이러한 분리는 지원되지 않는 경로가 실수로 열리는 일 없이 안전하게 허용 목록을 확장할 수 있게 해줍니다.

refresh token 검증은 HMAC 전용 경로입니다. `refreshToken`이 구성된 경우 verifier는 허용 알고리즘 목록에 `HS256` / `HS384` / `HS512` 중 최소 하나가 있어야 하며, 그렇지 않으면 생성 시점에 즉시 실패합니다.

## 기여자를 위한 파일 읽기 순서

1. `src/types.ts` — `JwtVerifierOptions`, `JwtClaims`, `JwtPrincipal`, `JwtVerifier`, `JwtSigner`
2. `src/errors.ts` — 타입이 지정된 JWT 오류 (만료, 유효하지 않은 서명, 클레임 누락 등)
3. `src/verifier.ts` — `DefaultJwtVerifier`, `normalizePrincipal`
4. `src/signer.ts` — `DefaultJwtSigner`, 기본값 채우기
5. `src/module.ts` — `createJwtCoreProviders`
6. `src/status.ts` — 정책 경계 및 refresh-token 백킹 준비도를 공유 플랫폼 상태/진단 형태로 매핑
7. `src/verifier.test.ts` — 성공 경로, 만료된 토큰, 유효하지 않은 서명
8. `src/signer.test.ts` — 서명/검증 왕복 테스트
9. `src/status.test.ts` — 상태 스냅샷 및 진단 항목 테스트

## 관련 패키지

- `@konekti/passport` — 이 토큰 코어를 호출하는 인증 전략/가드 레이어
- `@konekti/http` — 인증 실패가 HTTP 응답으로 변환되는 방식

## 한 줄 멘탈 모델

```text
@konekti/jwt = HTTP에 의존하지 않는 토큰 코어: 서명 → 검증 → JwtPrincipal로 정규화
```
