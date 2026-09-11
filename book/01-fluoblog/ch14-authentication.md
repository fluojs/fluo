# Verifying Login State

<!-- book:volume=01-fluoblog;chapter=14 -->

[Previous: Modeling Users and Credentials](./ch13-accounts-and-credentials.md) | [Volume 1 Contents](./toc.md) | [Next: Who Can Edit This Post?](./ch15-authorization.md)

## Carrying a Successful Password Check Across Requests

We try the first editing screen now that FluoBlog has contributor accounts. The login button checks the password and reports success, but the next request to save a post contains nothing that identifies the user. We make the browser send a `userId`, only to find that the server accepts it even when we change it to another account's ID. The ID created during registration is not a secret, so it cannot prove identity. We need a format that distinguishes a login result verified by the server from a user ID asserted by the client.

In this chapter, we issue short-lived, signed access tokens. Passwords are sent only to `POST /auth/login`; protected requests send the token as `Authorization: Bearer <token>`. `@fluojs/jwt` handles signature and claim verification. `@fluojs/passport` extracts credentials from an HTTP request, runs an authentication strategy, and creates `RequestContext.principal`. The former is the boundary for the data format and cryptographic verification; the latter is the boundary for request execution. Neither package automatically discovers whether an account in our database has been suspended.

We keep using the previous chapter's `AccountsModule`, `AccountsService`, `PasswordHasher`, and Prisma schema. Here, `subject` and the JWT `sub` are `User.id`. A post's `authorId` and the `customerId` of orders added later use the same user ID. Switching to token authentication does not reissue a person's identifier. The files below are implementations to add under your `fluo-blog/src/auth/`; they do not imply that the repository provides a separate, complete application at this stage.

## What Belongs in a Token, and What Does Not

JWT does not encrypt the payload. Anyone holding a token can read its payload. Therefore, do not include password hashes, email addresses, or internal operational notes. This product needs the user ID `sub`, the issuer `iss`, the target service `aud`, issuance and expiration times, server-defined `scopes`, and the account's authentication generation, `authVersion`. Copying and signing `roles`, `scopes`, or `sub` sent by the browser would have the server endorse an attacker's assertions.

Access tokens remain valid for 900 seconds. This is a product setting that balances the inconvenience of logging in again against the time a leaked token can be used. A longer lifetime shows the login screen less often but makes revocation policy more important. With a fully stateless approach that checks only the token, existing tokens remain valid until expiration even after a password change or account suspension. FluoBlog needs to suspend writing accounts promptly, so we choose to check the current account state on every request.

If FluoBlog later adds session renewal, it follows one path: configure the refresh secret, lifetime, rotation, and atomic store in `JwtModule.forRoot({ global: true, refreshToken: ... })`; register `RefreshTokenModule.forRoot()`; and expose the exchange through `@UseAuth('refresh-token')`. Passport does not create another refresh service or store. That endpoint reads `body.refreshToken` before a bearer header, rejects a malformed body value rather than falling back, and maps missing, invalid/reused, and expired credentials to its documented authentication errors. This chapter intentionally keeps the shorter access-token-only product flow above.

The following is the **complete file `src/auth/jwt-options.ts`**. Reading environment values belongs at the application configuration boundary. If you managed values through a configuration object in Chapter 9, move the same validation to that boundary; do not make JWT providers or request handlers read environment variables every time. Inject the key through external configuration so restarting the development server uses the same key.

```ts
import type { JwtVerifierOptions } from '@fluojs/jwt';

export const ACCESS_TOKEN_TTL_SECONDS = 900;

const secret = process.env.JWT_SECRET;
if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/i.test(secret)) {
  throw new Error('JWT_SECRET must contain 64 hexadecimal characters.');
}

export const jwtOptions: JwtVerifierOptions = {
  algorithms: ['HS256'],
  secret,
  issuer: 'fluo-blog',
  audience: 'fluo-blog-web',
  accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  requireExp: true,
  clockSkewSeconds: 0,
};
```

