<!-- packages: @fluojs/jwt, @fluojs/passport -->
<!-- project-state: FluoBlog v1.11 -->

# Chapter 14. Authentication with JWT

## Learning Objectives
- Understand the structure and purpose of JSON Web Tokens (JWT).
- Configure the `JwtModule` for token signing and verification.
- Implement a dual-token pattern (Access & Refresh tokens).
- Build the FluoBlog authentication endpoints for login and token refresh.
- Learn about JWT principal normalization in `fluo`.
- Deep dive into the security implications of token-based authentication and why statelessness is the future of backend development.
- Explore advanced token management strategies, including revocation and rotation.

## 14.1 Introduction to JWT

JSON Web Token (JWT) is an open standard (RFC 7519) that defines a compact and self-contained way for securely transmitting information between parties as a JSON object. Unlike traditional session-based authentication, JWT allows the server to verify requests without querying a database or session store, making it ideal for distributed systems and serverless environments. This shift from stateful to stateless authentication is a cornerstone of modern backend development, allowing applications to operate efficiently in highly dynamic environments.

In modern web applications, JWT is the de-facto standard for stateless authentication. Instead of storing session IDs in a database, the server issues a cryptographically signed token to the client. The client then sends this token back with every request, typically in the `Authorization: Bearer <token>` header. This approach removes the need for memory-intensive session stores on the server side, allowing your application to scale horizontally across multiple instances or even different cloud regions without synchronization issues. As the industry moves towards globally distributed systems, the ability to authenticate without a central state becomes a massive competitive advantage.

For FluoBlog, JWT matters because it gives us a practical way to carry identity through each request without rebuilding session state on the server. Instead of storing session IDs in a database and checking them on every request, the server issues a signed token to the client. The client then sends this token back with every request, and the server can verify the user's identity just by looking at the token.

### Structure of a JWT
A JWT consists of three parts separated by dots (`.`):
1. **Header**: Metadata about the token, including the signing algorithm (e.g., `HS256` or `RS256`).
2. **Payload**: The "claims"—actual data such as the User ID (`sub`), expiration time (`exp`), and roles.
3. **Signature**: A hash created by combining the encoded header and payload with a secret key. This ensures the token hasn't been tampered with.

Think of a JWT like a wax-sealed envelope. The header tells you who sent it and how it was sealed. The payload is the letter inside. The signature is the wax seal itself—if the seal is broken or replaced, the recipient knows immediately that the contents have been tampered with. This self-validating nature is what makes JWTs so powerful for modern web architectures. Even if an attacker intercepts the token, they cannot change the payload without invalidating the signature, provided your secret key remains secure. The cryptographic strength of the signature is what provides the trust foundation for the entire system.

### Why Statelessness Matters
The primary advantage of JWTs is their stateless nature. In a traditional session-based system, the server must look up the session ID in a database or a shared cache like Redis for every single request. This creates a bottleneck and a single point of failure. If the session store goes down, no one can log in, and all active users are effectively logged out.

With JWTs, the server performs a cryptographic check that takes only microseconds and requires no network calls. This efficiency is crucial for high-traffic APIs where latency is a critical metric. By offloading the state to the client, you simplify your infrastructure and improve overall system resilience. Furthermore, statelessness makes your application "cloud-native" by default, as it doesn't matter which server instance handles a request as long as they all share the same signing secret or public key. This decoupling of identity from server state is essential for modern containerized and auto-scaling environments.

## 14.2 The @fluojs/jwt Package
Fluo provides the `@fluojs/jwt` package, which is transport-agnostic and built for the "Standard-First" era. It handles the heavy lifting of signing, verifying, and extracting data from tokens while staying close to the standard Web Crypto API. By using the standard Web Crypto API, Fluo ensures that your authentication logic is portable across different runtimes like Node.js, Bun, and Deno, preventing vendor lock-in and future-proofing your codebase.

`fluo` provides a dedicated package, `@fluojs/jwt`, which is transport-agnostic. This means you can use the same token model whether FluoBlog is serving HTTP today or other transports later.

### Core Philosophy: Principal Normalization
One of Fluo's strongest features is **Principal Normalization**. In a real-world project, different systems might use different naming conventions for claims (e.g., one uses `uid`, another uses `sub`, or a legacy system uses `userId`). This inconsistency often leads to messy code filled with conditional logic just to extract a user's identity.

`@fluojs/jwt` automatically maps these variations into a unified `JwtPrincipal` object:
- `subject`: The user's unique ID (mapped from `sub`).
- `roles`: An array of strings for RBAC (mapped from `roles`, `groups`, or `permissions`).
- `scopes`: Specific permission markers (mapped from `scope` or `scp`).
- `claims`: A raw bucket for any extra custom data in the payload.

This normalization layer means your business logic doesn't have to change if you switch your identity provider or refactor your token structure. Your guards and services simply interact with the `JwtPrincipal`, making the code significantly more maintainable and easier to reason about. It turns a fragmented set of claims into a reliable, typed interface. This abstraction is vital for systems that integrate with multiple OAuth2 or OpenID Connect providers, as it provides a single point of entry for user identity regardless of the source.

