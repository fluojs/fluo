# @fluojs/jwt

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

HTTP-agnostic JWT token core that handles signing access tokens and verifying them into a normalized `JwtPrincipal`.

## Table of Contents

- [Installation](#installation)
- [When to use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/jwt
```

## When to Use

- When you need to issue or verify JWT access tokens in a backend application.
- When you want a stable `JwtPrincipal` shape (subject, roles, scopes) regardless of the underlying token claim variants.
- When implementing refresh token rotation with replay detection.

## Quick Start

### Register the Module

Configure the JWT module with your signing keys and policy.

`JwtModule.forRoot(...)` and `JwtModule.forRootAsync(...)` are the canonical application entrypoints. Use `createJwtCoreProviders(...)` only when you intentionally need advanced direct provider composition inside an existing custom module.

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

### Sign and Verify Tokens

Inject `DefaultJwtSigner` to issue tokens and `DefaultJwtVerifier` to validate them.

```typescript
import { DefaultJwtSigner, DefaultJwtVerifier } from '@fluojs/jwt';

// Sign
const token = await signer.signAccessToken({
  sub: 'user-123',
  roles: ['admin'],
  scopes: ['read:profile'],
});

// Verify
const principal = await verifier.verifyAccessToken(token);
// principal: { subject: 'user-123', roles: ['admin'], scopes: ['read:profile'], ... }
```

When you use `JwtService.sign(payload, { expiresIn })`, the per-call `expiresIn` override always wins over any pre-existing `payload.exp` value so token lifetime stays deterministic at the call site.

## Common Patterns

### Asymmetric Signing (RS256/ES256)

Use public/private key pairs for enhanced security across distributed systems.

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

### Principal Normalization

`@fluojs/jwt` automatically unifies `scope` (string) and `scopes` (array) claims into a single `scopes: string[]` property in the `JwtPrincipal`, ensuring consistent behavior for authorization guards.

### Remote JWKS verification

When verification keys come from a remote JWKS endpoint, keep the fetch path bounded so auth traffic cannot hang on a slow or stalled identity provider.

```typescript
const verifier = new DefaultJwtVerifier({
  algorithms: ['RS256'],
  jwksRequestTimeoutMs: 5_000,
  jwksUri: 'https://issuer.example.com/.well-known/jwks.json',
});
```

`jwksRequestTimeoutMs` defaults to `5_000` and aborts the outbound JWKS fetch once that budget is exceeded.

## Public API Overview

### Core Classes
- `JwtModule`: The main entry point for DI registration.
- `DefaultJwtSigner`: Handles token issuance with default claim filling.
- `DefaultJwtVerifier`: Handles token validation and normalization.
- `JwtService`: A convenience facade combining signing and verification.

### Advanced Helpers
- `createJwtCoreProviders(...)`: Low-level provider factory for custom composition when `JwtModule.forRoot(...)` / `forRootAsync(...)` is not a fit.

### Types
- `JwtPrincipal`: The normalized identity object (`subject`, `roles`, `scopes`, `claims`).
- `JwtVerifierOptions`: Configuration for algorithms, keys, and validation policy.

## Related Packages

- `@fluojs/passport`: The auth execution layer that uses this core for guards and strategies.
- `@fluojs/config`: Recommended for managing secrets and JWT options across environments.

## Example Sources

- `packages/jwt/src/module.test.ts`: Module registration and DI patterns.
- `packages/jwt/src/signing/signer.test.ts`: Token signing examples.
- `examples/auth-jwt-passport/src/auth/auth.service.ts`: Real-world token issuance.