Prepare the key as 32 bytes of cryptographically secure randomness expressed as a 64-character hexadecimal string. A repeating string that merely matches the regular expression passes only the length check. Do not put environment files in the repository. The following command can generate a development value; do not record its actual output or a production key in the book.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The server fixes the allowed algorithm to `HS256` alone, so the token header cannot arbitrarily choose the verification method. A token with a different `issuer` or `audience` is rejected even if it uses the same key. A deployment with clock differences can allow some leeway, but `clockSkewSeconds` expands the actual acceptance period. Synchronize host clocks before reaching for a large number. There is also a concrete reason Node.js 24 is the execution baseline here. Signing and verification in the current JWT package require Node-compatible `node:crypto` operations; a safe root import does not mean signing works on every host.

## The Login Service Issues Identity, Not Ownership

The following is the **complete file `src/auth/auth.service.ts`**. It delegates hash comparison to the previous chapter's service and creates a token only for a successfully verified account. During login, `AccountInputError` becomes a generic unauthenticated response so nonexistent emails, incorrect passwords, and suspended accounts do not receive different explanations. Database connection failures and incorrect JWT settings are not caught by this branch.

```ts
import { Inject } from '@fluojs/core';
import { UnauthorizedException } from '@fluojs/http';
import { JwtService } from '@fluojs/jwt';
import { AccountInputError } from '../accounts/account-input.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './jwt-options.js';

export type LoginResult = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: string; displayName: string };
};

@Inject(AccountsService, JwtService)
export class AuthService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly jwt: JwtService,
  ) {}

  async login(input: { email: unknown; password: unknown }): Promise<LoginResult> {
    let account;
    try {
      account = await this.accounts.verifyPassword(input.email, input.password);
    } catch (error: unknown) {
      if (error instanceof AccountInputError) {
        throw new UnauthorizedException('Invalid login credentials.');
      }
      throw error;
    }
    if (!account) {
      throw new UnauthorizedException('Invalid login credentials.');
    }
    const accessToken = await this.jwt.sign({
      sub: account.id,
      authVersion: account.authVersion,
      scopes: ['posts:write'],
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: { id: account.id, displayName: account.displayName },
    };
  }
}
```

The exact successful result of `AuthService.login` is `LoginResult`. `accessToken` is a JWT string, `tokenType` is always `Bearer`, `expiresIn` is 900 seconds in this configuration, and `user` contains only `id` and `displayName`. Other transports receive this same result and decide only how to deliver it. `AuthModule` exports `AuthService` and `BlogTokenAuthenticator`, so do not register a separate signer or account verifier.

Here, every active account may write its own posts. Possessing `posts:write` does not grant permission to edit someone else's post. The next chapter's resource policy makes that decision. If we later introduce a read-only account tier, the scope list must be computed from account policy, and permission changes must also update the authentication generation of existing tokens. A one-line conditional in login code cannot solve the problem of token permissions outliving their database state.

A password can change between the account lookup and token signing. The service signs the `authVersion` read during password verification, so if the generation increases afterward, even a just-issued token is rejected at the next authentication check. Receiving a success response does not guarantee that every subsequent request will succeed. Design the client to clear its local token and reauthenticate on a 401. There is no need to wrap the account change and token issuance in one long database transaction.

## Check the Current Account After Verifying the Signature

Signature, claim, and current-account verification are gathered in the transport-independent **complete file `src/auth/blog-token-authenticator.ts`**. `authenticateToken(token)` returns a verified `JwtPrincipal`. Signature, issuer, audience, and expiration use the same `JwtService` and `jwtOptions`; the current-account and `authVersion` checks also pass through this boundary. Expiration, forgery, and suspension propagate as Passport authentication errors; configuration and database failures propagate as their original errors.

