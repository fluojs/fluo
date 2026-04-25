<!-- packages: @fluojs/passport, @fluojs/jwt -->
<!-- project-state: FluoBlog v1.12 -->

# Chapter 15. Guards and Passport Strategies

This chapter explains how to connect FluoBlog's Authentication flow to Guards and Passport strategies. Chapter 14 covered JWT issuance and verification. This chapter extends those tokens into actual route protection and Authorization rules.

## Learning Objectives
- Understand the role of Guards in the `fluo` request lifecycle.
- Configure Authentication strategies with `@fluojs/passport`.
- Verify tokens and build a principal with a custom `AuthStrategy`.
- Protect routes and controllers with `@UseAuth()`.
- Implement role-based Authorization with `RolesGuard`.
- Explore flows that combine multiple Authentication strategies.
- Understand the basics of attribute-based Authorization and dynamic policy application.
- Summarize the role of Guards and strategies in production security design.

## Prerequisites
- Complete Chapter 11, Chapter 13, and Chapter 14.
- Basic understanding of JWT token-based Authentication flows.
- Understanding of HTTP controllers and route structures that need protection.

## 15.1 The Role of Guards
In the previous chapter, we learned how to issue and verify JWTs. But manually checking tokens in every controller method is tedious and error-prone. This is exactly where **Guards** come in.

A Guard is a special class that decides whether a request can proceed to a route handler. Guards must pass before the Interceptor chain is composed and executed, followed by Pipes and then the handler. Guards act like the application's "security desk", making sure only authorized requests get through. By centralizing security logic in Guards, you can keep controllers focused on business logic and maintain a consistent security posture across the whole API.

### 15.1.1 The Request Lifecycle and Guards
When a request enters a `fluo` application, it passes through a series of layers. Guards sit at a critical point. When Passport Authentication succeeds, the verified identity is written to `requestContext.principal`, and later Guards or handlers can make Authorization decisions based on that principal.

Understanding this lifecycle is essential for building a reliable, layered defense system. Because Guards run before Pipes, they can prevent expensive data transformation or validation logic from running for unauthenticated requests, saving significant server CPU and memory resources. Guards serve as the first filter for the application's "trust zone". By failing early and explicitly, Guards protect the system's internal boundaries from unauthorized entry.

Fluo Guards are also designed to be asynchronous. That means you can perform non-blocking database checks or call external Authorization services inside Guard logic without stopping the entire request handling thread. This scalability is a key strength of the Fluo Guard architecture.

### 15.1.2 Guard Execution Order
In Fluo, Guards run according to a specific hierarchy:
1. **Global Guards**: Applied to every request in the application.
2. **Controller Guards**: Applied to every route inside a specific controller class.
3. **Method Guards**: Applied only to a specific route handler.

When Guards exist at multiple levels, they run from top to bottom, global to controller to method. This hierarchical execution lets you set broad security defaults at the application level while still providing specialized rules for specific endpoints. It also improves application performance because if a Global Guard denies access, more specific and potentially more resource-intensive Controller or Method Guards do not run at all.

## 15.2 Introduction to @fluojs/passport
`fluo` does not rebuild Authentication strategies from scratch. Instead, it provides the `@fluojs/passport` package, which wraps the globally popular **Passport.js** ecosystem in a "Standard-First" way. This lets you use hundreds of proven strategies, including JWT, OAuth2, and SAML, while keeping Fluo's clean decorator-based developer experience.

### 15.2.1 Why Passport?
Passport is widely used as Authentication middleware for Node.js because of its modularity. By separating the Authentication mechanism, or Strategy, from application routes, Passport lets you swap Authentication methods or add new ones with minimal code changes. If you later decide to add "Sign in with Google", you can add a new Passport strategy while leaving most existing Guards intact.

This modularity fits Fluo's architecture well because it separates "how to authenticate" from "what to protect". The Passport community has already handled the details of thousands of identity providers, so you do not need to redesign cryptographic or protocol-level details every time you add a new Authentication method. Fluo adopts this industry standard while keeping application code inside explicit Provider and Guard boundaries.

