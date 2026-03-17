# @konekti/jwt

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


HTTP-agnostic JWT token core — signs access tokens and verifies them to a normalized `JwtPrincipal`.

## See also

- `../../docs/concepts/auth-and-jwt.md`
- `../../docs/concepts/architecture-overview.md`

## What this package does

`@konekti/jwt` knows nothing about routes or guards. It owns:

- Signing access tokens with HMAC algorithms such as HS256, HS384, and HS512 (`DefaultJwtSigner.signAccessToken`)
- Verifying tokens: shape → algorithm → signature → claims (`exp`, `nbf`, `iss`, `aud`)
- Normalising verified claims to a `JwtPrincipal` (`subject`, `roles`, `scopes`, `claims`)
- Exporting `JwtStrategy`, the reusable bearer-token strategy adapter for `@konekti/passport`

`JwtStrategy` handles bearer-token extraction for the generic passport contract, while the token core stays reusable without HTTP framework coupling.

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

## Key API

| Export | Location | Description |
|---|---|---|
| `DefaultJwtVerifier` | `src/verifier.ts` | `verifyAccessToken(token) → JwtPrincipal` |
| `DefaultJwtSigner` | `src/signer.ts` | `signAccessToken(claims) → string` |
| `createJwtCoreProviders(options)` | `src/module.ts` | Registers options, verifier, and signer in one call |
| `JwtPrincipal` | `src/types.ts` | `{ subject, issuer?, audience?, roles?, scopes?, claims }` |
| `JwtClaims` | `src/types.ts` | Raw claims shape |
| `JwtVerifierOptions` | `src/types.ts` | `{ secret, issuer?, audience?, algorithms?, accessTokenTtlSeconds? }` |
| `JwtVerifier` | `src/types.ts` | Interface for custom verifier implementations |
| `JwtSigner` | `src/types.ts` | Interface for custom signer implementations |
| `JwtStrategy` | `src/strategy.ts` | Passport-compatible bearer-token strategy backed by `DefaultJwtVerifier` |

## Architecture

### Verifier pipeline

```text
verifyAccessToken(token)
  1. Split and base64url-decode header + payload + signature
  2. Check algorithm is in the allowed list
  3. Verify the matching HMAC signature implementation
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

Two separate checks exist: "is this algorithm in the allowlist?" and "does this implementation support it?". The current implementation supports HS256, HS384, and HS512, and the separation makes it safe to extend one without accidentally opening the other.

## File reading order for contributors

1. `src/types.ts` — `JwtVerifierOptions`, `JwtClaims`, `JwtPrincipal`, `JwtVerifier`, `JwtSigner`
2. `src/errors.ts` — typed JWT errors (expired, invalid signature, missing claim, etc.)
3. `src/verifier.ts` — `DefaultJwtVerifier`, `normalizePrincipal`
4. `src/signer.ts` — `DefaultJwtSigner`, defaults filling
5. `src/strategy.ts` — `JwtStrategy`
6. `src/module.ts` — `createJwtCoreProviders`
7. `src/verifier.test.ts` — happy path, expired token, invalid signature
8. `src/signer.test.ts` — sign/verify roundtrip

## Related packages

- `@konekti/passport` — the auth strategy/guard layer that calls this token core
- `@konekti/http` — how auth failures become HTTP responses

## One-liner mental model

```text
@konekti/jwt = HTTP-agnostic token core: sign → verify → normalize to JwtPrincipal
```
