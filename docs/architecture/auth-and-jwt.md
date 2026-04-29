# Auth & JWT Contract

<p><strong><kbd>English</kbd></strong> <a href="./auth-and-jwt.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current JWT signing, verification, and principal-normalization contract across `@fluojs/jwt`, `@fluojs/passport`, and `@fluojs/http`.

## JWT Signing Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Module entrypoints | Application modules MUST register JWT services through `JwtModule.forRoot(...)` or `JwtModule.forRootAsync(...)`. | `packages/jwt/src/module.ts` |
| Exported services | `JwtModule` registers `DefaultJwtSigner`, `DefaultJwtVerifier`, and `JwtService`. Sync and async registration export the same provider surface, including `RefreshTokenService`; resolving `RefreshTokenService` still requires `refreshToken` options to be configured. | `packages/jwt/src/module.ts` |
| Allowed signing algorithms | Access-token signing uses the first configured algorithm that is supported by the signer. Supported values are `HS256`, `HS384`, `HS512`, `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`. | `packages/jwt/src/signing/signer.ts`, `packages/jwt/src/types.ts` |
| Key material | HMAC signing requires `secret` or an HMAC entry in `keys[]`. Asymmetric signing requires `privateKey` or a private-key entry in `keys[]`. Missing signing material is a configuration error. | `packages/jwt/src/signing/signer.ts` |
| Default lifetime | `DefaultJwtSigner` sets `exp` to `now + accessTokenTtlSeconds`. When `accessTokenTtlSeconds` is unset, the default access-token lifetime is `3600` seconds. | `packages/jwt/src/signing/signer.ts` |
| Default claims | `DefaultJwtSigner` fills `aud`, `iss`, `iat`, and `exp` from module options when the caller does not provide them. | `packages/jwt/src/signing/signer.ts` |
| Per-call overrides | `JwtService.sign(payload, options)` MAY override `aud`, `iss`, `sub`, `nbf`, and `exp`. The `expiresIn` option takes precedence over any existing `payload.exp` value. | `packages/jwt/src/service.ts`, `packages/jwt/src/service.test.ts` |
| Refresh-token algorithm set | Refresh-token signing is limited to HMAC algorithms. If the configured algorithm list contains no HMAC algorithm, refresh-token signing fails. | `packages/jwt/src/signing/signer.ts`, `packages/jwt/src/signing/verifier.ts` |
| Refresh-token shape | `RefreshTokenService` issues refresh tokens with `type: 'refresh'`, `jti`, `family`, `sub`, `iat`, and `exp`, then persists a matching store record. | `packages/jwt/src/refresh/refresh-token.ts` |
| Rotation prerequisite | When `refreshToken.rotation` is enabled, the configured refresh-token store MUST implement atomic `consume(...)`. Missing atomic consume support is a configuration error. | `packages/jwt/src/refresh/refresh-token.ts` |
| Rotation failure handling | Reuse of a consumed refresh token revokes the subject token family and raises `JwtInvalidTokenError`. | `packages/jwt/src/refresh/refresh-token.ts` |

## Verification Constraints

| Constraint | Current contract | Source anchor |
| --- | --- | --- |
| Token shape | JWT verification requires exactly three compact-token segments. Malformed tokens fail with `JwtInvalidTokenError`. | `packages/jwt/src/signing/verifier.ts` |
| Algorithm allowlist | The verifier MUST reject any token whose `alg` is not in the configured `algorithms` allowlist. | `packages/jwt/src/signing/verifier.ts` |
| Signature resolution | HMAC verification uses `secretOrKeyProvider`, `keys[]`, or `secret`. Asymmetric verification uses `secretOrKeyProvider`, JWKS, `keys[]`, or `publicKey`. Missing verification material is a configuration error. | `packages/jwt/src/signing/verifier.ts` |
| `kid` requirements | Multi-key HMAC verification, multi-key public-key verification, and JWKS verification require a recognized `kid`. Missing or unknown `kid` values fail verification. | `packages/jwt/src/signing/verifier.ts` |
| Expiration | `requireExp` defaults to enabled. Tokens without `exp` fail unless the verifier explicitly sets `requireExp: false`. Expired tokens raise `JwtExpiredTokenError`. | `packages/jwt/src/signing/verifier.ts` |
| Activation time | Tokens with `nbf` in the future fail with `JWT is not active yet.` after clock-skew adjustment. | `packages/jwt/src/signing/verifier.ts` |
| Issuer and audience | When `issuer` or `audience` is configured, the verifier MUST reject tokens whose `iss` or `aud` claims do not match the configured values. `JwtService.verify(token, options)` may override only algorithm and claim-policy fields (`algorithms`, `issuer`, `audience`, `clockSkewSeconds`, `maxAge`, `requireExp`) per call without rebuilding shared JWKS or key-resolution state. | `packages/jwt/src/signing/verifier.ts`, `packages/jwt/src/service.ts` |
| Maximum age | When `maxAge` is configured, the token MUST include a finite `iat` claim. Tokens with future `iat` or age beyond `maxAge + clockSkewSeconds` fail verification. | `packages/jwt/src/signing/verifier.ts` |
| Refresh-token verification | Refresh-token verification is derived from the access-token verifier, but it forces HMAC-only algorithms, `requireExp: true`, the refresh secret, and optional `verifyMaxAgeSeconds`. | `packages/jwt/src/signing/verifier.ts` |
| Route enforcement | `AuthGuard` resolves the active strategy, writes the resolved principal to `requestContext.principal`, converts authentication failures to `401 Unauthorized`, and converts missing required scopes to `403 Forbidden`. | `packages/passport/src/guard.ts` |
| Scope matching | Route scope checks require every declared scope to be present in `principal.scopes`. | `packages/passport/src/guard.ts` |

## Principal Model

`@fluojs/jwt` normalizes verified claims into the `JwtPrincipal` shape below.

| Field | Type | Rule | Source anchor |
| --- | --- | --- | --- |
| `subject` | `string` | Required. Verification fails when `sub` is missing or empty. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts` |
| `issuer` | `string \| undefined` | Copied from `iss` after verification. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts` |
| `audience` | `string \| string[] \| undefined` | Copied from `aud` after verification. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts` |
| `roles` | `string[] \| undefined` | Derived only from a string-array `roles` claim. Non-string entries are discarded. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts` |
| `scopes` | `string[] \| undefined` | Derived from `scopes[]` or from the space-delimited `scope` claim. Empty items are removed during normalization. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts`, `packages/passport/src/scope.ts` |
| `claims` | `Record<string, unknown>` | Full verified claim bag preserved for downstream reads. | `packages/jwt/src/types.ts`, `packages/jwt/src/signing/verifier.ts` |

Principal-handling constraints:

- Application code should treat `requestContext.principal` as the runtime-owned identity boundary populated by the active auth strategy.
- Strategy implementations MAY return any `Principal` shape accepted by `@fluojs/http`, but JWT-based strategies should return the normalized `JwtPrincipal` produced by `DefaultJwtVerifier`.
- Scope-bearing routes should declare scopes through `@RequireScopes(...)`, not by reading raw JWT claims inside controllers.
