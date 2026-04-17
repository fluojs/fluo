# Authentication and JWT

<p><strong><kbd>English</kbd></strong> <a href="./auth-and-jwt.ko.md"><kbd>한국어</kbd></a></p>

Authentication in fluo is built on a "strategy-agnostic" execution model. Instead of hardcoding auth logic into your routes, fluo separates identity verification from route protection, allowing your application to scale across multiple authentication methods and runtimes (Node.js, Bun, Deno) without changing your business logic.

## Why fluo's Approach?

- **Standard Decorators**: Use standard TC39 decorators like `@UseAuth()` and `@RequireScopes()` for a clean, metadata-driven security posture.
- **Principal Normalization**: Whether you use JWT, Session Cookies, or API Keys, your application always interacts with a consistent `principal` object.
- **Multi-Runtime Safety**: The auth core is transport-agnostic, making it safe for HTTP, WebSockets, and even CLI-driven execution.
- **Explicit Scopes**: Built-in support for scope-based authorization (RBAC/Scopes) directly at the route level.

## Responsibility Split

- **`@fluojs/jwt` (The Core)**: Handles the "how" of tokens. It signs and verifies JWTs, manages claim normalization (e.g., merging `scope` and `scopes` claims), and handles refresh token rotation with replay detection.
- **`@fluojs/passport` (The Bridge)**: Handles the "who". It provides the `AuthStrategy` interface and a bridge to existing Passport.js strategies, routing them into the fluo request context.
- **`@fluojs/http` (The Orchestrator)**: Handles the "when". It executes the `AuthGuard` during the HTTP lifecycle, extracts credentials (headers/cookies), and populates `RequestContext.principal`.

## The Request Journey

1.  **Ingress**: A request hits a route decorated with `@UseAuth('jwt')`.
2.  **Guard Trigger**: The `AuthGuard` identifies the 'jwt' strategy from the DI container.
3.  **Extraction**: The strategy extracts the Bearer token from the `Authorization` header.
4.  **Verification**: `@fluojs/jwt` verifies the signature, issuer, and audience using keys managed by `@fluojs/config`.
5.  **Normalization**: Raw claims are mapped to a stable `JwtPrincipal` object.
6.  **Authorization**: If `@RequireScopes('admin')` is present, the guard verifies the principal has the required scope.
7.  **Injection**: The verified principal is attached to the context, accessible via `ctx.principal` in your controller.

## Code Examples

The following snippets demonstrate a standard JWT setup using the core fluo packages.

**Module Setup** (auth.module.ts):
```ts
import { Module } from '@fluojs/core';
 import { JwtModule } from '@fluojs/jwt';
import { createPassportProviders } from '@fluojs/passport';
import { AuthController, ProfileController } from './auth.controller';
import { AuthService } from './auth.service';
import { BearerJwtStrategy } from './bearer.strategy';

@Module({
  imports: [
    JwtModule.forRoot({
      accessTokenTtlSeconds: 3600,
      algorithms: ['HS256'],
      audience: 'fluo-auth-example-clients',
      issuer: 'fluo-auth-example',
      secret: 'fluo-auth-example-secret',
    }),
  ],
  controllers: [AuthController, ProfileController],
  providers: [
    AuthService,
    BearerJwtStrategy,
    ...createPassportProviders(
      { defaultStrategy: 'jwt' },
      [{ name: 'jwt', token: BearerJwtStrategy }],
    ),
  ],
})
export class AuthModule {}
```
The module configuration uses `JwtModule.forRoot(...)` as the canonical JWT entrypoint and keeps `createPassportProviders(...)` for Passport strategy integration.

**Token Issuance** (auth.service.ts):
```ts
import { Inject } from '@fluojs/core';
import { DefaultJwtSigner } from '@fluojs/jwt';

@Inject(DefaultJwtSigner)
export class AuthService {
  constructor(private readonly signer: DefaultJwtSigner) {}

  async issueToken(username: string): Promise<{ accessToken: string }> {
    const accessToken = await this.signer.signAccessToken({
      sub: username,
      roles: ['user'],
      scopes: ['profile:read'],
    });
    return { accessToken };
  }
}
```
The service leverages the `DefaultJwtSigner` to generate a signed access token containing the user identity and granted scopes.

**Protected Route** (auth.controller.ts):
```ts
import { Inject } from '@fluojs/core';
import { Controller, Get, Post, RequestDto, type RequestContext } from '@fluojs/http';
import { RequireScopes, UseAuth } from '@fluojs/passport';
import { LoginDto } from './login.dto';
import { AuthService } from './auth.service';

@Inject(AuthService)
@Controller('/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/token')
  @RequestDto(LoginDto)
  issueToken(dto: LoginDto) {
    return this.authService.issueToken(dto.username);
  }
}

@Controller('/profile')
export class ProfileController {
  @Get('/')
  @UseAuth('jwt')
  @RequireScopes('profile:read')
  getProfile(_input: undefined, ctx: RequestContext) {
    return { user: ctx.principal };
  }
}
```
Controllers use standard decorators to define endpoints and enforce security constraints such as specific authentication strategies and required scopes.

**Strategy Implementation** (bearer.strategy.ts):
```ts
import { Inject } from '@fluojs/core';
import type { GuardContext } from '@fluojs/http';
import { DefaultJwtVerifier } from '@fluojs/jwt';
import { AuthenticationFailedError, AuthenticationRequiredError, type AuthStrategy } from '@fluojs/passport';

@Inject(DefaultJwtVerifier)
export class BearerJwtStrategy implements AuthStrategy {
  constructor(private readonly verifier: DefaultJwtVerifier) {}

  async authenticate(context: GuardContext) {
    const authorization = context.requestContext.request.headers.authorization;
    if (typeof authorization !== 'string') {
      throw new AuthenticationRequiredError('Authorization header is required.');
    }
    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationFailedError('Must use Bearer token format.');
    }
    return await this.verifier.verifyAccessToken(token);
  }
}
```
The custom strategy manually extracts the token from the request headers and delegates the verification process to the `DefaultJwtVerifier`.

## Practical Framing: Refresh Token Rotation

fluo provides a built-in `RefreshTokenService` that implements **One-Time-Use Rotation**. When a user refreshes their session:
- The old refresh token is invalidated.
- A new access/refresh token pair is issued.
- If an old refresh token is reused (Replay Attack), the entire token family can be revoked automatically, protecting your users from stolen credentials.

For application module registration, treat `JwtModule.forRoot(...)` and `JwtModule.forRootAsync(...)` as the canonical `@fluojs/jwt` entrypoints.

## Next Steps

- **Quick Start**: issuance and verification in the [Auth JWT Passport Example](../../examples/auth-jwt-passport/README.md).
- **Real-World**: See a complete login flow in the [RealWorld API Example](../../examples/realworld-api/README.md).
- **Deep Dive**: Explore the [JWT Package](../../packages/jwt/README.md) and [Passport Package](../../packages/passport/README.md).