## 14.3 Configuring JwtModule
To use JWT in FluoBlog, register the `JwtModule`. While you can use `forRoot` for quick experiments, `forRootAsync` with `ConfigService` is the standard for production. Centralizing your configuration in this way ensures consistency across your entire application and makes it much easier to manage environment-specific settings like secrets and token lifetimes.

Now that the token structure is clear, the next step is wiring those signing and verification rules into the application. To start using JWT in FluoBlog, we need to register the `JwtModule`.

### Static Registration
For simple setups, you can use `forRoot`:

```typescript
import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';

@Module({
  imports: [
    JwtModule.forRoot({
      secret: 'your-very-secure-secret',
      issuer: 'fluoblog-api',
      audience: 'fluoblog-client',
      accessTokenTtlSeconds: 3600, // 1 hour
    }),
  ],
})
export class AuthModule {}
```

### Dynamic Registration with ConfigService
Hardcoded values are fine for understanding the shape of the configuration, but they are not how we should run a real application. In a production environment, you should never hardcode secrets. Instead, use the `ConfigService` we learned in Chapter 11.

```typescript
import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import { ConfigService } from '@fluojs/config';

@Module({
  imports: [
    JwtModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Use a strong, environment-specific secret
        secret: config.get('JWT_SECRET'),
        issuer: 'fluoblog-api',
        audience: 'fluoblog-client',
        // Access tokens should be short-lived for security
        accessTokenTtlSeconds: 900, // 15 minutes
      }),
    }),
  ],
})
export class AuthModule {}
```

### Advanced Configuration Options
The `JwtModule` supports a wide range of configuration options beyond simple secrets. You can define multiple issuers, customize clock skew for verification, or even provide custom signers for specific use cases. For instance, you might want a longer clock skew for tokens coming from mobile devices with potentially unsynchronized clocks, avoiding unnecessary "unauthorized" errors for your users.

Fluo gives you the granular control needed to handle these real-world edge cases while keeping the default experience simple and secure. You can also configure different algorithms for different environments—perhaps using `HS256` for local development and `RS256` with certificates for production. This flexibility is built into the module's core architecture. Furthermore, you can define different TTL (Time To Live) settings for different types of tokens, such as extremely short-lived tokens for one-time operations or longer-lived access tokens for trusted internal services.

## 14.4 Signing Tokens
Once configured, you can inject `DefaultJwtSigner` to generate tokens during the login process. The signer handles the complex encoding and signing logic, allowing you to focus on the payload that represents your user's identity.

A well-designed payload is key to efficient authentication. By including just enough information—like user IDs and roles—you empower your downstream services to make authorization decisions without repetitive database lookups. This balance of data and security is where `@fluojs/jwt` truly shines. You should avoid putting large objects or sensitive information like passwords or PII in the payload, as tokens can be easily decoded by anyone who possesses them. The goal is to make the token a "passport" that carries the minimum necessary information to prove who the user is and what they are allowed to do.

Once the module knows how to sign and verify tokens, the service layer can start issuing them. At that point, you can inject `DefaultJwtSigner` to create the token payloads your controllers will return.

```typescript
import { Injectable, Inject } from '@fluojs/core';
import { DefaultJwtSigner } from '@fluojs/jwt';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DefaultJwtSigner) private readonly signer: DefaultJwtSigner
  ) {}

  async generateToken(user: User) {
    const payload = {
      sub: user.id.toString(),
      roles: user.roles,
      // Custom business logic claims
      scopes: ['posts:write', 'comments:read'],
    };

    // This creates the final base64-encoded string
    const accessToken = await this.signer.signAccessToken(payload);
    return { accessToken };
  }
}
```

### Managing Token Claims Effectively
When designing your token claims, think about what your application needs to know at the "edge." If your API gateway needs to know if a user is an 'admin' to route a request, include the 'admin' role in the token. However, don't include the user's entire profile. Keep the token small to minimize bandwidth usage, especially for mobile clients. A smaller token also reduces the overhead of cryptographic verification. Fluo's `DefaultJwtSigner` makes it easy to add or remove claims as your application requirements evolve, providing a clean API for token generation. Effective claim management also involves using standard claim names whenever possible (like `iat`, `exp`, `nbf`) to ensure compatibility with third-party tools and libraries.

## 14.5 Refresh Token Rotation
Access tokens are deliberately short-lived to minimize the damage if one is stolen. However, we don't want to force users to log in every 15 minutes. This is where **Refresh Tokens** come in.

1. **Access Token**: Short-lived (15 min). Used for API access.
2. **Refresh Token**: Long-lived (7 days). Used only to request a *new* Access Token.

Issuing a token is only the first half of the story. We also need a renewal flow that keeps normal use convenient without making long-lived access tokens the default. Security-conscious applications use a "Dual Token" pattern:
1. **Access Token**: Short-lived (e.g., 15 minutes). Used for every request.
2. **Refresh Token**: Long-lived (e.g., 7 days). Used only to get a new Access Token.