```ts
import { Inject } from '@fluojs/core';
import {
  JwtService, JwtExpiredTokenError, JwtInvalidTokenError, type JwtPrincipal,
} from '@fluojs/jwt';
import { AuthenticationExpiredError, AuthenticationFailedError } from '@fluojs/passport';
import { AccountsService } from '../accounts/accounts.service.js';

@Inject(JwtService, AccountsService)
export class BlogTokenAuthenticator {
  constructor(
    private readonly jwt: JwtService,
    private readonly accounts: Pick<AccountsService, 'findActiveSubject'>,
  ) {}

  async authenticateToken(token: string): Promise<JwtPrincipal> {
    let principal: JwtPrincipal;
    try {
      principal = await this.jwt.verify(token);
    } catch (error: unknown) {
      if (error instanceof JwtExpiredTokenError) {
        throw new AuthenticationExpiredError('Access token has expired.', { cause: error });
      }
      if (error instanceof JwtInvalidTokenError) {
        throw new AuthenticationFailedError('Access token verification failed.', { cause: error });
      }
      throw error;
    }
    const generation = principal.claims.authVersion;
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) {
      throw new AuthenticationFailedError('The login is no longer valid.');
    }
    const account = await this.accounts.findActiveSubject(principal.subject);
    if (!account || account.authVersion !== generation) {
      throw new AuthenticationFailedError('The login is no longer valid.');
    }
    return principal;
  }
}
```

The **complete `src/auth/blog-jwt.strategy.ts`** owns only bearer extraction and challenge headers, delegating to the authenticator above. Its extraction syntax and use of the first entry in an array-valued header match the built-in bearer contract. Other transports can call the same authenticator after obtaining a token string, but this function does not also provide cookie Origin and scope protection.

```ts
import { Inject } from '@fluojs/core';
import { getRequestHeader, type GuardContext } from '@fluojs/http';
import {
  AuthenticationExpiredError, AuthenticationFailedError, AuthenticationRequiredError,
  type AuthStrategy, type AuthStrategyResult,
} from '@fluojs/passport';
import { BlogTokenAuthenticator } from './blog-token-authenticator.js';

@Inject(BlogTokenAuthenticator)
export class BlogJwtStrategy implements AuthStrategy {
  constructor(private readonly tokens: BlogTokenAuthenticator) {}

  async authenticate(context: GuardContext): Promise<AuthStrategyResult> {
    const header = getRequestHeader(context.requestContext.request, 'Authorization');
    const authorization = Array.isArray(header) ? header[0] : header;
    if (typeof authorization !== 'string' || authorization.length === 0) {
      context.requestContext.response.setHeader('WWW-Authenticate', 'Bearer');
      throw new AuthenticationRequiredError('Authorization header is required.');
    }
    const token = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization)?.[1];
    if (!token) {
      context.requestContext.response.setHeader('WWW-Authenticate', 'Bearer');
      throw new AuthenticationFailedError('Authorization header must use Bearer token format.');
    }
    try {
      return await this.tokens.authenticateToken(token);
    } catch (error: unknown) {
      if (error instanceof AuthenticationExpiredError || error instanceof AuthenticationFailedError) {
        context.requestContext.response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      }
      throw error;
    }
  }
}
```

Do not read `sub` from the payload to look up a user or grant permissions before verifying the JWT signature. `JwtService.decode()` is a decoder that checks neither signature, expiration, nor issuer. Here, a principal emerges only after the shared authenticator successfully verifies the signature. We still check the type of `authVersion` because a cryptographically valid token does not necessarily contain every claim the application requires in the correct form. An older application version or a different issuance path can create incorrect claims using the same key.

This strategy does not permit authentication when the database is down. It also does not wrap database errors in `AuthenticationFailedError`, which would make an operational outage look like a user's password mistake. Passport's `AuthGuard` maps authentication-related errors to 401 and passes unknown infrastructure errors to the original error-handling path. Keeping connection strings out of HTTP error responses and classifying errors in operational logs are separate responsibilities.

Like the built-in contract, this bearer strategy sets `WWW-Authenticate: Bearer` for a missing header and `Bearer error="invalid_token"` for an invalid or expired token. Reading only the first entry when a header array is supplied is the current contract. The proxy and server must therefore agree at the deployment boundary on how to handle duplicate Authorization headers. The application must not reread the last entry and use credentials different from those used by the earlier strategy.

## Connect the HTTP Boundary and DI Graph End to End

The following is the **complete file `src/auth/auth.controller.ts`**. It combines `unknown` input with service validation rather than assuming an external value is already valid because of a DTO field type. A binding error for a required body field is 400; failed login credential verification is 401. Duplicate registration is distinguished with 409. This public registration API follows a policy that reveals duplication to some extent. A product that must conceal account existence needs a different registration-response design, including email verification.

