# @konekti/jwt

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


HTTP를 모르는 JWT token core — access token을 서명하고 검증하여 정규화된 `JwtPrincipal`을 반환한다.

현재 공식 docs/examples 경로는 이 패키지를 bearer-token auth를 통해 사용합니다. 더 넓은 session/cookie 정책은 현재 framework default story 밖에 있습니다.

## 관련 문서

- `../../docs/concepts/auth-and-jwt.md`
- `../../docs/concepts/architecture-overview.md`

## 이 패키지가 하는 일

`@konekti/jwt`는 HTTP request, route, auth guard를 전혀 알지 못한다. 다음을 소유한다:

- HS256/HS384/HS512 같은 HMAC 알고리즘으로 access token 서명 (`DefaultJwtSigner.signAccessToken`)
- 토큰 검증: shape → algorithm → signature → claims (`exp`, `nbf`, `iss`, `aud`)
- 검증된 claims를 `JwtPrincipal`로 정규화 (통합된 `subject`, `roles`, `scopes` 배열)
- `JwtStrategy` export — `@konekti/passport`용 bearer-token strategy adapter

`JwtStrategy`가 generic passport contract를 위해 bearer token 추출을 처리하고, token core는 HTTP에 묶이지 않은 상태로 재사용 가능하게 유지됩니다.

## 설치

```bash
npm install @konekti/jwt
```

## 빠른 시작

### DI에 등록

```typescript
import { Module } from '@konekti/core';
import { createJwtCoreProviders, DefaultJwtSigner, DefaultJwtVerifier } from '@konekti/jwt';

@Module({
  providers: [
    ...createJwtCoreProviders({
      algorithms: ['HS256'],
      secret: process.env.JWT_SECRET!,
      issuer: 'my-app',
      audience: 'my-app-clients',
      accessTokenTtlSeconds: 3600,
    }),
  ],
  exports: [DefaultJwtVerifier, DefaultJwtSigner],
})
export class JwtModule {}
```

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

### 독립형 사용 (DI 없이)

```typescript
import { DefaultJwtSigner, DefaultJwtVerifier } from '@konekti/jwt';

const opts = { algorithms: ['HS256'], secret: 'super-secret', issuer: 'test', audience: 'test', accessTokenTtlSeconds: 60 };
const signer = new DefaultJwtSigner(opts);
const verifier = new DefaultJwtVerifier(opts);

const token = await signer.signAccessToken({ sub: 'u1', roles: [] });
const principal = await verifier.verifyAccessToken(token);
```

## 핵심 API

| Export | 위치 | 설명 |
|---|---|---|
| `DefaultJwtVerifier` | `src/verifier.ts` | `verifyAccessToken(token) → JwtPrincipal` |
| `DefaultJwtSigner` | `src/signer.ts` | `signAccessToken(claims) → string` |
| `createJwtCoreProviders(options)` | `src/module.ts` | options, verifier, signer를 한 번에 등록 |
| `JwtPrincipal` | `src/types.ts` | `{ subject, issuer?, audience?, roles?, scopes?, claims }` |
| `JwtClaims` | `src/types.ts` | raw claims shape |
| `JwtVerifierOptions` | `src/types.ts` | `{ algorithms, secret?, keys?, issuer?, audience?, accessTokenTtlSeconds?, clockSkewSeconds? }` |
| `JwtVerifier` | `src/types.ts` | custom verifier 구현을 위한 인터페이스 |
| `JwtSigner` | `src/types.ts` | custom signer 구현을 위한 인터페이스 |
| `JwtStrategy` | `src/strategy.ts` | `DefaultJwtVerifier` 기반의 Passport 호환 bearer-token strategy |

## 구조

### Verifier 파이프라인

```text
verifyAccessToken(token)
  1. header + payload + signature를 분리하고 base64url 디코딩
  2. algorithm이 허용 목록에 있는지 확인
  3. 해당 알고리즘의 HMAC signature 검증
  4. claims 검증: exp, nbf, iss, aud
  5. normalizePrincipal(payload) → JwtPrincipal
```

### Principal 정규화

`normalizePrincipal()`은 상위 레이어에 안정적인 shape를 제공한다:
- `sub` 필수 — 없으면 throw, 결과 principal에는 `subject`로 정규화
- `roles`를 배열로 정규화 (undefined → `[]`)
- 공백으로 구분된 `scope` 문자열과 `scopes` 배열을 하나의 `scopes: string[]`으로 통합
- 원본 raw claims를 `claims`에 보존

덕분에 호출 측(예: passport strategy)은 claim shape 변형에 대해 분기할 필요가 없다.

### Signer 기본값

`signAccessToken`에 전달된 claims에 `iss`, `aud`, `iat`, `exp`가 없으면 signer가 options에서 채워준다. 이를 통해 framework 레벨의 access token이 항상 필수 메타데이터를 가지도록 보장한다.

### Algorithm 설계

두 가지 별도 확인이 존재한다: "이 algorithm이 허용 목록에 있는가?"와 "이 구현이 실제로 지원하는가?". 현재 구현은 HS256, HS384, HS512를 지원하며, 분리 덕분에 하나를 확장할 때 다른 쪽이 의도치 않게 열리는 것을 방지할 수 있다.

## 파일 읽기 순서 (기여자용)

1. `src/types.ts` — `JwtVerifierOptions`, `JwtClaims`, `JwtPrincipal`, `JwtVerifier`, `JwtSigner`
2. `src/errors.ts` — 타입이 있는 JWT 에러 (만료, 유효하지 않은 signature, missing claim 등)
3. `src/verifier.ts` — `DefaultJwtVerifier`, `normalizePrincipal`
4. `src/signer.ts` — `DefaultJwtSigner`, 기본값 채우기
5. `src/module.ts` — `createJwtCoreProviders`
6. `src/verifier.test.ts` — happy path, 만료된 토큰, 유효하지 않은 signature
7. `src/signer.test.ts` — sign/verify roundtrip

## 관련 패키지

- `@konekti/passport` — 이 token core를 호출하는 auth strategy/guard 레이어
- `@konekti/http` — auth 실패가 HTTP response로 변환되는 방식

## 한 줄 mental model

```text
@konekti/jwt = HTTP를 모르는 token core: 서명 → 검증 → JwtPrincipal로 정규화
```