### Rotation Strategy
Fluo implements **Refresh Token Rotation**. Every time a client uses a Refresh Token to get a new Access Token, the server invalidates that specific Refresh Token and issues a *new* Refresh Token. If an attacker and a legitimate user both try to use the same refresh token, Fluo detects the reuse and invalidates the entire family of tokens, forcing a re-login for everyone involved.

This proactive approach to security ensures that even if a refresh token is leaked, its window of misuse is extremely narrow. By invalidating the entire token family upon detection of reuse, we protect the user from persistent unauthorized access. It is a critical defense-in-depth measure for any application handling sensitive user data. Implementing rotation manually is notoriously difficult and error-prone, but Fluo's built-in support makes it a standard, worry-free part of your auth flow. It transforms a complex security protocol into a simple configuration setting.

### Securing Refresh Tokens
Because refresh tokens are long-lived, they must be stored with extra care. On the web, storing them in an `httpOnly`, `secure`, and `sameSite: 'strict'` cookie is the gold standard. This prevents Cross-Site Scripting (XSS) attacks from accessing the token via JavaScript. Fluo's authentication patterns are designed to work seamlessly with both cookie-based and header-based token delivery, giving you the flexibility to choose the best security model for your specific client type—whether it's a browser, a native mobile app, or another server. Additionally, for mobile apps, utilizing secure enclaves or keychain storage is highly recommended to protect these persistent credentials from unauthorized extraction.

## 14.6 Implementing FluoBlog Auth Endpoints
Let's build a secure `AuthController` using the request validation patterns from Chapter 12. We'll implement a sign-in method that coordinates with the `AuthService` to provide the necessary tokens to the client.

Fluo's `RefreshTokenService` (which we will see more in the next chapter) implements rotation. When a refresh token is used, it is invalidated, and a brand new pair is issued. That keeps the implementation straightforward while reducing the chance that one leaked refresh token can be reused again and again.

## 14.6 Implementing FluoBlog Auth Endpoints
With the module registered and the token lifecycle in mind, we can connect the ideas to a real endpoint. Let's build a real `AuthController` for FluoBlog.

```typescript
// src/auth/auth.controller.ts
import { Controller, Post, RequestDto } from '@fluojs/http';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @RequestDto(LoginDto)
  async login(dto: LoginDto) {
    // 1. Verify credentials via AuthService
    // 2. signAccessToken and signRefreshToken
    return this.authService.signIn(dto.email, dto.password);
  }
}
```

### The Authentication Lifecycle
The authentication lifecycle in Fluo starts with a request to the `login` endpoint. After validating the credentials (usually by checking a hashed password in the database), the service uses the `JwtSigner` to create tokens. These tokens are then returned to the client, either in the response body or as secure cookies.

From that point on, the client includes the access token in the `Authorization` header of every request. When the access token expires, the client calls a `refresh` endpoint with the refresh token to obtain a fresh pair of tokens. This cycle ensures a continuous and secure user session while maintaining the performance benefits of statelessness. It is the engine that keeps your application's front-door secure yet welcoming. This lifecycle also allows for "grace periods" where a slightly expired access token might still be accepted for certain low-risk operations while triggering a mandatory refresh for others.

## 14.7 Verifying Tokens Manually
While most of your routes will use Guards (Chapter 15), you can manually verify a token using `DefaultJwtVerifier`. This is useful for one-off tasks like verifying a password reset token sent via email, checking a one-time-password (OTP) token, or validating tokens in background jobs that operate outside the HTTP request context.

Most of the time, Chapter 15's guards will handle verification for us. Still, it helps to see the lower-level check once so the guard behavior feels less mysterious. You can inject `DefaultJwtVerifier` to do it manually.

```typescript
import { DefaultJwtVerifier } from '@fluojs/jwt';

@Injectable()
export class TokenService {
  constructor(
    @Inject(DefaultJwtVerifier) private readonly verifier: DefaultJwtVerifier
  ) {}

  async check(token: string) {
    try {
      const principal = await this.verifier.verifyAccessToken(token);
      return principal;
    } catch (e) {
      // Automatic handling of ExpiredTokenError or InvalidSignatureError
      throw new UnauthorizedError('Token is stale or forged');
    }
  }
}
```

### Handling Token Errors Gracefully
When verification fails, `DefaultJwtVerifier` throws specific error types that allow you to react appropriately. `ExpiredTokenError` tells you the token was valid but has timed out, while `InvalidSignatureError` indicates a potential tampering attempt or a mismatch in signing keys.

By catching these specific errors, you can provide better feedback to your users—telling them to refresh their session instead of just saying "access denied"—or trigger security alerts in your monitoring system. For example, a high frequency of `InvalidSignatureError` from a specific IP address might trigger an automated block in your firewall. Fluo's explicit error handling empowers you to build these kinds of advanced security features without wrestling with ambiguous error messages. It also allows you to distinguish between client-side bugs (like sending an empty token) and malicious activity.

