# @konekti/jwt

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


HTTP-agnostic JWT token core — signs access tokens and verifies them to a normalized `JwtPrincipal`.

The current official docs/examples path uses this package through bearer-token auth. Broader session/cookie policy remains outside the framework default story today.

## See also

- `../../docs/concepts/auth-and-jwt.md`
- `../../docs/concepts/architecture-overview.md`

## What this package does

`@konekti/jwt` knows nothing about routes or guards. It performs the following:

- Signs access tokens with HMAC algorithms such as HS256, HS384, and HS512 (`DefaultJwtSigner.signAccessToken`).
- Signs access tokens with asymmetric algorithms such as RS256, RS384, RS512, ES256, ES384, and ES512.
- Verifies tokens: shape → algorithm → signature → claims (`exp`, `nbf`, `iss`, `aud`).
- Normalizes verified claims to a `JwtPrincipal` (`subject`, `roles`, `scopes`, `claims`).

Current scope notes:

- Shipped algorithms: `HS256`, `HS384`, `HS512`, `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`.
- Refresh-token issuance, rotation, and revoke/logout flows are available through `@konekti/passport`'s `RefreshTokenService` interface.

## Installation

```bash
npm install @konekti/jwt
```

## Quick Start

### Register with DI

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

### Runtime module entrypoints

`JwtModule` exposes canonical runtime module entrypoints:

- `JwtModule.forRoot(options)`
- `JwtModule.forRootAsync({ inject?, useFactory })`

`JwtModule.register(...)` is intentionally not part of the supported runtime entrypoint contract.

### Sign a token

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

### Verify a token

```typescript
import { DefaultJwtVerifier } from '@konekti/jwt';

const verifier = await container.resolve(DefaultJwtVerifier);
const principal = await verifier.verifyAccessToken(token);
// principal: { subject: 'user-123', roles: ['admin'], scopes: ['read:profile'], claims: {...} }
```

### Standalone (no DI)

```typescript
import { DefaultJwtSigner, DefaultJwtVerifier } from '@konekti/jwt';

const opts = { algorithms: ['HS256'], secret: 'super-secret', issuer: 'test', audience: 'test', accessTokenTtlSeconds: 60 };
const signer = new DefaultJwtSigner(opts);
const verifier = new DefaultJwtVerifier(opts);

const token = await signer.signAccessToken({ sub: 'u1', roles: [] });
const principal = await verifier.verifyAccessToken(token);
```

### Asymmetric algorithms (RS256 / ES256)

Pass `privateKey` and `publicKey` (PEM string or Node.js `KeyObject`) when using RS* or ES* algorithms:

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

For key rotation, use the `keys` array with `kid`:

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

## Key API

| Export | Location | Description |
|---|---|---|
| `DefaultJwtVerifier` | `src/verifier.ts` | `verifyAccessToken(token) → Promise<JwtPrincipal>` |
| `DefaultJwtSigner` | `src/signer.ts` | `signAccessToken(claims) → Promise<string>` |
| `createJwtCoreProviders(options)` | `src/module.ts` | Registers options, verifier, and signer in one call |
| `JwtPrincipal` | `src/types.ts` | `{ subject, issuer?, audience?, roles?, scopes?, claims }` |
| `JwtClaims` | `src/types.ts` | Raw claims shape |
| `JwtVerifierOptions` | `src/types.ts` | `{ secret?, privateKey?, publicKey?, issuer?, audience?, algorithms?, accessTokenTtlSeconds?, keys?, refreshToken? }` |
| `JwtVerifier` | `src/types.ts` | Interface for custom verifier implementations |
| `JwtSigner` | `src/types.ts` | Interface for custom signer implementations |
| `RefreshTokenService` | `src/refresh-token.ts` | Service for refresh token lifecycle (issue, rotate, revoke) |
| `RefreshTokenStore` | `src/refresh-token.ts` | Interface for refresh token persistence |
| `createJwtPlatformStatusSnapshot(input)` | `src/status.ts` | Maps JWT ownership/readiness/health and policy boundary into shared platform snapshot shape |
| `createJwtPlatformDiagnosticIssues(input)` | `src/status.ts` | Emits package-prefixed auth diagnostics for refresh-token backing dependency readiness |

## Platform status snapshot semantics

Use `createJwtPlatformStatusSnapshot(...)` to expose JWT platform alignment signals without changing token behavior:

- `ownership` is explicit: JWT primitives are framework-provided while key/session policy remains externally managed.
- `details.policyBoundary` separates framework-owned primitives from application-owned login/session policy.
- `details.refreshToken.backingStore` can surface refresh-token dependency readiness when refresh mode is enabled.
- `details.telemetry.labels` follows shared labels (`component_id`, `component_kind`, `operation`, `result`).

