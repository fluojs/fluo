# @konekti/jwt

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
npm install @konekti/jwt
```

## When to Use

- When you need to issue or verify JWT access tokens in a backend application.
- When you want a stable `JwtPrincipal` shape (subject, roles, scopes) regardless of the underlying token claim variants.
- When implementing refresh token rotation with replay detection.

## Quick Start

### Register the Module

Configure the JWT module with your signing keys and policy.

```typescript
import { Module } from '@konekti/core';
import { JwtModule } from '@konekti/jwt';

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
import { DefaultJwtSigner, DefaultJwtVerifier } from '@konekti/jwt';

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

`@konekti/jwt` automatically unifies `scope` (string) and `scopes` (array) claims into a single `scopes: string[]` property in the `JwtPrincipal`, ensuring consistent behavior for authorization guards.

## Public API Overview

### Core Classes
- `JwtModule`: The main entry point for DI registration.
- `DefaultJwtSigner`: Handles token issuance with default claim filling.
- `DefaultJwtVerifier`: Handles token validation and normalization.
- `JwtService`: A convenience facade combining signing and verification.

### Types
- `JwtPrincipal`: The normalized identity object (`subject`, `roles`, `scopes`, `claims`).
- `JwtVerifierOptions`: Configuration for algorithms, keys, and validation policy.

## Related Packages

- `@konekti/passport`: The auth execution layer that uses this core for guards and strategies.
- `@konekti/config`: Recommended for managing secrets and JWT options across environments.

## Example Sources

- `packages/jwt/src/module.test.ts`: Module registration and DI patterns.
- `packages/jwt/src/signing/signer.test.ts`: Token signing examples.
- `examples/auth-jwt-passport/src/auth/auth.service.ts`: Real-world token issuance.