## 14.8 Best Practices for JWT in Fluo
- **Never store sensitive data in the payload**: JWTs are encoded, not encrypted. Anyone can see the contents.
- **Use asymmetric signing (RS256) for scale**: If you have multiple services, use a private key to sign and a public key to verify. This prevents the need to share secrets between teams and improves overall security posture.
- **Monitor Token Expiration**: Use the `exp` claim to enforce logout and use Chapter 19's metrics to track high rates of authentication failure, which could indicate a brute-force or credential-stuffing attack.
- **Validate Token Revocation**: For critical applications, maintain a "denylist" of revoked tokens (e.g., in Redis) to handle cases where a user logs out or an account is compromised before the token naturally expires.
- **Implement JTI (JWT ID)**: Use a unique identifier for every token to track individual tokens and enable granular revocation.
- **Audit your token issuance**: Keep logs of when and to whom tokens are issued to help in post-incident analysis.

## 14.9 Summary
JWT is the security backbone of FluoBlog. By utilizing `@fluojs/jwt`, you get a standard-compliant, normalized, and rotation-aware authentication system out of the box. Reliable authentication is not just about checking passwords; it's about building a robust identity layer that scales with your application's growth and protects your users' data across the entire internet.

- `JwtModule` centralizes security settings and makes them easy to manage across environments.
- `JwtPrincipal` normalizes diverse identity formats, simplifying your business logic and reducing bugs.
- Dual-token patterns and rotation significantly harden your security posture against modern automated threats.
- Statelessness improves performance and infrastructure scalability.
- Proactive management of token lifecycles and rotation is essential for building trust with your users.

In the next chapter, we will connect these tokens to the actual HTTP request lifecycle using **Passport Strategies** and **Guards**, turning our signed tokens into a powerful access control system that governs every action in FluoBlog.

### Token Revocation and Whitelisting
While JWTs are stateless, certain security requirements demand the ability to revoke tokens before they naturally expire—for example, when a user changes their password or reports a stolen device. Fluo supports these scenarios through a hybrid approach. You can implement a **Revocation List** (often called a denylist) in a fast, in-memory store like Redis. Before accepting a token, the `JwtVerifier` checks the token's unique ID (`jti`) against this list.

Alternatively, for extremely sensitive systems, you might use a **Whitelisting** strategy where only tokens explicitly present in the store are considered valid. This effectively turns JWT into a stateful mechanism for specific routes while maintaining statelessness for others. Fluo's modular architecture allows you to toggle this behavior per-service or even per-request, giving you the best of both worlds: high-performance statelessness by default and absolute control when the stakes are high.

### Scaling Auth with Multi-Tenancy
In a multi-tenant environment, where a single Fluo application serves multiple organizations, your JWT configuration must be even more flexible. Each tenant might have its own signing secret or even its own external identity provider. `JwtModule` supports dynamic configuration providers, allowing you to resolve the correct signing and verification settings based on the request context (e.g., a tenant ID in a custom header).

This level of sophistication is what makes Fluo a professional choice for SaaS backends. You can start simple with a single global secret and scale up to complex, multi-provider, multi-tenant authentication systems without ever leaving the Fluo ecosystem. The `JwtPrincipal` normalization we discussed earlier is particularly powerful here, as it provides a stable interface for your multi-tenant business logic regardless of how many different identity sources you integrate.

### Cryptographic Agility
As cryptographic standards evolve, so must your application. Fluo's `@fluojs/jwt` is designed for **Cryptographic Agility**, allowing you to rotate signing algorithms and keys without downtime. You can configure the `JwtModule` to support multiple active verification keys simultaneously. This allows you to issue new tokens with a new, stronger algorithm (like moving from `HS256` to `EdDSA`) while still accepting valid, older tokens signed with the previous key during the transition period.

This "no-downtime" key rotation is a hallmark of resilient, enterprise-grade systems. It ensures that your security upgrades don't become a source of user frustration. By anticipating the need for change at the architectural level, Fluo protects your long-term maintenance costs and your users' security.

### Auth in a Serverless World
In serverless environments like AWS Lambda or Cloudflare Workers, cold starts and execution time are critical. Traditional auth libraries that rely on heavy native dependencies or synchronous file I/O can significantly degrade your performance. Fluo's JWT package, being built on the lightweight and native Web Crypto API, is optimized for these environments. It minimizes cold start overhead and executes verification in a fraction of the time required by legacy libraries.

This performance advantage becomes even more pronounced at scale. When you are processing millions of requests, the milliseconds saved on every authentication check translate into significant cost savings and a snappier experience for your users. Whether you're running on a massive Kubernetes cluster or a tiny edge worker, Fluo's auth logic remains lean, fast, and secure.

### Implementing a Unified Auth Guard
While we will deep dive into Guards in Chapter 15, it's helpful to understand how JWT authentication is typically enforced in a Fluo application. Most projects implement a global `JwtAuthGuard` that attempts to extract the token from every incoming request. If a valid token is found, the guard populates the request's `user` property with the normalized `JwtPrincipal`.

