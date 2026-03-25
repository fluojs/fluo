# auth and jwt

<p><strong><kbd>English</kbd></strong> <a href="./auth-and-jwt.ko.md"><kbd>한국어</kbd></a></p>

This guide explains how authentication and JWT support are distributed across Konekti packages.

## package boundaries

- **`@konekti/jwt`**: Core JWT contracts, signing, verification, claim validation, and principal normalization.
- **`@konekti/passport`**: Strategy registration, generic authentication guard wiring, and strategy adapter contracts.
- **`@konekti/http`**: Guard orchestration, `RequestContext` management, and runtime execution.
- **`@konekti/config`**: Management of key material, issuers, and audiences.

## responsibility split

- **Token extraction**: Strategy-specific adapter logic.
- **Signature and claim verification**: Handled by `JwtVerifier`.
- **Principal normalization**: Handled by `JwtVerifier`.
- **Route-level auth requirements**: Managed via passport metadata and authentication guards.
- **Context attachment**: Attaching the verified principal to the `RequestContext`.
- **Error mapping**: Handled by the passport and HTTP exception layers.

## request flow

A typical authenticated request follows this path:

1.  **HTTP request** arrives.
2.  **Auth guard** identifies the required strategy.
3.  **Auth strategy** verifies the credentials (e.g., JWT).
4.  **Principal** is extracted and normalized.
5.  **`RequestContext.principal`** is populated.
6.  **Controller/Service** executes with the authenticated principal.

## core principles

- JWT is a specific strategy, not the entire authentication model.
- `@konekti/passport` remains strategy-agnostic.
- `@konekti/jwt` remains transport-agnostic.
- Application code should interact with normalized principals instead of raw payloads.

## jwt support scope

### algorithms

- **HMAC**: `HS256`, `HS384`, `HS512`.
- **Asymmetric**: `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`.

### key management

For asymmetric algorithms, provide `privateKey` and `publicKey` (PEM strings or `KeyObject`) in `JwtVerifierOptions`. Key rotation is supported via the `keys` array, using the `kid` (Key ID) header.

## standard auth pattern

The recommended authentication patterns are:

1. **Bearer token authentication** via the `Authorization: Bearer <token>` header
2. **Cookie authentication** via HttpOnly secure cookies (official preset)

### official cookie auth preset

`@konekti/passport` now provides an official HttpOnly cookie auth preset for JWT-based authentication:

```typescript
import { Module } from '@konekti/core';
import {
  createPassportProviders,
  createCookieAuthPreset,
} from '@konekti/passport';
import { createJwtCoreProviders } from '@konekti/jwt';

@Module({
  providers: [
    ...createJwtCoreProviders({
      algorithms: ['HS256'],
      secret: process.env.JWT_SECRET!,
      issuer: 'my-app',
      audience: 'my-app-clients',
      accessTokenTtlSeconds: 3600,
    }),
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

The preset includes:
- `CookieAuthStrategy`: Extracts JWT from HttpOnly cookies
- `CookieManager`: Utilities for setting/clearing auth cookies
- Secure defaults: `HttpOnly: true`, `Secure: true`, `SameSite: strict`

See `@konekti/passport` documentation for full cookie auth lifecycle details.

### application-level policies

The following areas remain application-specific:

- Login endpoint implementation (credential validation)
- User session storage (if needed beyond JWT)
- Cookie domain and path customization per route
- Multi-tenant cookie isolation
- Cookie consent compliance

### framework-level refresh token lifecycle

`@konekti/passport` provides framework-level primitives for refresh token operations via `RefreshTokenService`:

- **Issue**: Create new refresh tokens for subjects.
- **Rotate**: Exchange refresh tokens for new access + refresh tokens with replay detection.
- **Revoke**: Invalidate specific tokens or all tokens for a subject (logout).

The `RefreshTokenStrategy` extracts refresh tokens from request body (`refreshToken`), `Authorization: Bearer` header, or a custom `x-refresh-token` header. The framework handles header shape normalization (string or string array) internally.

## further reading

- **`@konekti/jwt`**: `../../packages/jwt/README.md`
- **`@konekti/passport`**: `../../packages/passport/README.md`
- **`@konekti/http`**: `../../packages/http/README.md`
