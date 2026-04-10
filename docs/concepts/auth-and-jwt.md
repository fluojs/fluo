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

## Practical Framing: Refresh Token Rotation

fluo provides a built-in `RefreshTokenService` that implements **One-Time-Use Rotation**. When a user refreshes their session:
- The old refresh token is invalidated.
- A new access/refresh token pair is issued.
- If an old refresh token is reused (Replay Attack), the entire token family can be revoked automatically, protecting your users from stolen credentials.

## Next Steps

- **Quick Start**: issuance and verification in the [Auth JWT Passport Example](../../examples/auth-jwt-passport/README.md).
- **Real-World**: See a complete login flow in the [RealWorld API Example](../../examples/realworld-api/README.md).
- **Deep Dive**: Explore the [JWT Package](../../packages/jwt/README.md) and [Passport Package](../../packages/passport/README.md).