### 15.2.2 The Principal Object
In Passport terminology, an authenticated user is represented as a "user" object attached to the request. In Fluo, we call this a **Principal**. A Principal is a normalized object that contains the core identity information the rest of the application needs, such as user ID, roles, and permissions. By standardizing the Principal across every strategy, business logic stays decoupled from the specific Authentication method used. For example, `ProfileService` does not care whether the user signed in with JWT or Facebook. It only sees a `Principal` that contains a `userId`.

## 15.3 Implementing the JWT AuthStrategy
The most common strategy in FluoBlog is a custom `AuthStrategy` that reads a Bearer token and normalizes it into a `JwtPrincipal`. Following the "Standard-First" philosophy makes it easier to design the JWT implementation so it stays aligned with industry standards such as RFC 7519.

### 15.3.1 Defining the Strategy Class
A strategy class is a regular Fluo Provider that implements the `AuthStrategy` contract. The real example in this repository, `examples/auth-jwt-passport/src/auth/bearer.strategy.ts`, follows the same shape. It reads the request header directly and delegates verification to `DefaultJwtVerifier`.

```typescript
import { Inject } from '@fluojs/core';
import type { GuardContext } from '@fluojs/http';
import { DefaultJwtVerifier } from '@fluojs/jwt';
import {
  AuthenticationFailedError,
  AuthenticationRequiredError,
  type AuthStrategy,
} from '@fluojs/passport';

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
      throw new AuthenticationFailedError('Authorization header must use Bearer token format.');
    }

    return await this.verifier.verifyAccessToken(token);
  }
}
```

### 15.3.2 Configuration Options
This strategy has three key configuration points.
- Where to read the token from, such as the `Authorization` header input boundary
- Which verifier to delegate verification to, such as `DefaultJwtVerifier`
- Which principal to pass to the application after verification succeeds

### 15.3.3 The Strategy Method: Your Security Gate
The `authenticate()` method is the core of every custom strategy. This is where you check the token format and can run additional checks on the principal returned by the verifier. For example, you may want to check whether the user account is suspended in the database or whether the password was recently changed.

If you throw an error here, the request is rejected even if the JWT itself is technically valid. Keeping cryptographic verification and application logic checks together helps prevent revoked credentials from accessing the system before the token expires.

In production, strategies often inject `UsersService` and perform a database lookup to confirm that the user still exists and is active. This "Verification Loop" is critical in systems that require immediate permission revocation, such as systems that handle sensitive financial or personal data. By checking the user against the database, you can move from "stateless but potentially stale" security to "hybrid" security that combines performance with real-time control.

### 15.3.4 Token Revocation Strategies
Standard JWTs are stateless, so they cannot be easily revoked before expiration. But you can implement revocation patterns inside the `authenticate()` method. One common approach is storing a "JWT version" or "last password change timestamp" in the database and comparing it with a token claim. If the token version is older than the database version, reject the request. This lets you immediately log users out of all devices or force password resets.

Another revocation pattern is the **blacklist, or deny list, pattern**. Traditional JWTs are stateless, but you can maintain a distributed cache, such as Redis, of explicitly revoked `jti` (JWT ID) claims, for example when a user logs out. In the `authenticate()` method, check whether the current token ID exists in the blacklist. This lets you revoke specific tokens almost immediately without querying the primary database on every request, keeping performance costs low while adding the needed security control.

In high-security environments, you can also implement a **whitelist pattern**, where every issued token ID must exist in a "valid token" store. This effectively makes the system stateful, but it gives you more control over active sessions. Because Fluo strategies are asynchronous and support Dependency Injection (DI), you can inject an appropriate service, such as `RedisService`, and add the validation logic needed for these patterns.

## 15.4 Protecting Routes with Passport
After a strategy is defined, you can protect routes with `@UseAuth()`. Internally, the Passport Guard runs the selected strategy, but in Fluo style, controllers should receive the verified principal instead of working with the raw request object.

