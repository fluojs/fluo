# Auth & JWT Contract

<p><a href="./auth-and-jwt.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/jwt`, `@fluojs/passport`, `@fluojs/http` 전반에서 현재 적용되는 JWT 서명, 검증, principal 정규화 계약을 정의합니다.

## JWT Signing Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Module entrypoints | 애플리케이션 모듈은 `JwtModule.forRoot(...)` 또는 `JwtModule.forRootAsync(...)`를 통해 JWT 서비스를 등록해야 합니다. | `packages/jwt/src/module.ts` |
| Exported services | `JwtModule`은 `DefaultJwtSigner`, `DefaultJwtVerifier`, `JwtService`를 등록합니다. 동기/비동기 등록은 모두 `RefreshTokenService`를 포함한 동일한 provider surface를 export하며, `RefreshTokenService`를 resolve하려면 여전히 `refreshToken` 옵션이 구성되어 있어야 합니다. | `packages/jwt/src/module.ts` |
| Allowed signing algorithms | 액세스 토큰 서명은 signer가 지원하는 첫 번째 구성 알고리즘을 사용합니다. 지원 값은 `HS256`, `HS384`, `HS512`, `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`입니다. | `packages/jwt/src/signing/signer.ts`, `packages/jwt/src/types.ts` |
| Key material | HMAC 서명에는 `secret` 또는 `keys[]`의 HMAC 항목이 필요합니다. 비대칭 서명에는 `privateKey` 또는 `keys[]`의 private-key 항목이 필요합니다. 서명 재료가 없으면 구성 오류입니다. | `packages/jwt/src/signing/signer.ts` |
| Default lifetime | `DefaultJwtSigner`는 `exp`를 `now + accessTokenTtlSeconds`로 설정합니다. `accessTokenTtlSeconds`가 없으면 기본 액세스 토큰 수명은 `3600`초입니다. | `packages/jwt/src/signing/signer.ts` |
| Default claims | `DefaultJwtSigner`는 호출자가 제공하지 않은 `aud`, `iss`, `iat`, `exp`를 모듈 옵션으로 채웁니다. | `packages/jwt/src/signing/signer.ts` |
| Per-call overrides | `JwtService.sign(payload, options)`는 `aud`, `iss`, `sub`, `nbf`, `exp`를 호출 단위로 재정의할 수 있습니다. `expiresIn` 옵션은 기존 `payload.exp`보다 우선합니다. | `packages/jwt/src/service.ts`, `packages/jwt/src/service.test.ts` |
| Refresh-token algorithm set | 리프레시 토큰 서명은 HMAC 알고리즘으로 제한됩니다. 구성된 알고리즘 목록에 HMAC이 없으면 리프레시 토큰 서명이 실패합니다. | `packages/jwt/src/signing/signer.ts`, `packages/jwt/src/signing/verifier.ts` |
| Refresh-token shape | `RefreshTokenService`는 `type: 'refresh'`, `jti`, `family`, `sub`, `iat`, `exp`를 포함한 리프레시 토큰을 발급하고, 이에 대응하는 저장소 레코드를 저장합니다. | `packages/jwt/src/refresh/refresh-token.ts` |
| Rotation prerequisite | `refreshToken.rotation`이 활성화되면 구성된 리프레시 토큰 저장소는 원자적 `consume(...)`를 구현해야 합니다. 원자적 consume 지원이 없으면 구성 오류입니다. | `packages/jwt/src/refresh/refresh-token.ts` |
| Rotation failure handling | 이미 소비된 리프레시 토큰의 재사용은 subject 토큰 패밀리를 revoke하고 `JwtInvalidTokenError`를 발생시킵니다. | `packages/jwt/src/refresh/refresh-token.ts` |

## Verification Constraints