```ts
import { Inject } from '@fluojs/core';
import {
  BadRequestException,
  ConflictException,
  Controller,
  FromBody,
  Get,
  Header,
  HttpCode,
  Post,
  RequestDto,
  UnauthorizedException,
  type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import {
  AccountConflictError,
  AccountInputError,
} from '../accounts/account-input.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuthService } from './auth.service.js';

class LoginInput {
  @FromBody() email: unknown = '';
  @FromBody() password: unknown = '';
}

class RegisterInput {
  @FromBody() email: unknown = '';
  @FromBody() password: unknown = '';
  @FromBody() displayName: unknown = '';
}

@Controller('/auth')
@Inject(AuthService, AccountsService)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountsService,
  ) {}

  @Post('/login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequestDto(LoginInput)
  login(input: LoginInput) {
    return this.auth.login(input);
  }

  @Post('/register')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequestDto(RegisterInput)
  async register(input: RegisterInput) {
    try {
      return await this.accounts.register(input);
    } catch (error: unknown) {
      if (error instanceof AccountInputError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof AccountConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Get('/me')
  @UseAuth('blog-jwt')
  @Header('Cache-Control', 'no-store')
  me(_input: unknown, context: RequestContext) {
    const principal = context.principal;
    if (!principal) throw new UnauthorizedException();
    return { id: principal.subject };
  }
}
```

The token in a login response is a secret deliberately delivered to the client as an exception. Do not enable response-body logging or send login responses to analytics tools. `no-store` prohibits caching successful responses; it does not replace log masking. Check error responses and any separate proxy caching rules as well. `/auth/me` exposes only the required ID rather than returning the entire principal.

The following is the **complete file `src/auth/auth.module.ts`**. It makes registration names, class tokens, and visibility readable together. The global setting on `PassportModule` lets routes in other feature modules resolve `AuthGuard`, but it does not automatically provide strategy classes globally. `PostsModule` imports this `AuthModule` to gain visibility of the exported `BlogJwtStrategy`.

```ts
import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import { PassportModule } from '@fluojs/passport';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { BlogJwtStrategy } from './blog-jwt.strategy.js';
import { BlogTokenAuthenticator } from './blog-token-authenticator.js';
import { jwtOptions } from './jwt-options.js';

@Module({
  imports: [
    AccountsModule,
    JwtModule.forRoot(jwtOptions),
    PassportModule.forRoot(
      { defaultStrategy: 'blog-jwt', global: true },
      [{ name: 'blog-jwt', token: BlogJwtStrategy }],
    ),
  ],
  providers: [BlogTokenAuthenticator, BlogJwtStrategy, AuthService],
  controllers: [AuthController],
  exports: [BlogJwtStrategy, BlogTokenAuthenticator, AuthService],
})
export class AuthModule {}
```

Import `AuthModule` in `src/app.ts` and add it to the existing `AppModule.imports`. Keep Prisma as the single asynchronous global registration in the `BlogDatabaseModule` created in Chapter 10. Within this module, `BlogTokenAuthenticator` can see `JwtService` from the imported `JwtModule` and the service from `AccountsModule`; `BlogJwtStrategy` delegates to that authenticator. `AuthService` uses the same account module. The token order in standard class-level `@Inject` matches the constructor parameter order. Do not try to compensate for missing registration by enabling `experimentalDecorators` or `emitDecoratorMetadata`.

## Test Expiration, Forgery, and Suspension as Distinct Failures

Signature verification can be tested with real JWT operations. The following is the **complete file `src/auth/jwt-policy.test.ts`**. It uses only a test key and fixes `Date.now` to reach the expiration boundary exactly. It does not wait 15 minutes or hope that a request happens to succeed just before expiration. This test covers only the token-verification boundary; it does not claim to verify the HTTP strategy or PostgreSQL.

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  DefaultJwtSigner,
  DefaultJwtVerifier,
  JwtExpiredTokenError,
  JwtInvalidTokenError,
  type JwtVerifierOptions,
} from '@fluojs/jwt';

