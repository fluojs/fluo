# @konekti/passport

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Strategy-agnostic auth execution layer for Konekti — routes any `AuthStrategy` through a generic `AuthGuard` into the request context.

The package ships two official presets beyond bearer-token JWT:
- **Cookie auth preset**: HttpOnly cookie JWT extraction with `CookieManager` utilities.
- **Refresh token lifecycle**: Issue, rotate, and revoke refresh tokens with replay detection.

`@konekti/passport` now defines an official account-linking extension contract (`AccountLinkPolicy`), while final identity policy decisions remain application-level concerns.

## See also

- `../../docs/concepts/auth-and-jwt.md`
- `../../docs/concepts/http-runtime.md`

## What this package does

`@konekti/passport` does not implement any concrete auth provider (JWT parsing, Google OAuth, local credentials). Its job is to ensure that *whatever strategy you plug in*, auth runs consistently in the Konekti request lifecycle:

1. `UseAuth('<strategy>')` and `RequireScopes(...)` decorators write auth metadata and attach `AuthGuard` to the route
2. At request time, `AuthGuard` reads the requirement, looks up the strategy by name, calls `strategy.authenticate(context)`, gets a principal, checks scopes, and populates `requestContext.principal`
3. Auth errors map to `UnauthorizedException` (401) or `ForbiddenException` (403)
4. Passport.js strategies can be bridged in via `createPassportJsStrategyBridge()`

`AuthGuard` follows the generic HTTP guard contract explicitly: it returns success to continue the pipeline, throws `UnauthorizedException` / `ForbiddenException` for auth failures, and allows committed-response flows such as redirects to short-circuit the handler.

Scope note:

- `@konekti/passport` owns strategy execution, the refresh token lifecycle (issue / rotate / revoke), the HttpOnly cookie auth preset, and the account-linking policy contract
- the broader account/session lifecycle (login credential validation, session storage, consent, account upsert ownership) remains application-level

## Refresh Token Lifecycle

`@konekti/passport` now provides framework-level primitives for refresh token operations:

- **Issue**: Create new refresh tokens for subjects
- **Rotate**: Exchange refresh tokens for new access + refresh tokens with replay detection
- **Revoke**: Invalidate specific tokens or all tokens for a subject (logout)

When the underlying `@konekti/jwt` refresh-token configuration uses `rotation: false`, the refresh operation still returns a new access token but reuses the same refresh token string until expiry or revocation. Replay-detection semantics described in this section apply to rotation mode (`rotation: true`).

### Use the refresh token strategy

```typescript
import { Controller, Post } from '@konekti/http';
import { UseAuth, RefreshTokenStrategy } from '@konekti/passport';
import type { RequestContext } from '@konekti/http';

@Controller('/auth')
export class AuthController {
  @Post('/refresh')
  @UseAuth('refresh-token')
  async refresh(_: never, ctx: RequestContext) {
    return ctx.principal;
  }
}
```

### Register the refresh token adapter

```typescript
import { Module } from '@konekti/core';
import {
  createPassportProviders,
  createRefreshTokenProviders,
  JwtRefreshTokenAdapter,
  RefreshTokenStrategy,
} from '@konekti/passport';

@Module({
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

### Implement a custom refresh token service

```typescript
import type { RefreshTokenService } from '@konekti/passport';

export class MyRefreshTokenService implements RefreshTokenService {
  async issueRefreshToken(subject: string): Promise<string> {
    // Your implementation
  }

  async rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // Your implementation with rotation and replay detection
  }

  async revokeRefreshToken(tokenId: string): Promise<void> {
    // Your implementation
  }

  async revokeAllForSubject(subject: string): Promise<void> {
    // Logout: revoke all tokens for subject
  }
}
```

## Cookie Auth Preset

`@konekti/passport` provides an official HttpOnly cookie auth preset for JWT-based authentication. This preset extracts JWT tokens from secure HttpOnly cookies instead of bearer headers.

### Use the cookie auth strategy

```typescript
import { Controller, Post, Get } from '@konekti/http';
import { UseAuth, CookieAuthStrategy, CookieManager } from '@konekti/passport';
import type { RequestContext } from '@konekti/http';
import { Inject } from '@konekti/core';
import { DefaultJwtSigner } from '@konekti/jwt';

@Controller('/auth')
export class AuthController {
  @Inject([DefaultJwtSigner, CookieManager])
  constructor(
    private readonly signer: DefaultJwtSigner,
    private readonly cookieManager: CookieManager,
  ) {}

  @Post('/login')
  async login(input: { username: string }, ctx: RequestContext) {
    const accessToken = await this.signer.signAccessToken({
      sub: input.username,
      roles: ['user'],
    });

    this.cookieManager.setAccessTokenCookie(ctx.response, accessToken, 3600);

    return { success: true };
  }