| Constraint | Current contract | Source anchor |
| --- | --- | --- |
| Token shape | JWT 검증은 정확히 세 개의 compact-token 세그먼트를 요구합니다. 형식이 잘못된 토큰은 `JwtInvalidTokenError`로 실패합니다. | `packages/jwt/src/signing/verifier.ts` |
| Algorithm allowlist | verifier는 `alg`가 구성된 `algorithms` 허용 목록에 없는 토큰을 거부해야 합니다. | `packages/jwt/src/signing/verifier.ts` |
| Signature resolution | HMAC 검증은 `secretOrKeyProvider`, `keys[]`, 또는 `secret`를 사용합니다. 비대칭 검증은 `secretOrKeyProvider`, JWKS, `keys[]`, 또는 `publicKey`를 사용합니다. 검증 재료가 없으면 구성 오류입니다. | `packages/jwt/src/signing/verifier.ts` |
| `kid` requirements | 다중 키 HMAC 검증, 다중 키 공개키 검증, JWKS 검증은 모두 인식 가능한 `kid`를 요구합니다. 누락되었거나 알 수 없는 `kid`는 검증 실패입니다. | `packages/jwt/src/signing/verifier.ts` |
| Expiration | `requireExp`의 기본값은 활성화입니다. verifier가 명시적으로 `requireExp: false`를 설정하지 않으면 `exp`가 없는 토큰은 실패합니다. 만료된 토큰은 `JwtExpiredTokenError`를 발생시킵니다. | `packages/jwt/src/signing/verifier.ts` |
| Activation time | `nbf`가 미래인 토큰은 clock skew 보정 후 `JWT is not active yet.`로 실패합니다. | `packages/jwt/src/signing/verifier.ts` |
| Issuer and audience | `issuer` 또는 `audience`가 구성된 경우 verifier는 `iss` 또는 `aud`가 일치하지 않는 토큰을 거부해야 합니다. `JwtService.verify(token, options)`는 호출 단위로 알고리즘/클레임 정책 필드(`algorithms`, `issuer`, `audience`, `clockSkewSeconds`, `maxAge`, `requireExp`)만 재정의할 수 있으며, 공유 JWKS 상태나 key-resolution 상태를 다시 만들지는 않습니다. | `packages/jwt/src/signing/verifier.ts`, `packages/jwt/src/service.ts` |
| Maximum age | `maxAge`가 구성된 경우 토큰에는 유한한 `iat` 클레임이 있어야 합니다. 미래 `iat` 또는 `maxAge + clockSkewSeconds`를 초과한 토큰은 검증 실패입니다. | `packages/jwt/src/signing/verifier.ts` |
| Refresh-token verification | 리프레시 토큰 검증은 액세스 토큰 verifier에서 파생되지만, HMAC 전용 알고리즘, `requireExp: true`, 리프레시 secret, 선택적 `verifyMaxAgeSeconds`를 강제합니다. | `packages/jwt/src/signing/verifier.ts` |
| Route enforcement | `AuthGuard`는 활성 전략을 해석하고, 해석된 principal을 `requestContext.principal`에 기록하며, 인증 실패를 `401 Unauthorized`로, 필수 scope 누락을 `403 Forbidden`으로 변환합니다. | `packages/passport/src/guard.ts` |
| Scope matching | 라우트 scope 검사는 선언된 모든 scope가 `principal.scopes`에 존재해야 통과합니다. | `packages/passport/src/guard.ts` |

## Principal Model

`@fluojs/jwt`는 검증된 클레임을 아래의 `JwtPrincipal` 형태로 정규화합니다.

| Field | Type | Rule | Source anchor |
| --- | --- | --- | --- |
| `subject` | `string` | 필수입니다. `sub`가 없거나 비어 있으면 검증이 실패합니다. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts` |
| `issuer` | `string \| undefined` | 검증 후 `iss`에서 복사됩니다. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts` |
| `audience` | `string \| string[] \| undefined` | 검증 후 `aud`에서 복사됩니다. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts` |
| `roles` | `string[] \| undefined` | 문자열 배열 `roles` 클레임에서만 파생됩니다. 문자열이 아닌 항목은 제거됩니다. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts` |
| `scopes` | `string[] \| undefined` | `scopes[]` 또는 공백으로 구분된 `scope` 클레임에서 파생됩니다. 빈 항목은 정규화 과정에서 제거됩니다. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts`, `packages/passport/src/scope.ts` |
| `claims` | `Record<string, unknown>` | 검증된 전체 클레임 bag이 후속 읽기를 위해 유지됩니다. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts` |

Principal 처리 제약:

- 애플리케이션 코드는 `requestContext.principal`을 활성 인증 전략이 채우는 런타임 소유 신원 경계로 취급해야 합니다.
- 전략 구현은 `@fluojs/http`가 허용하는 임의의 `Principal` 형태를 반환할 수 있지만, JWT 기반 전략은 `DefaultJwtVerifier`가 생성한 정규화 `JwtPrincipal`을 반환하는 편이 맞습니다.
- Scope가 필요한 라우트는 컨트롤러에서 원시 JWT 클레임을 직접 읽기보다 `@RequireScopes(...)`로 scope를 선언해야 합니다.