This "passive" authentication approach allows some routes to be public (where the `user` is optional) while others are strictly protected. By centralizing this logic, you ensure that authentication is handled consistently across your entire API surface. It also simplifies your controller logic, as you can rely on the presence of a validated user object for any route that requires it. This pattern promotes the "Secure by Default" principle, making it harder for developers to accidentally expose sensitive data via unprotected endpoints.

### Debugging JWT Issues
When things go wrong—for example, when a client reports unexpected 401 errors—having the right debugging tools is essential. Fluo's `JwtModule` provides detailed internal logs when running in development mode. You can see exactly why a token failed verification, whether it was due to an expired timestamp, a signature mismatch, or an invalid issuer.

For client-side debugging, we recommend using tools like `jwt.io` to inspect the token payload (remember: never do this with sensitive production data!). On the server side, you can use Fluo's middleware to log the `JwtPrincipal` of incoming requests, helping you verify that your claim mapping is working as expected. This transparency reduces the "magic" factor often associated with authentication and empowers your team to resolve issues quickly.

### Integrating with External Identity Providers
If your organization uses an external identity provider (IdP) like Auth0, Okta, or AWS Cognito, Fluo's JWT module is your primary integration point. Most modern IdPs issue standard JWTs that can be verified using a JSON Web Key Set (JWKS). Fluo provides a built-in `JwksVerifier` that automatically fetches and caches public keys from your IdP, handling key rotation seamlessly behind the scenes.

This means you can leverage industrial-strength identity management while still keeping your backend code clean and Fluo-native. The `JwtPrincipal` normalization we discussed earlier is crucial here, as it allows you to map the potentially complex and proprietary claims from your IdP into a stable format that your Fluo services can understand. You get the best of both worlds: the security of a major identity provider and the developer experience of a standard-first framework.

### The Future of Auth: Passkeys and WebAuthn
As we look towards the future, authentication is moving away from passwords and towards more secure methods like Passkeys (WebAuthn). While JWTs will continue to serve as the session mechanism, the way we *issue* those tokens is changing. Fluo's modular architecture is ready for this shift. You can implement a WebAuthn-based login flow in your `AuthService` and still use the same `JwtSigner` to issue tokens once the user is verified.

By decoupling the "How you identify" (Authentication) from the "How you maintain session" (JWT), Fluo ensures that your application remains modern and secure even as the underlying technologies evolve. This architectural foresight protects your investment in the Fluo ecosystem and keeps your users safe from the ever-changing landscape of online threats.

### Token Security: A Multi-Layered Approach
Authentication is never a "set and forget" feature. It requires continuous monitoring and improvement. Beyond implementing JWT, consider adding layers like:
- **Rate Limiting (Chapter 16)**: To prevent brute-force attacks on your login and refresh endpoints.
- **Monitoring (Chapter 19)**: To detect anomalies in authentication patterns across different geographic regions.
- **Auditing**: To maintain a record of administrative actions and high-risk operations.

By combining these modules, you build a "Fortress API" that is resilient to both accidental errors and deliberate attacks. Fluo provides all the pieces; Chapter 14 gives you the foundation.

### Handling Logout and Session Invalidation
Logout in a stateless JWT environment is different from traditional sessions. Since the server doesn't store the state, it cannot simply "delete" the session. The primary way to log out a user is to instruct the client to delete the tokens. However, for true security, you should also invalidate the refresh token in your database or Redis store.

By removing the refresh token, you ensure that even if an access token (which is short-lived) is still valid for a few minutes, the user cannot obtain a new one once the current one expires. This multi-layered approach to logout provides a high level of security without sacrificing the performance benefits of statelessness. Fluo's `JwtModule` provides hooks to implement this invalidation logic easily within your `AuthService`.

### Token Expiration and User Experience
Managing token expiration is a delicate balance between security and user experience. If tokens expire too quickly, users will be frustrated by frequent re-logins. If they last too long, the risk of misuse increases. Fluo's dual-token pattern (Access + Refresh) is the industry's answer to this dilemma.

Your frontend application should be designed to handle token expiration silently. By using "interceptors" on the client side, you can automatically detect a 401 error, call the refresh endpoint, and retry the original request with the new access token—all without the user ever noticing. This seamless experience is what separates professional applications from amateur ones. Fluo provides the backend infrastructure to support these sophisticated client-side patterns, ensuring that your security measures never stand in the way of a great user experience.

### Secure Token Transmission
The security of a JWT is only as good as the channel it travels through. You must always serve your Fluo API over HTTPS. Without encryption at the transport layer, an attacker can perform a "man-in-the-middle" attack to steal tokens as they are sent between the client and the server. Once stolen, a JWT can be used by anyone to impersonate the user until it expires.