  @Get('/profile')
  @UseAuth('cookie')
  async getProfile(_input: never, ctx: RequestContext) {
    return { user: ctx.principal };
  }

  @Post('/logout')
  async logout(_input: never, ctx: RequestContext) {
    this.cookieManager.clearAllCookies(ctx.response);
    return { success: true };
  }
}
```

### Register the cookie auth preset

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

### Cookie manager utilities

The `CookieManager` class provides utilities for managing auth cookies:

```typescript
import { CookieManager } from '@konekti/passport';
import type { FrameworkResponse } from '@konekti/http';

// Set access token cookie
cookieManager.setAccessTokenCookie(response, accessToken, 3600);

// Set refresh token cookie
cookieManager.setRefreshTokenCookie(response, refreshToken, 604800);

// Set both tokens at once
cookieManager.setAuthCookies(response, accessToken, 3600, refreshToken, 604800);

// Clear access token cookie
cookieManager.clearAccessTokenCookie(response);

// Clear refresh token cookie
cookieManager.clearRefreshTokenCookie(response);

// Clear all auth cookies (logout)
cookieManager.clearAllCookies(response);
```

### Security defaults

The cookie auth preset uses secure defaults:

- **HttpOnly**: `true` (prevents JavaScript access)
- **Secure**: `true` (HTTPS only in production)
- **SameSite**: `strict` (prevents CSRF)
- **Path**: `/` (available across the application)

These defaults can be overridden via `CookieManagerConfig`.

### What the preset owns vs application policy

**The preset owns:**
- JWT extraction from HttpOnly cookies
- Cookie header construction with security flags
- Integration with `@konekti/jwt` verifier

**Application policy (not owned by preset):**
- Login endpoint implementation (credential validation)
- User session storage (if needed beyond JWT)
- Cookie domain and path customization per route
- Multi-tenant cookie isolation
- Cookie consent compliance

## Account Linking Policy Contract

`@konekti/passport` exposes a minimal account-linking policy surface so applications can implement linking consistently without pushing account ownership into the framework:

- `AccountLinkPolicy.evaluate(context)` defines your linking decision logic.
- `resolveAccountLinking(context, policy, options)` normalizes outcomes and enforces typed conflict/rejection semantics.
- `createConservativeAccountLinkPolicy()` is an official baseline policy that requires explicit confirmation before linking ambiguous candidates.

### Framework behavior vs application policy boundary

**Framework-owned behavior:**
- account-linking contract types and DI token (`ACCOUNT_LINKING_POLICY`)
- decision normalization (`linked`, `create-account`, `skipped`)
- explicit typed failures (`AccountLinkConflictError`, `AccountLinkRejectedError`)

**Application-owned behavior:**
- account candidate discovery (queries by email/provider/user metadata)
- consent UI and explicit link confirmation UX
- account upsert/merge transactions and audit logging

### Common flow mapping

| Flow | Typical input context | Expected policy decision |
|---|---|---|
| First external login | `candidates: []` | `create-account` |
| Existing-account match | `candidates: [account]`, no confirmation yet | `conflict` (require explicit confirmation) |
| Explicit link confirmation | `linkAttempt.confirmedByUser === true` and target in candidates | `link` |
| Rejected link attempt | user denies confirmation or target is invalid | `reject` |

### Example: local credential flow (no external linking)

```typescript
import { AuthenticationFailedError } from '@konekti/passport';

export async function loginWithPassword(email: string, password: string) {
  const account = await accountRepository.findByEmail(email);
  if (!account || !(await passwordHasher.verify(password, account.passwordHash))) {
    throw new AuthenticationFailedError('Invalid credentials.');
  }

  return account;
}
```

### Example: external provider flow with explicit confirmation

```typescript
import {
  AccountLinkConflictError,
  AccountLinkRejectedError,
  createConservativeAccountLinkPolicy,
  resolveAccountLinking,
} from '@konekti/passport';

const policy = createConservativeAccountLinkPolicy();

export async function handleGoogleCallback(identity: {
  email?: string;
  providerSubject: string;
}) {
  const candidates = await accountRepository.findCandidatesForExternalIdentity(identity);

  try {
    const resolution = await resolveAccountLinking(
      {
        candidates,
        identity: {
          email: identity.email,
          emailVerified: true,
          provider: 'google',
          providerSubject: identity.providerSubject,
        },
      },
      policy,
    );

    if (resolution.status === 'linked') {
      return accountRepository.attachExternalIdentity(resolution.accountId, 'google', identity.providerSubject);
    }

    if (resolution.status === 'create-account') {
      return accountRepository.createFromExternalIdentity('google', identity.providerSubject, identity.email);
    }

    return { next: 'manual-review' };
  } catch (error) {
    if (error instanceof AccountLinkConflictError) {
      return {
        candidateAccountIds: error.candidateAccountIds,
        next: 'ask-link-confirmation',
      };
    }

    if (error instanceof AccountLinkRejectedError) {
      return { next: 'link-rejected' };
    }

    throw error;
  }
}
```

## Installation

```bash
npm install @konekti/passport
```

## Quick Start

### Declare auth requirements on a route

```typescript
import { UseAuth, RequireScopes } from '@konekti/passport';
import { Controller, Get } from '@konekti/http';
import type { RequestContext } from '@konekti/http';