describe('blog access token policy', () => {
  it('checks subject, audience, signature, and the exact expiration boundary', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const options: JwtVerifierOptions = {
      algorithms: ['HS256'],
      secret: 'test-only-key-not-for-production',
      issuer: 'fluo-blog',
      audience: 'fluo-blog-web',
      accessTokenTtlSeconds: 900,
      requireExp: true,
      clockSkewSeconds: 0,
    };
    const signer = new DefaultJwtSigner(options);
    const verifier = new DefaultJwtVerifier(options);
    const otherAudience = new DefaultJwtVerifier({
      ...options,
      audience: 'another-client',
    });
    try {
      const token = await signer.signAccessToken({
        sub: 'reader-1',
        authVersion: 1,
        scopes: ['posts:write'],
      });
      expect((await verifier.verifyAccessToken(token)).subject).toBe('reader-1');
      await expect(otherAudience.verifyAccessToken(token))
        .rejects.toBeInstanceOf(JwtInvalidTokenError);
      const [header, , signature] = token.split('.');
      const forgedPayload = Buffer.from(JSON.stringify({
        sub: 'another-reader',
        exp: 1_800_000_900,
      })).toString('base64url');
      await expect(verifier.verifyAccessToken(`${header}.${forgedPayload}.${signature}`))
        .rejects.toBeInstanceOf(JwtInvalidTokenError);
      clock.mockReturnValue(1_800_000_900_000);
      await expect(verifier.verifyAccessToken(token))
        .rejects.toBeInstanceOf(JwtExpiredTokenError);
    } finally {
      clock.mockRestore();
      verifier.dispose();
      otherAudience.dispose();
    }
  });
});
```

```bash
pnpm exec vitest run src/auth/jwt-policy.test.ts
```

Check the shared authenticator for regressions with the **complete `src/auth/blog-token-authenticator.test.ts`**. It uses the actual signer and verifier, replacing only account lookup with a narrow boundary whose state we can control. This is therefore not a database integration experiment.

```ts
import { describe, expect, it, vi } from 'vitest';
import { DefaultJwtSigner, DefaultJwtVerifier, JwtService, type JwtVerifierOptions } from '@fluojs/jwt';
import { AuthenticationExpiredError, AuthenticationFailedError } from '@fluojs/passport';
import { BlogTokenAuthenticator } from './blog-token-authenticator.js';

const options: JwtVerifierOptions = {
  algorithms: ['HS256'], secret: 'test-only-key-not-for-production',
  issuer: 'fluo-blog', audience: 'fluo-blog-web',
  accessTokenTtlSeconds: 900, requireExp: true, clockSkewSeconds: 0,
};

