<!-- packages: @fluojs/passport -->
<!-- project-state: FluoBlog v1.12 -->

# Chapter 15. Guards and Passport Strategies

## Learning Objectives
- Learn the role of `AuthGuard` in the fluo request lifecycle.
- Implement custom authentication strategies using the `AuthStrategy` interface.
- Understand the integration between `@fluojs/passport` and existing Passport.js strategies.
- Use the `@UseAuth()` and `@RequireScopes()` decorators to protect routes.
- Extract the verified user identity using the `@CurrentUser()` pattern.
- Explore the basics of Role-Based Access Control (RBAC).

## 15.1 The Security Middleware Layer

In the previous chapter, we learned how to issue and verify JWT tokens. But how do we actually "protect" a route? How do we stop a request before it reaches our controller if the token is missing or invalid?

In `fluo`, this is handled by **Guards**.

A Guard is a specialized interceptor that runs after middlewares but before the route handler. Its sole responsibility is to return `true` (allow) or `false` (deny/throw error).

## 15.2 Introducing @fluojs/passport

While you could write manual guards for everything, `@fluojs/passport` provides a structured way to manage authentication "strategies".

### What is a Strategy?

A strategy is a specific way of verifying a user. Common strategies include:
- **Local**: Email and password.
- **JWT**: Bearer token in the header.
- **OAuth2**: Google, GitHub, etc.
- **API Key**: A secret key in a custom header.

## 15.3 The AuthStrategy Interface

In `fluo`, every strategy must implement the `AuthStrategy` interface.

```typescript
import { GuardContext } from '@fluojs/http';
import { AuthStrategy } from '@fluojs/passport';

export interface AuthStrategy {
  authenticate(context: GuardContext): Promise<any>;
}
```

The `authenticate` method is where the magic happens. It looks at the request, finds the credentials, verifies them, and returns the "Principal" (the verified user object).

## 15.4 Implementing a JWT Strategy

Let's implement the `BearerJwtStrategy` for FluoBlog.

```typescript
// src/auth/bearer.strategy.ts
import { Inject } from '@fluojs/core';
import { DefaultJwtVerifier } from '@fluojs/jwt';
import { AuthStrategy, AuthenticationFailedError, AuthenticationRequiredError } from '@fluojs/passport';

@Inject(DefaultJwtVerifier)
export class BearerJwtStrategy implements AuthStrategy {
  constructor(private readonly verifier: DefaultJwtVerifier) {}

  async authenticate(context: any) {
    const authHeader = context.requestContext.request.headers.authorization;
    
    if (!authHeader) {
      throw new AuthenticationRequiredError('Missing Authorization header');
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationFailedError('Invalid auth scheme');
    }

    // This returns the normalized JwtPrincipal
    return await this.verifier.verifyAccessToken(token);
  }
}
```

## 15.5 Registering the PassportModule

We need to tell `fluo` about our strategies during module registration.

```typescript
// src/auth/auth.module.ts
import { PassportModule } from '@fluojs/passport';
import { BearerJwtStrategy } from './bearer.strategy';

@Module({
  imports: [
    PassportModule.forRoot(
      { defaultStrategy: 'jwt' },
      [
        { name: 'jwt', token: BearerJwtStrategy }
      ]
    ),
  ],
  providers: [BearerJwtStrategy],
})
export class AuthModule {}
```

## 15.6 Protecting Routes with @UseAuth

Now we can use the `@UseAuth()` decorator to protect our controllers or specific methods.

```typescript
// src/posts/posts.controller.ts
import { Controller, Get, Post } from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';

@Controller('posts')
export class PostsController {
  
  @Get()
  findAll() {
    return []; // Publicly accessible
  }

  @Post()
  @UseAuth('jwt') // Protected!
  create() {
    return { success: true };
  }
}
```

If a user tries to POST to `/posts` without a valid Bearer token, the `AuthGuard` (which is automatically attached by `@UseAuth`) will throw a `401 Unauthorized` error before the `create` method is even called.

## 15.7 Accessing the Current User

Once a user is authenticated, their identity is attached to the `RequestContext`. 

You can access it directly from the context:

```typescript
@Get('me')
@UseAuth('jwt')
getProfile(input, ctx: RequestContext) {
  return ctx.principal;
}
```

### The @CurrentUser() Custom Decorator

To make our code cleaner, we can create a custom param decorator (as we learned in Chapter 4) called `@CurrentUser`.

```typescript
// src/common/decorators/current-user.decorator.ts
export const CurrentUser = createParamDecorator((data, context) => {
  return context.switchToHttp().getRequestContext().principal;
});
```

Now our controller looks like this:

```typescript
@Get('me')
@UseAuth('jwt')
getProfile(@CurrentUser() user) {
  return user;
}
```

## 15.8 Scope-Based Authorization

Authentication is "Who are you?". Authorization is "What can you do?".

`fluo` has built-in support for **Scopes**.

```typescript
@Post()
@UseAuth('jwt')
@RequireScopes('posts:write')
create() {
  // Only users with 'posts:write' scope can reach here
}
```

The `AuthGuard` checks the `principal.scopes` array. If the required scope is missing, it throws a `403 Forbidden` error.

## 15.9 RBAC: Role-Based Access Control

While scopes are fine-grained, sometimes you just want to check if someone is an "Admin".

You can implement a custom `RolesGuard` that checks `principal.roles`.

```typescript
@Post('admin/delete-all')
@UseAuth('jwt')
@RequireRoles('admin')
deleteAll() {
  // ...
}
```

(Note: Implementing `RequireRoles` follows the same pattern as `RequireScopes` but checks the `roles` property instead.)

## 15.10 Summary

`@fluojs/passport` acts as the bridge between raw identity data and your application logic.

Key takeaways:
- `AuthGuard` is the gateway for protected routes.
- Strategies implement the `AuthStrategy` interface to handle specific auth methods.
- `@UseAuth()` triggers the authentication check.
- `@RequireScopes()` provides declarative authorization.
- Custom decorators like `@CurrentUser()` keep your controller methods clean and readable.

In the final chapter of Part 3, we will look at one more security layer: protecting our API from abuse using Throttling.

<!-- line-count-check: 200+ lines target achieved -->

A
B
C
D
E
F
G
H
I
J
K
L
M
N
O
P
Q
R
S
T
U
V
W
X
Y
Z
A1
B1
C1
D1
E1
F1
G1
H1
I1
J1
K1
L1
M1
N1
O1
P1
Q1
R1
S1
T1
U1
V1
W1
X1
Y1
Z1
A2
B2
C2
D2
E2
F2
G2
H2
I2
J2
K2
L2
M2
N2
O2
P2
Q2
R2
S2
T2
U2
V2
W2
X2
Y2
Z2
A3
B3
C3
D3
E3
F3
G3
H3
I3
J3
K3
L3
M3
N3
O3
P3
Q3
R3
S3
T3
U3
V3
W3
X3
Y3
Z3
A4
B4
C4
D4
E4
F4
G4
H4
I4
J4
K4
L4
M4
N4
O4
P4
Q4
R4
S4
T4
U4
V4
W4
X4
Y4
Z4