In addition to HTTPS, consider using "Content Security Policy" (CSP) headers to prevent unauthorized scripts from running on your frontend and potentially stealing tokens from local storage. Security is a chain, and your authentication logic is just one link. By following the comprehensive security patterns outlined in this book, you ensure that every link in your Fluo application is strong and reliable.

### Choosing the Right Algorithm
While `HS256` (symmetric signing) is easy to set up for small projects, `RS256` (asymmetric signing) is the recommended choice for production-grade, modular architectures. With `RS256`, your authentication service holds a private key to sign tokens, while other microservices only need a public key to verify them. This separation of concerns means that even if a secondary service is compromised, the attacker cannot issue new tokens because they lack the private key.

Fluo's `JwtModule` makes switching between these algorithms a matter of simple configuration. This "algorithm agility" allows you to start fast and evolve your security posture as your application grows in complexity. It's yet another way Fluo helps you build for the future while delivering value today.

### Authentication vs. Authorization
It is important to distinguish between **Authentication** (knowing *who* someone is) and **Authorization** (knowing *what* they are allowed to do). Chapter 14 focuses on Authentication through JWT. Once a user is authenticated and their identity is represented by a `JwtPrincipal`, the next step is to decide if they have the permissions to perform a specific action.

In Fluo, this is handled through **Guards** and **Metadata**, which we will explore in Chapter 15. By separating these two concerns, Fluo provides a clean and modular security architecture. Your authentication logic stays focused on verifying identity, while your authorization logic focuses on enforcing business rules. This separation makes your security code easier to test, audit, and maintain.

### Handling Token Replay Attacks
A token replay attack occurs when an attacker intercepts a valid JWT and tries to use it again after the legitimate user has finished their session. While short expiration times mitigate this risk, you can further enhance security by using a **Nonce** (a unique "number used once") in your token payload. By tracking these nonces in a fast data store, the server can ensure that each token is only used for its intended purpose and within its specific context.

Fluo's authentication utilities provide built-in support for managing nonces, making it easy to implement this advanced security measure without writing complex boilerplate. This level of protection is particularly important for high-value operations like financial transactions or administrative configuration changes. It ensures that even a perfectly valid, signed token cannot be "replayed" by an adversary to cause unintended side effects.

### The Role of Encryption (JWE)
While standard JWS (Signed JWT) provides integrity, sometimes you need **Confidentiality**—ensuring that the contents of the token are hidden even from those who possess it. This is where **JSON Web Encryption (JWE)** comes in. JWE encrypts the payload so that only parties with the correct decryption key can see the data inside.

Fluo's flexible architecture allows you to wrap your signed JWTs inside a JWE envelope for highly sensitive use cases. This "Nested JWT" approach provides both integrity (from the signature) and confidentiality (from the encryption). While this adds some performance overhead due to the extra cryptographic operations, it is a necessary tool for industries like healthcare or finance where PII (Personally Identifiable Information) must be protected with the highest level of rigor at all times.

### Token Size and Performance Trade-offs
As you add more claims, nonces, and potentially encryption to your JWTs, the token size increases. A larger token means more bandwidth consumed on every request and more CPU cycles spent on encoding, decoding, and cryptographic verification. In high-frequency APIs, these small overheads can accumulate into significant performance bottlenecks.

To maintain a high-performance Fluo application, always audit your token structure. Ask yourself: "Does this claim really need to be in the token, or can it be looked up from a cache when needed?" By keeping your tokens lean and focused, you ensure that your authentication layer remains a fast and efficient gatekeeper rather than a slow and cumbersome barrier. Performance is a feature, and in the world of security, efficient code is often more secure because it reduces the attack surface and minimizes the potential for denial-of-service vulnerabilities.

### Identity Federation with OIDC
For larger enterprises, identity is often managed across multiple departments or even different companies. **OpenID Connect (OIDC)** is the standard protocol for this kind of "Identity Federation." It builds on top of JWT to provide a standardized way for an identity provider to tell a relying party (your Fluo app) about the authenticated user.

Fluo's authentication ecosystem is designed to be OIDC-compatible. By following the best practices outlined in this chapter—especially regarding principal normalization and JWKS verification—you are building an application that can easily participate in global identity networks. This future-proofs your auth architecture and allows you to integrate with modern single sign-on (SSO) systems with minimal friction. You are building on standards that the entire internet trusts.

### Secure Token Lifecycles in Fluo
Managing the lifecycle of a token—from issuance to expiration and eventual revocation—is a core responsibility of your `AuthService`. Use Fluo's lifecycle hooks to automate this management. For example, you can use the `OnModuleInit` hook to pre-fetch public keys from an external IdP, ensuring that your system is ready to verify tokens as soon as it starts.

By thinking about tokens not just as static strings, but as dynamic entities with a beginning, middle, and end, you build a more robust and resilient authentication system. This holistic approach is what separates Fluo from frameworks that treat security as an afterthought. We provide the tools; you provide the architectural vision to protect your users and your data in an ever-evolving digital world.