### 15.4.1 Basic Implementation
To protect a route, apply the `@UseAuth()` Decorator.

```typescript
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';

@Controller('profile')
@UseAuth('jwt')
export class ProfileController {
  @Get()
  getProfile(_input: undefined, ctx: RequestContext) {
    return ctx.principal;
  }
}
```

### 15.4.2 Controller-Level vs. Method-Level Guards
`@UseAuth()` can be applied to an entire class, the controller, or to individual methods. Applying it at the controller level is a "secure by default" approach that ensures every route in that class is protected. If only some routes should be public, you can handle exceptions with more specific configuration or a custom Guard.

This flexibility lets you design security policies that match your application's hierarchy. For example, you can protect the entire `UsersController` with a JWT Guard while applying an additional `RolesGuard` only to the `deleteUser` method. This hierarchical approach creates an auditable security surface and reduces "Security Drift", where a developer accidentally leaves a new endpoint exposed by forgetting to apply a Guard.

### 15.4.3 Mixing Multiple Guards
Fluo lets you stack additional Guards after Passport Authentication. Authentication first creates the principal, and later Guards inspect that principal or the request context to check additional policies. This efficiency matters for performance because it avoids unnecessary database lookups or cryptographic checks after a request has already been treated as unauthorized.

You can also mix built-in Passport Authentication with custom Guards. For example, you can verify identity with `@UseAuth('jwt')` and then restrict access to the corporate network with a custom `IpWhitelistGuard`. This composable nature of Guards makes it easy to build complex security pipelines while keeping each part independently understandable and testable.

## 15.5 Role-Based Access Control (RBAC)
Authentication, who are you, is only half the battle. The other half is **Authorization, what are you allowed to do**. In Fluo, it is natural to design RBAC by applying additional Guards or service policies after Authentication based on `requestContext.principal.roles` or `requestContext.principal.scopes`.

In practice, first secure the principal with `@UseAuth('jwt')`, then attach a Guard that checks roles or scopes in the next step. The key is keeping Authentication and Authorization separate, so the same permission policy can be reused no matter which strategy created the principal.

### 15.5.5 Passing Options to AuthGuard
Sometimes you need to customize Authentication behavior per route. In Fluo, it is safer to keep explicit which principal a strategy returns and which `@UseAuth()` combination is attached to a route, rather than mutating arbitrary properties on the request object.

This configuration lets you meet the exact security requirements of different parts of the application. For example, you might use session-based Authentication for an admin dashboard and strict stateless JWT for a public mobile API. Fluo's Passport integration makes these transitions clear and declarative.

### 15.5.6 Handling Multiple Strategies
Complex applications may need to support multiple Authentication methods at the same time. For example, users might authenticate through a standard JWT or a long-lived API key. Even then, the key is normalizing the final result into the same principal shape no matter which strategy was selected.

This multi-strategy approach is especially useful for **System-to-System Communication**. Web and mobile users may use JWTs, while internal services or third-party webhooks may authenticate with specialized API keys or mutual TLS (mTLS). By stacking these strategies on a single Guard, you can keep a unified security policy for the endpoint while still supporting different client requirements. Controller logic also becomes simpler because it only needs to check for a valid principal regardless of the Authentication method.

When multiple strategies are provided, the Passport layer can try them in order and pass the successful strategy's result to the application in the same principal format. This "logical OR" behavior is very useful for maintaining backward compatibility during Authentication migrations or supporting different client types through one set of endpoints.

## 15.6 Customizing Unauthorized Responses
By default, Passport Authentication failures lead to a standard `UnauthorizedException`. But you may want to customize error messages or log failed attempts for security audits. In Fluo, it is more natural to handle this explicitly inside strategy failure branches or a global exception filter than by extending Guards that rewrap the request object.

### 15.6.1 The Importance of Clear Error Feedback
Providing clear but safe feedback requires balance. You should not leak sensitive system information to attackers, but you should help legitimate users understand why a request failed. Even distinguishing "missing token" from "expired token" in logs can reduce developer debugging time while still showing users a generic message.

