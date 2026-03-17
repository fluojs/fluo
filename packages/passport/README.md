# @konekti/passport

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Strategy-agnostic auth execution layer for Konekti — routes any `AuthStrategy` through a generic `AuthGuard` into the request context.

The current official docs/examples path uses bearer-token JWT auth as the recommended preset. Cookie-based auth, refresh-token policy, and account-linking policy remain application-level concerns today.

## See also

- `../../docs/concepts/auth-and-jwt.md`
- `../../docs/concepts/http-runtime.md`

## What this package does

`@konekti/passport` does not implement any concrete auth provider (JWT parsing, Google OAuth, local credentials). Its job is to ensure that *whatever strategy you plug in*, auth runs consistently in the Konekti request lifecycle:

1. `UseAuth('<strategy>')` and `RequireScopes(...)` decorators write auth metadata and attach `AuthGuard` to the route
2. At request time, `AuthGuard` reads the requirement, looks up the strategy by name, calls `strategy.authenticate(context)`, gets a principal, checks scopes, and populates `requestContext.principal`
3. Auth errors map to `UnauthorizedException` (401) or `ForbiddenException` (403)
4. Passport.js strategies can be bridged in via `createPassportJsStrategyBridge()`

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
import { JwtStrategy } from '@konekti/jwt';

@Module({
  providers: [
    JwtStrategy,
    ...createPassportProviders({ defaultStrategy: 'jwt' }, [{ name: 'jwt', token: JwtStrategy }]),
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

`createPassportJsStrategyBridge()` adapts Passport.js's `success`/`fail`/`redirect`/`error` callback protocol to Konekti's `AuthStrategyResult`. The `mapPrincipal` argument normalizes the passport user object to a Konekti `Principal` shape. The bridge does not own account upsert or JWT issuance — those remain in app service code.

The public package also exports auth error classes, bridge types, metadata helpers, `AUTH_STRATEGY_REGISTRY`, and `PASSPORT_OPTIONS` from `src/index.ts`.

## File reading order for contributors

1. `src/types.ts` — `AuthStrategy`, `AuthStrategyResult`, `AuthRequirement`, `GuardContext`
2. `src/metadata.ts` — class + method requirement storage and merge
3. `src/decorators.ts` — `UseAuth`, `RequireScopes` — metadata write + `AuthGuard` attachment
4. `src/errors.ts` — auth-specific error types
5. `src/guard.ts` — `AuthGuard` — strategy lookup, authenticate, scope check, principal population
6. `src/module.ts` — `createPassportProviders`
7. `src/passport-js.ts` — `createPassportJsStrategyBridge`
8. `src/guard.test.ts` — non-JWT strategy flow, 401/403 mapping, principal population, scope enforcement, Passport.js bridge paths

## Related packages

- `@konekti/jwt` — exports `JwtStrategy` plus the token-core signer/verifier implementation
- `@konekti/http` — `AuthGuard` is a guard in the `@konekti/http` dispatcher's guard chain

## One-liner mental model

```text
@konekti/passport = strategy-agnostic auth execution: any AuthStrategy → AuthGuard → principal in RequestContext
```