@Controller('/profile')
export class ProfileController {
  @Get('/')
  @UseAuth('jwt')           // strategy name registered in the app
  @RequireScopes('read:profile')
  async getProfile(_: never, ctx: RequestContext) {
    return { user: ctx.principal };
  }
}
```

### Register providers (done once in your auth module)

```typescript
import { Module } from '@konekti/core';
import { createPassportProviders } from '@konekti/passport';

class BearerAuthStrategy {
  async authenticate() {
    return { claims: {}, subject: 'user-1' };
  }
}

@Module({
  providers: [
    BearerAuthStrategy,
    ...createPassportProviders({ defaultStrategy: 'jwt' }, [{ name: 'jwt', token: BearerAuthStrategy }]),
  ],
})
export class AuthModule {}
```

### Implement an AuthStrategy

```typescript
import type { AuthStrategy, GuardContext } from '@konekti/passport';
import { AuthenticationRequiredError } from '@konekti/passport';

export class ApiKeyStrategy implements AuthStrategy {
  async authenticate(context: GuardContext) {
    const apiKey = context.requestContext.request.headers['x-api-key'];
    if (!apiKey) {
      throw new AuthenticationRequiredError();
    }

    return {
      claims: { apiKey },
      scopes: ['read:profile'],
      subject: 'api-key-user',
    };
  }
}
```

### Bridge a Passport.js strategy

```typescript
import { Module } from '@konekti/core';
import { createPassportJsStrategyBridge, createPassportProviders } from '@konekti/passport';
import { LocalStrategyAdapter } from './local.strategy';

const localBridge = createPassportJsStrategyBridge('local', LocalStrategyAdapter, {
  authenticateOptions: { session: false },
  mapPrincipal: ({ user }) => ({
    subject: String((user as { id: string }).id),
    claims: user as Record<string, unknown>,
  }),
});

@Module({
  providers: [
    LocalStrategyAdapter,
    ...localBridge.providers,
    ...createPassportProviders({ defaultStrategy: 'local' }, [localBridge.strategy]),
  ],
})
export class AuthModule {}
```

## Key API

| Export | Location | Description |
|---|---|---|
| `AuthStrategy` | `src/types.ts` | Interface: `authenticate(context) → principal | handled result` |
| `AuthStrategyResult` | `src/types.ts` | `Principal` or `{ handled: true, principal? }` |
| `AuthGuard` | `src/guard.ts` | Generic guard that reads auth requirements and calls the strategy |
| `UseAuth(strategyName)` | `src/decorators.ts` | Sets the strategy + attaches `AuthGuard` to the route |
| `RequireScopes(...scopes)` | `src/decorators.ts` | Declares required scopes + attaches `AuthGuard` |
| `createPassportProviders(opts)` | `src/module.ts` | Registers strategy registry and default strategy wiring |
| `createPassportJsStrategyBridge(...)` | `src/passport-js.ts` | Wraps a Passport.js strategy as a Konekti `AuthStrategy` |
| `AuthRequirement` | `src/types.ts` | `{ strategy?, scopes? }` — merged from class + method level |
| `AccountLinkPolicy` | `src/account-linking.ts` | Extension contract: evaluate identity-linking decisions from app-provided candidate data |
| `resolveAccountLinking(...)` | `src/account-linking.ts` | Normalizes policy outcomes (`linked`, `create-account`, `skipped`) and throws typed conflict/reject errors |
| `createConservativeAccountLinkPolicy()` | `src/account-linking.ts` | Built-in baseline policy requiring explicit confirmation before linking non-explicit matches |
| `ACCOUNT_LINKING_POLICY` | `src/account-linking.ts` | DI token for wiring a policy implementation |
| `AccountLinkConflictError` | `src/account-linking.ts` | Thrown when one or more candidate matches require explicit link confirmation |
| `AccountLinkRejectedError` | `src/account-linking.ts` | Thrown when linking is denied by policy |
| `RefreshTokenService` | `src/refresh-token.ts` | Interface for refresh token lifecycle operations |
| `RefreshTokenStrategy` | `src/refresh-token.ts` | Auth strategy for refresh token authentication |
| `JwtRefreshTokenAdapter` | `src/jwt-refresh-token-adapter.ts` | Adapts `@konekti/jwt`'s `RefreshTokenService` to passport interface |
| `createRefreshTokenProviders(service)` | `src/refresh-token.ts` | Registers refresh token service in DI |
| `CookieAuthStrategy` | `src/cookie-auth.ts` | Auth strategy that extracts JWT from HttpOnly cookies |
| `CookieManager` | `src/cookie-manager.ts` | Utilities for setting/clearing auth cookies |
| `createCookieAuthPreset(config)` | `src/cookie-auth-module.ts` | Creates cookie auth providers and strategy registration |

## Architecture

### Guard execution flow

```text
request arrives at route with @UseAuth / @RequireScopes
  → AuthGuard.canActivate(context)
  → read merged auth requirement (class + method)
  → determine strategy name (explicit or default)
  → resolve strategy from request-scoped container
  → strategy.authenticate(context)
  → if the strategy throws auth errors → map to UnauthorizedException (401)
  → if authenticated → scope check
  → if scopes missing → throw ForbiddenException (403)
  → requestContext.principal = principal