Fluo's Passport strategies and exception handling layer provide the tools needed to implement this error management. For example, you can trigger automated alerts when suspicious patterns appear, such as a large number of requests with expired tokens from a specific IP, which may indicate a replay attack attempt. Recording specific failure reasons, such as signature mismatch versus expiration, in internal monitoring systems is essential for incident response and forensic analysis.

### 15.6.2 Integration with Global Filters
While Guards decide whether a request may proceed, they often work with Global Exception Filters to shape the final response format. If a Guard throws `UnauthorizedException`, a filter can catch it and add a trace ID or legal disclaimer to the response body. This Separation of Concerns lets Guard logic focus on the yes or no decision while filters handle how to tell the user.

Another benefit of this integration is support for **Advanced Security Auditing**. By capturing unauthorized attempts at the filter level, you can enrich log data with details that may not be easy to access from the Guard, such as the full response body being sent back or session-specific metadata. You can also use filters to implement a "Slow Fail" pattern. This intentionally delays unauthorized requests by a few hundred milliseconds to reduce rapid brute-force attacks or timing attacks.

In Fluo, exception filters are defined with the `@Catch()` Decorator and can be applied globally, at the controller level, or at the method level. This hierarchy mirrors Guard execution order and gives you a consistent mental model for the whole request-response lifecycle. By combining Guards and filters, you can build a safe and maintainable API while separating Authentication decisions from response formatting.

This modular architecture lets security teams update global response policies without changing a single line of Guard code. It is a classic example of Fluo's "Standard-First" approach, using standard HTTP semantics and clean abstractions to build systems that stay maintainable for decades.

## 15.7 Advanced Authorization: Beyond RBAC
In apps where roles are not enough, you may need **attribute-based Authorization (ABAC)**. For example, a rule might say, "Only the author can edit a post, and only while it is still in Draft status."

The core idea of ABAC is to evaluate the principal plus resource state plus environmental conditions, instead of looking only at the principal. Even here, Passport's role is to normalize the Authentication result into `requestContext.principal`. Actual ownership checks or policy evaluation are easier to maintain when they live in a separate Guard or service layer.

This pattern shows the power of asynchronous Guards. By checking ownership before the request reaches the controller, you can prevent unauthorized data changes at the earliest point. Controller methods also become much cleaner because they no longer need to manually check whether a user has permission to modify a specific entity.

### 15.7.2 Policy-Based Authorization
For large applications, we recommend moving to **Policy-Based Authorization**. This involves creating a dedicated `AuthorizationService` that evaluates complex rules. The Guard then only needs to call this service. This approach centralizes all permission logic in one place, making it easier to audit and change as business requirements evolve.

A policy service can integrate with an external policy administration point (PAP) or distributed authorization engines such as Casbin or Oso. With Fluo's flexible Provider system, you can easily wrap these external engines in a clean TypeScript-first interface that Guards can use. This "Authorization as a Service" model is a proven approach in microservice architectures where permission consistency must be maintained across dozens of different services.

### 15.7.3 Dynamic Resource Constraints
Sometimes Authorization is not just about "can this user do X?" but "how much of X can this user do?" This is called dynamic resource constraining. For example, a "basic" user may be allowed to create five projects, while a "premium" user can create unlimited projects.

You can handle this in business logic, but placing a specialized Guard before the creation route provides a faster fail-early mechanism. The Guard can compare the user's current project count with the subscription tier and reject the request if the limit has been reached. This separates a resource-intensive check from the main execution path and provides a consistent way to enforce billing-related limits across the platform.

Dynamic constraints can also apply to **Time-Based Access**. For example, student accounts may access certain learning materials only during class hours, or maintenance accounts may be limited to specific maintenance windows. Implementing these checks in Guards ensures resources are protected not only by who the user is, but also by when and how they are trying to access them. This level of fine-grained control is essential for building complex real-world systems that must comply with strict operational or contractual requirements.

## 15.8 Deep Dive: Scopes and Claims
Modern OAuth2 and OpenID Connect flows distinguish between **Scopes**, what a token can do, and **Claims**, what a token says about a user.