describe('shared blog token authentication', () => {
  it('keeps signature, expiration, current account, and authVersion in one path', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const signer = new DefaultJwtSigner(options);
    const verifier = new DefaultJwtVerifier(options);
    let active = true;
    let generation = 1;
    let lookupFailure: Error | undefined;
    const accounts = {
      async findActiveSubject(id: string) {
        if (lookupFailure) throw lookupFailure;
        return active && id === 'account-a'
          ? { id, displayName: 'Writer', authVersion: generation }
          : null;
      },
    };
    const jwt = new JwtService(options, signer, verifier);
    const authenticator = new BlogTokenAuthenticator(jwt, accounts);
    try {
      const token = await signer.signAccessToken({
        sub: 'account-a', authVersion: 1, scopes: ['posts:write'],
      });
      expect(await authenticator.authenticateToken(token)).toMatchObject({
        subject: 'account-a', scopes: ['posts:write'],
      });
      generation = 2;
      await expect(authenticator.authenticateToken(token)).rejects.toBeInstanceOf(AuthenticationFailedError);
      generation = 1;
      active = false;
      await expect(authenticator.authenticateToken(token)).rejects.toBeInstanceOf(AuthenticationFailedError);
      active = true;
      const [header, , signature] = token.split('.');
      const payload = Buffer.from(JSON.stringify({ sub: 'account-b', exp: 1_800_000_900 })).toString('base64url');
      await expect(authenticator.authenticateToken(header + '.' + payload + '.' + signature))
        .rejects.toBeInstanceOf(AuthenticationFailedError);
      lookupFailure = new Error('Database unavailable');
      await expect(authenticator.authenticateToken(token)).rejects.toBe(lookupFailure);
      lookupFailure = undefined;
      clock.mockReturnValue(1_800_000_900_000);
      await expect(authenticator.authenticateToken(token)).rejects.toBeInstanceOf(AuthenticationExpiredError);
    } finally {
      verifier.dispose();
      clock.mockRestore();
    }
  });
});
```

```bash
pnpm exec vitest run src/auth/blog-token-authenticator.test.ts
```

The HTTP integration experiment requires a migrated development PostgreSQL database, a configured `JWT_SECRET`, and the application running on Node.js 24. Create `writer@example.test` through `POST /auth/register` and check for 201 and the public account information. Calling `POST /auth/login` with the same credentials should return 200, an `accessToken`, and `expiresIn: 900`. Put the returned token in the Authorization header and call `/auth/me`; the ID should match the one returned at registration. Adding a different `userId` to the body must not change the response ID.

Next, omit the header or send the `Basic` scheme and check for 401 and a bearer challenge. Changing only the token payload while keeping the signature also yields 401. After succeeding with a valid token, increment that user's `authVersion` through a separate test database connection, wait for the commit to complete, and then send the same token. It must now return 401. Another user's token must still succeed, so do not pass the test by changing the shared key and logging everyone out. Use the same sequence for an experiment that changes the state to `disabled`.

Finally, introduce a test double at the account-lookup boundary that fails the database connection, and verify that the response does not turn into a password-error 401. Keep the actual application strategy, signer, and guard, replacing only the infrastructure boundary so the authentication integration still has an opportunity to fail. Also check that secrets appear in neither response errors nor access logs. The tests and database-connection experiments above were not run while writing this manuscript. Distinguish the contracts in the current package source from the reproduction procedures presented in the book.

## Understand the Remaining Responsibilities Before Extending Sessions

If the browser keeps a token only in memory, a page refresh may require another login. Persistent storage is more convenient but expands the exposure of tokens when a script-execution vulnerability exists. This chapter establishes the API's bearer contract; browser storage and screen flows are connected in Chapter 17. Switching to cookies takes more than adding HttpOnly. Since the browser automatically sends credentials, design SameSite, Secure, CSRF protection, and an explicit origin policy together.

It is also deliberate that we have not created refresh tokens yet. The current feature, which asks users to log in again after 15 minutes, is complete. Long-lived sessions require safe handling of raw tokens and implementation of reuse detection, rotation, and revocation as atomic storage operations. `RefreshTokenStore.rotate` in `@fluojs/jwt` is an extension point that consumes the old token and stores its successor as one operation, not a persistent database in itself. Attaching an in-memory store does not let us claim that sessions survive a server restart.

For the current client, logging out means deleting its stored access token. That is different from revoking an already copied token on the server. Use Chapter 13's `authVersion` increment policy for account-wide revocation, or choose a separate session model for per-device revocation. Do not hide this distinction in the API description or user interface.

We can now explain where a request's `principal.subject` comes from. But we have not yet decided whether a logged-in reader may edit another author's post. The next chapter combines verified identity with the actual post row and handles races between permission checking and saving.

## Evidence and Further Source Reading

- [JWT registration, key, claim, and runtime contracts](../../packages/jwt/README.md)
- [JWT public exports and types](../../packages/jwt/src/index.ts), [verification options](../../packages/jwt/src/types.ts)
- [Signing implementation](../../packages/jwt/src/signing/signer.ts), [time, issuer, and audience verification](../../packages/jwt/src/signing/verifier.ts)
- [Passport registration, strategy, and error-mapping contracts](../../packages/passport/README.md)
- [Passport public exports](../../packages/passport/src/index.ts), [bearer strategy](../../packages/passport/src/bearer/bearer-jwt.ts)
- [Authentication and scope-checking implementation](../../packages/passport/src/guard.ts), [failure-response tests](../../packages/passport/src/guard.test.ts)
- [HTTP exception status codes and response shapes](../../packages/http/src/exceptions.ts)

[Previous Chapter](./ch13-accounts-and-credentials.md) | [Volume 1 Contents](./toc.md) | [Next Chapter](./ch15-authorization.md)