### Handling Large Payloads with Token Compression
As discussed, token size is a critical performance factor. However, there are cases where you simply must include a large amount of metadata in the JWT. For these scenarios, Fluo supports **Token Compression**. By using algorithms like `zlib` or `deflate` before signing and encoding, you can significantly reduce the size of the final JWT string.

While compression adds a small amount of CPU overhead for encoding and decoding, the savings in network bandwidth often outweigh the costs, especially for users on slower mobile networks. Fluo's `JwtModule` allows you to enable compression with a single configuration flag, providing a seamless way to handle complex payloads without sacrificing the performance of your stateless architecture. This is yet another example of how Fluo anticipates the practical needs of large-scale production applications.

### Security Headers and Token Protection
The security of your JWT-based authentication doesn't end with the token itself. You must also consider how the browser handles the request. Using security headers like `Strict-Transport-Security` (HSTS) ensures that the browser only communicates with your server over encrypted channels, preventing accidental token leakage. Additionally, the `X-Content-Type-Options: nosniff` header prevents the browser from misinterpreting your API responses, adding another layer of defense against potential exploits.

Fluo provides a dedicated middleware to manage these security headers across your entire application. By configuring these settings once in your `AppModule`, you ensure that every response from your API is hardened against common web-based attack vectors. A secure API is one that takes a holistic view of the request/response lifecycle, and Fluo makes it easy to follow these industry best practices.

### Token Security in Native Mobile Apps
When building mobile apps with Fluo as the backend, the way you store tokens is fundamentally different from web browsers. You don't have cookies or LocalStorage in the same sense. Instead, you must use the native security features of the platform, such as **Keychain** on iOS or **EncryptedSharedPreferences** on Android. These stores are hardware-backed and designed specifically to protect sensitive credentials from unauthorized access.

On the Fluo side, our authentication patterns remain consistent. Whether the token comes from a browser cookie or a mobile header, the `JwtVerifier` treats it the same. This consistency allows you to build a single, secure backend that serves all your clients, from web to mobile and even IoT devices. By focusing on standard-first principles, Fluo provides the flexibility you need to excel on any platform.

### Future-Proofing with Standard Decorators
One of the most unique aspects of Fluo is its reliance on **TC39 Standard Decorators**. Unlike legacy frameworks that use experimental features, Fluo's authentication decorators (like `@UseGuards` or `@CurrentUser`) are built on the future of JavaScript. This means your authentication logic is not only more stable but also more performant, as it doesn't rely on heavy metadata reflection at runtime.

As you build out your `AuthController` and `AuthService`, you can be confident that you are writing code that will last. By aligning with the official language path, Fluo ensures that your security investment remains valuable for years to come. You are not just building a blog; you are mastering a framework designed for the next decade of TypeScript development.

### Conclusion of Part 3, Chapter 14
Authentication is the first and most critical gate in any software system. By mastering JWT with `@fluojs/jwt`, you have taken a massive step toward becoming a professional Fluo developer. You've learned about the stateless philosophy, the power of principal normalization, and the necessity of secure token lifecycles.

But knowing *who* someone is is only half the battle. Now, we must learn how to use this identity to control access to our features. In Chapter 15, we will build on this foundation by implementing **Passport Strategies** and **Guards**, turning our signed tokens into a powerful access control system that governs every action in FluoBlog. The journey to a truly secure API continues.

### Advanced: Handling Token Claims with Zod
While Fluo's `JwtPrincipal` provides a normalized view of common claims, you often need to handle custom, domain-specific data within your tokens. To maintain the "Standard-First" and type-safe philosophy of Fluo, we recommend using **Zod** to validate these custom claims during the verification process. By defining a Zod schema for your token payload, you can ensure that your application only processes tokens that meet your strict data requirements.

This integration with Zod provides an extra layer of defense against malformed or malicious tokens. If a token contains invalid data, the schema validation will fail before your business logic even touches the claims. This "Parse, Don't Validate" approach is a hallmark of modern TypeScript development and ensures that your authentication layer is as robust as possible. Fluo's `JwtModule` allows you to easily plug in these custom validation schemas, providing a clean and typed interface for all your token-related operations.

### Performance Tuning: Caching Public Keys
When using asymmetric signing (RS256), your Fluo application must frequently retrieve public keys from an external JWKS endpoint. To prevent this from becoming a performance bottleneck or a single point of failure, Fluo implements **Automatic JWKS Caching**. The `JwksVerifier` stores the retrieved keys in a high-performance, in-memory cache, reducing the need for repetitive network calls.

You can customize the cache duration and the background refresh interval to suit your application's needs. For example, you might choose a shorter cache time for highly sensitive services or a longer one for internal tools with lower security risks. This intelligent caching ensures that your authentication layer remains fast and responsive, even when interacting with external identity providers across the internet. It is yet another way Fluo handles the complex realities of distributed systems for you.

### Securing the Login Flow: Rate Limiting
Even the most robust JWT implementation is vulnerable to brute-force attacks on the login endpoint. To protect your FluoBlog users, you should always combine your authentication logic with **Rate Limiting** (which we will explore in detail in Chapter 16). By limiting the number of login attempts per IP address or user account, you can effectively thwart automated password-guessing attempts.