### 15.8.1 Working with Scopes
Scopes are permissions requested by a client application. For example, a mobile app may request the `posts:write` scope so a user can create content. `JwtStrategy` should extract these scopes and include them in the normalized Principal.

In many OAuth2 implementations, scopes limit what an application can do on behalf of a user. When a user signs in through the official web portal, they may have full administrator permissions, but a third-party integration might receive only a "read-only" scope. This abstraction layer is critical for building a security ecosystem where users can safely grant limited access to their data without sharing their primary credentials.

```typescript
// Inside a custom AuthStrategy
return {
  subject: payload.sub,
  roles: payload.roles || [],
  scopes: payload.scopes || [], // ['posts:write', 'profile:read']
};
```

You can then create a `ScopesGuard` that checks for specific scopes required by a route. This adds another security layer and ensures that even if a user is an `admin`, the token only contains the permissions granted to the specific client being used. This "Principle of Least Privilege" is essential for protecting APIs from token theft or compromised client applications. It also lets you implement an "Incremental Consent" pattern, where users grant permissions only when a specific feature needs them.

Scopes can also control UI behavior. By checking scopes in a token, the frontend can decide whether to show or hide specific buttons or navigation links, providing a more intuitive user experience while server-side Guard checks still enforce security. This synchronization between frontend visibility and backend enforcement is a hallmark of well-designed modern applications.

### 15.8.2 Custom Claims for Multi-Tenancy
When building a multi-tenant SaaS application, your JWT will likely include a `tenant_id` claim. This claim is critical for data isolation. If `tenant_id` is included in the Principal, every service and Repository in the application can automatically filter data based on the current user's organization.

In Fluo, Interceptors or scoped Providers are often used to inject `tenant_id` directly into the database query context. This reduces the chance that a user from "Tenant A" can accidentally see data from "Tenant B", even if there is a bug in application logic. This "Hard Isolation" strategy is a core requirement in many enterprise compliance frameworks, such as SOC2 or HIPAA. It also simplifies the developer experience by reducing the risk that someone forgets to add `WHERE tenant_id = ?` to every query.

### 15.8.3 Extensible Claims for Business Logic
Beyond a simple ID, you can include custom claims that represent specific business states. For example, a `subscription_status` claim lets a Guard immediately block users with expired accounts from accessing premium features without querying the database on every request. This optimization can greatly reduce database load and improve response times for high-traffic applications.

Remember, though, that JWTs are signed by default, not encrypted. Any data you put into claims can be seen by the client and intermediate proxies. Do not put sensitive secrets or personally identifiable information (PII), such as phone numbers or home addresses, directly into JWT claims. Use claims as keys for looking up sensitive data on the server when needed, while balancing performance and privacy.

## 15.9 Best Practices for Production Security
As you move toward production, there are several patterns you should follow to keep Guard and strategy implementations safe and maintainable.

### 1. Avoid Heavy Database Hits in Guards
Guards can be asynchronous, but complex joins or full table scans inside a Guard can create a bottleneck for the whole API. If you need to check data that changes frequently, consider storing Authorization decisions in a high-performance cache such as Redis. This keeps Guards fast and responsive even under heavy load.

### 2. Standardize Principal Shapes
Make sure every Authentication strategy in your application returns the same Principal object shape. This consistency lets business logic and Decorators such as `@CurrentUser` work smoothly no matter whether a user signed in with JWT, a session, or an API key. With Fluo's TypeScript-first nature, you can easily define a global `Principal` interface that every strategy must implement.

### 3. Audit Guard Failures
Every time a Guard denies access, it is a potential security event. Record these failures with enough context, including IP address, user agent, and target resource, so you can detect and respond to credential stuffing or scraping attempts. You can use integrated monitoring tools such as Sentry or OpenTelemetry to track Guard failure rates and alert the team on unexpected spikes.