Use `createJwtPlatformDiagnosticIssues(...)` to emit stable `AUTH_JWT_*` diagnostics with `fixHint` and optional dependency edges (`dependsOn`).

## Architecture

### Verifier pipeline

```text
verifyAccessToken(token)
  1. Split and base64url-decode header + payload + signature
  2. Check algorithm is in the allowed list
  3. Verify the signature — HMAC (createHmac) for HS* or asymmetric (createVerify) for RS*/ES*
  4. Validate claims: exp, nbf, iss, aud
  5. normalizePrincipal(payload) → JwtPrincipal
```

### Principal normalization

`normalizePrincipal()` provides a stable shape to the layer above:
- Requires `sub` — throws if missing
- Normalizes `roles` to an array (accepts undefined → `[]`)
- Unifies `scope` (space-separated string) and `scopes` (array) into a single `scopes: string[]`
- Preserves the original raw claims in `claims`

This means the caller (e.g., a passport strategy) never has to branch on claim shape variants.

### Signer defaults

If `iss`, `aud`, `iat`, or `exp` are absent from the claims passed to `signAccessToken`, the signer fills them from the options. This ensures framework-level access tokens always have the required metadata.

### Algorithm design

Two separate checks exist: "is this algorithm in the allowlist?" and "does this implementation support it?". HMAC algorithms (HS*) use `createHmac` with a shared secret; asymmetric algorithms (RS*, ES*) use `createVerify`/`createSign` with a key pair. The separation makes it safe to extend the allowlist without accidentally opening unsupported paths.

Refresh token verification is HMAC-only. If `refreshToken` is configured, the verifier requires at least one of `HS256` / `HS384` / `HS512` in the allowed algorithm list and fails fast during construction otherwise.

## File reading order for contributors

1. `src/types.ts` — `JwtVerifierOptions`, `JwtClaims`, `JwtPrincipal`, `JwtVerifier`, `JwtSigner`
2. `src/errors.ts` — typed JWT errors (expired, invalid signature, missing claim, etc.)
3. `src/verifier.ts` — `DefaultJwtVerifier`, `normalizePrincipal`
4. `src/signer.ts` — `DefaultJwtSigner`, defaults filling
5. `src/refresh-token.ts` — `RefreshTokenService`, `RefreshTokenStore`, rotation with replay detection
6. `src/module.ts` — `createJwtCoreProviders`
7. `src/status.ts` — platform snapshot/diagnostics adapter for policy boundary and refresh-token backing readiness
8. `src/verifier.test.ts` — happy path, expired token, invalid signature
9. `src/signer.test.ts` — sign/verify roundtrip
10. `src/refresh-token.test.ts` — refresh token lifecycle, rotation, replay detection, concurrent attempts
11. `src/status.test.ts` — status snapshot and diagnostic issue coverage

## Refresh token integration

For refresh token lifecycle (issue, rotate, revoke with replay detection), use `@konekti/passport`:

```typescript
import { Module } from '@konekti/core';
import { createJwtCoreProviders } from '@konekti/jwt';
import {
  createPassportProviders,
  createRefreshTokenProviders,
  JwtRefreshTokenAdapter,
  RefreshTokenStrategy,
} from '@konekti/passport';

@Module({
  providers: [
    ...createJwtCoreProviders({
      algorithms: ['HS256'],
      secret: process.env.JWT_SECRET!,
      issuer: 'my-app',
      audience: 'my-app-clients',
      accessTokenTtlSeconds: 3600,
      refreshToken: {
        secret: process.env.REFRESH_TOKEN_SECRET!,
        expiresInSeconds: 604800, // 7 days
        rotation: true,
      },
    }),
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

See `@konekti/passport` documentation for full refresh token lifecycle details.

### Refresh token rotation modes

`RefreshTokenService.rotateRefreshToken()` supports two distinct modes controlled by `refreshToken.rotation`:

- **`rotation: true`** — one-time-use refresh tokens. A successful refresh atomically consumes the current token, issues a new refresh token in the same family, and returns `{ accessToken, refreshToken: <new token> }`. Replay / reuse detection is active in this mode and requires `store.consume()`.
- **`rotation: false`** — reusable refresh tokens. A successful refresh returns a new access token but reuses the same refresh token string until it expires or is revoked. No new family member is issued on refresh, and the store record is not consumed as part of the refresh operation.

Choose `rotation: true` when you want one-time-use refresh tokens with replay detection. Choose `rotation: false` only when reusable refresh tokens are an acceptable application policy tradeoff.

## Related packages

- `@konekti/passport` — the auth strategy/guard layer that calls this token core, including refresh token lifecycle
- `@konekti/http` — how auth failures become HTTP responses

## One-liner mental model

```text
@konekti/jwt = HTTP-agnostic token core: sign → verify → normalize to JwtPrincipal
             + refresh token lifecycle via @konekti/passport: issue → rotate → revoke
```