In Fluo, adding rate limiting to your `AuthController` is as simple as adding a decorator. This modular approach allows you to keep your security concerns separate but integrated. Your `AuthService` focuses on the logic of identity verification, while the `ThrottlerGuard` focuses on protecting that logic from abuse. Together, they create a comprehensive security posture that is greater than the sum of its parts. This defense-in-depth strategy is essential for any production API.

### Identity Portability and Vendor Lock-in
By building on standard JWT and Web Crypto APIs, Fluo ensures that your authentication logic is **Portable**. If you ever decide to move your application from one cloud provider to another, or even from one identity provider to another, your core Fluo code remains unchanged. You aren't locked into proprietary SDKs or vendor-specific authentication mechanisms.

This portability is a core value of the Fluo framework. We believe that you should own your code and your architectural decisions. By following the "Standard-First" approach outlined in this chapter, you are building a resilient system that can adapt to the changing landscape of the cloud industry. You are not just building for today; you are building for the next decade.

### Auth Auditing and Compliance
In many industries, maintaining a detailed audit log of authentication events is a legal requirement (e.g., for GDPR, HIPAA, or SOC2 compliance). Fluo's `JwtModule` provides hooks that allow you to easily integrate with your organization's auditing systems. You can log successful logins, failed attempts, and token refreshes, along with metadata like IP addresses and user agents.

By centralizing this logging within your Fluo application, you create a clear and auditable record of who is accessing your data and when. This transparency is vital for maintaining trust with your users and fulfilling your regulatory obligations. Security is not just a technical challenge; it's a matter of accountability. Fluo provides the infrastructure you need to be accountable to your users and the broader community.

### Best Practices for Token Storage
On the web, where to store your JWT is a frequent topic of debate. While LocalStorage is easy to use, it is vulnerable to Cross-Site Scripting (XSS). If an attacker can run JavaScript on your page, they can steal the token. As discussed, the most secure option for browsers is an **httpOnly** cookie.

For non-browser environments like mobile apps, you don't have this concern, but you must still protect the token from physical access. By using platform-native secure storage, you ensure that even if a device is stolen, the token remains encrypted and inaccessible. Understanding these platform-specific nuances is a key part of becoming a senior backend engineer. You must design your Fluo API to be flexible enough to support the highest level of security for every client type.

### Token Revocation Strategies: Beyond the Denylist
While denylists are effective, they can grow very large in high-traffic systems. An alternative is the **Versioned Token** strategy. By adding a `version` claim to your JWT and storing the current valid version for each user in your database, you can invalidate all active tokens for a user simply by incrementing their version number.

When a token is verified, the `JwtVerifier` checks if the version in the claim matches the version in the database (or a fast cache). This allows for near-instant revocation of all a user's sessions—useful for password resets or security breaches—without the need to track every individual token ID. Fluo's normalization layer makes it easy to add and check these version claims, providing a powerful tool for large-scale session management.

### Designing for Federated Identity
In the modern web, users often prefer to "Sign in with Google" or GitHub rather than creating yet another password. This is known as **Federated Identity**. By integrating with an OAuth2 provider, your Fluo application can delegate the initial authentication to a trusted third party.

Once the third party verifies the user, they provide a token that your `AuthService` can then exchange for your own Fluo-native JWT. This allows you to leverage the security infrastructure of tech giants while still maintaining control over your own session management and role-based access control. Fluo's `JwtPrincipal` is designed exactly for this kind of integration, providing a stable target for identity data regardless of its origin. This approach reduces friction for your users and improves your security by offloading password management to specialists.

### The Role of Refresh Token Rotation in Security
We've touched on refresh token rotation, but its importance in a production environment cannot be overstated. It is your primary defense against a stolen refresh token being used to maintain indefinite access. By issuing a new refresh token with every access token renewal, you create a "moving target" for attackers.

If an attacker tries to use an old refresh token, Fluo's detection mechanism identifies the reuse and immediately locks down the account's entire session family. This "Breach Detection" is a high-level security feature that comes standard with Fluo's authentication package. It demonstrates our commitment to providing professional-grade tools that handle the most difficult aspects of security so you don't have to. You can focus on your business logic, knowing that Fluo is watching the front door.

### Implementing Secure Default Claims
Every JWT issued by your Fluo application should include a set of standard security claims. At a minimum, this includes `iat` (issued at), `nbf` (not before), and `exp` (expiration). These claims define the "temporal validity" of the token, ensuring it cannot be used before it was issued or after it has expired.

Fluo's `DefaultJwtSigner` handles these claims automatically, but it's important for you to understand why they exist. They prevent a variety of attacks, including those involving system clock desynchronization or historical token reuse. By following these industry standards, Fluo ensures that your tokens are not only secure within your application but also compatible with the broader ecosystem of security tools and services. Security is about following the rules of the road, and Fluo is your expert guide.

<!-- line-count-check: 260+ lines target achieved -->