### 4. Use Shared Auth Policies for Common Routes
If a policy applies to most routes, such as requiring Authentication, consider organizing the same `@UseAuth(...)` combination and common permission Guard configuration so they can be reused. This "Deny by Default" approach is much safer than manually adding policies to every new controller, and it prevents accidental data exposure during fast development cycles.

Also remember to always **test Authentication and Authorization logic in isolation**. You need to confirm that policies behave as expected across every edge case, including missing headers, malformed tokens, and users with multiple roles. A well-tested security layer is the foundation of a trustworthy application.

## 15.11 Deep Dive: Multi-Factor Authentication (MFA) Patterns
In high-security applications, a single password or JWT is often not enough. Implementing **Multi-Factor Authentication (MFA)** is a critical step in modern security.

### 15.11.1 The MFA Challenge Flow
In Fluo, MFA is usually handled by issuing a "partial" JWT after the first factor, the password, succeeds. This token contains a special claim such as `mfa_required: true`. The user is then redirected to an MFA verification endpoint. Only after a valid TOTP or SMS code is provided does the application issue a "final" JWT for full access. This multi-step process ensures that even if a password is stolen, an attacker cannot gain full access without the second factor.

### 15.11.2 Using Guards for MFA Enforcement
You can create an `MfaGuard` that explicitly checks that the `mfa_required` claim is absent. Applying this Guard globally or to sensitive routes ensures users cannot bypass the MFA step. This pattern is easy to implement because of Fluo's normalized Principal object. The Principal object can easily store these temporary security states during the login process.

## 15.12 Handling Strategy Failures Gracefully
A failed Authentication strategy does not always mean a security breach. The token may be expired, the header format may be wrong, or the configuration may not match.

### 15.12.1 Failure Shape
For that reason, a strategy should throw semantically clear failures such as `AuthenticationRequiredError` and `AuthenticationFailedError`, while response messages and logging are organized consistently in the layer above it. This separation helps the frontend distinguish cases such as "session expired" from "credential format is invalid".

### 15.12.2 Strategy Debugging Techniques
If you are struggling with a strategy implementation, first separate input header reading from verifier calls and log each step, as shown in the example `BearerJwtStrategy`. This helps you see exactly which part of the verification process is failing and quickly narrow down whether the cause is a cryptographic signature or the header format.

## 15.13 Security Beyond the Framework
Security is a layered effort. Even though Fluo's Guards and Passport strategies provide strong application-level protection, they should be part of a broader security strategy.

- **Use HTTPS everywhere**: Tokens transmitted over HTTP are easily stolen.
- **Sanitize all inputs**: Authentication doesn't protect you from SQL Injection or XSS. Use Fluo's Validation (Chapter 6) and Serialization (Chapter 7) features.
- **Keep dependencies updated**: A vulnerability in a third-party Passport strategy is a vulnerability in your app. Use tools like `npm audit` regularly.
- **Principle of Least Privilege**: Give your database users and API keys only the permissions they absolutely need.

By combining Fluo's security layers with these industry-standard practices, you can build a backend that is not only fast but also resilient against modern threats.

## 15.14 Summary
Guards and Passport strategies form the protective shield around FluoBlog. By combining proven Passport strategies with Fluo's flexible Guard system, you can implement complex security requirements with very little code.

- **Guards** handle the "may this request enter?" logic for every request.
- **Passport strategies** standardize identity verification methods such as JWT.
- **JwtStrategy** bridges raw tokens and normalized Principal objects.
- **RBAC** through `RolesGuard` ensures users stay within the areas they are allowed to access.
- **Advanced logic** through ABAC and policy services handles complex ownership and resource constraints.
- **Scopes and claims** provide the granularity needed for modern OAuth2 flows and multi-tenant isolation.
- **Production best practices** ensure the security layer is both performant and audit-ready.
- **Principal normalization** ensures the rest of the application can depend on a consistent user object regardless of Authentication method.

FluoBlog can now turn Bearer tokens into verified principals and apply route-level Authorization rules based on those principals. In the final chapter of Part 3, we will add one more layer and learn how to prevent API abuse with Throttling.