```

### Why auth metadata uses merge semantics

`@UseAuth` and `@RequireScopes` can be applied at both the class level and the method level. The guard reads merged requirements: a class-level strategy with per-method scopes is a common pattern. The metadata layer in `src/metadata.ts` owns this merge logic.

### AuthGuard is provider-agnostic by design

`AuthGuard` never references JWT, Google, or any concrete provider. It only:
- Knows the strategy *name*
- Looks up the strategy *instance* from the DI container
- Calls `authenticate`
- Maps the result to `principal` or exception

This means adding a new auth strategy requires only implementing `AuthStrategy` and registering it — the guard does not change.

### Passport.js bridge

`createPassportJsStrategyBridge()` adapts Passport.js's `success`/`fail`/`redirect`/`error` callback protocol to Konekti's `AuthStrategyResult`. The `mapPrincipal` argument normalizes the passport user object to a Konekti `Principal` shape. The bridge does not own account upsert or JWT issuance — those remain in app service code. For identity linking, use `AccountLinkPolicy` + `resolveAccountLinking` as the framework contract boundary.

The public package also exports auth error classes, bridge types, metadata helpers, `AUTH_STRATEGY_REGISTRY`, and `PASSPORT_OPTIONS` from `src/index.ts`.

## File reading order for contributors

1. `src/types.ts` — `AuthStrategy`, `AuthStrategyResult`, `AuthRequirement`, `GuardContext`
2. `src/account-linking.ts` — account-linking contract, conservative policy baseline, conflict/reject semantics
3. `src/metadata.ts` — class + method requirement storage and merge
4. `src/decorators.ts` — `UseAuth`, `RequireScopes` — metadata write + `AuthGuard` attachment
5. `src/errors.ts` — auth-specific error types
6. `src/guard.ts` — `AuthGuard` — strategy lookup, authenticate, scope check, principal population
7. `src/refresh-token.ts` — `RefreshTokenService`, `RefreshTokenStrategy` — refresh token lifecycle primitives
8. `src/jwt-refresh-token-adapter.ts` — `JwtRefreshTokenAdapter` — bridges `@konekti/jwt` to passport interface
9. `src/cookie-auth.ts` — `CookieAuthStrategy` — JWT extraction from HttpOnly cookies
10. `src/cookie-manager.ts` — `CookieManager` — cookie setting/clearing utilities
11. `src/cookie-auth-module.ts` — `createCookieAuthPreset` — cookie auth providers and strategy registration
12. `src/module.ts` — `createPassportProviders`
13. `src/passport-js.ts` — `createPassportJsStrategyBridge`
14. `src/account-linking.test.ts` — happy-path linking, conflict handling, non-linking fallback, explicit rejection flows
15. `src/guard.test.ts` — non-JWT strategy flow, 401/403 mapping, principal population, scope enforcement, Passport.js bridge paths
16. `src/refresh-token.test.ts` — refresh token lifecycle, rotation, replay detection, revocation
17. `src/cookie-auth.test.ts` — cookie auth strategy and cookie manager tests

## Related packages

- `@konekti/jwt` — token-core signer/verifier implementation
- `@konekti/http` — `AuthGuard` is a guard in the `@konekti/http` dispatcher's guard chain

## One-liner mental model

```text
@konekti/passport = strategy-agnostic auth execution: any AuthStrategy → AuthGuard → principal in RequestContext
                 + refresh token lifecycle: issue → rotate → revoke with replay detection        (framework-owned)
                 + cookie auth preset: HttpOnly cookie JWT extraction + cookie management        (framework-owned)
                 + account-linking policy contract: evaluate → resolve → conflict/reject semantics (framework-owned boundary)
                 + login flow, session store, consent, account upsert/merge implementation        (application-owned)
```
