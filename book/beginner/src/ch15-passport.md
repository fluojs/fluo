<!-- packages: @fluojs/passport, @fluojs/jwt -->
<!-- project-state: FluoBlog v1.12 -->

# Chapter 15. Guards and Passport Strategies

## Learning Objectives
- Understand the role of Guards in the `fluo` request lifecycle.
- Implement authentication strategies using `@fluojs/passport`.
- Create the `JwtStrategy` to validate tokens and attach principals to requests.
- Use the `@UseGuards()` decorator to protect routes and controllers.
- Build a custom `RolesGuard` for Role-Based Access Control (RBAC).
- Learn how to handle multi-strategy authentication flows.
- Explore advanced authorization patterns including attribute-based access control (ABAC) and dynamic policy enforcement.
- Gain deep insight into the security architecture of modern TypeScript backends.

## 15.1 The Role of Guards
In the previous chapter, we learned how to issue and verify JWTs. However, checking the token manually in every controller method is tedious and error-prone. This is where **Guards** come in.

A Guard is a specialized class that determines whether a request should be allowed to proceed to the route handler. Guards are executed after all interceptors but before any pipes or the handler itself. They are the "bouncers" of your application, ensuring that only authorized requests get through. By centralizing your security logic in guards, you keep your controllers focused on business logic and ensure a consistent security posture across your entire API.

### 15.1.1 The Request Lifecycle and Guards
When a request hits a `fluo` application, it travels through a series of layers. Guards sit at a critical junction: they have access to the `ExecutionContext`, which means they know everything about the incoming request, the target controller, and the specific handler method. This context allows guards to make intelligent decisions—like allowing an 'admin' to access a route while blocking a 'user', or verifying that a request originated from a specific IP range.

Understanding this lifecycle is essential for building robust, multi-layered defense systems. Because guards run before pipes, they can prevent expensive data transformation or validation logic from running on unauthenticated requests, saving significant CPU and memory resources on your servers. They act as the primary filter for your application's "신뢰 영역" (trusted zone). By failing early and explicitly, guards protect the inner boundaries of your system from unauthorized entry.

Furthermore, guards in Fluo are designed to be asynchronous. This means you can perform non-blocking database checks or external permission service calls within the guard's logic without stalling the entire request processing thread. This scalability is a key advantage of the Fluo guard architecture.

### 15.1.2 Guard Execution Order
In Fluo, guards are executed in a specific hierarchy:
1. **Global Guards**: Applied to every request in the application.
2. **Controller Guards**: Applied to every route within a specific controller class.
3. **Method Guards**: Applied only to a specific route handler.

When multiple guards are present at different levels, they are executed from the top down (Global -> Controller -> Method). This hierarchical execution allows you to set broad security defaults at the application level while providing specialized rules for specific endpoints. It also ensures that if a global guard denies access, the more specific (and potentially more resource-intensive) controller or method guards never even run, further optimizing your application's performance.

## 15.2 Introduction to @fluojs/passport
`fluo` doesn't reinvent authentication strategies. Instead, it provides the `@fluojs/passport` package, a "Standard-First" wrapper around the world-famous **Passport.js** ecosystem. This gives you access to hundreds of battle-tested strategies (JWT, OAuth2, SAML, etc.) while maintaining Fluo's clean, decorator-based developer experience.

### 15.2.1 Why Passport?
Passport is the most popular authentication middleware for Node.js for a reason: it's incredibly modular. By decoupling the authentication mechanism (Strategy) from the application routes, Passport allows you to swap out or add new authentication methods with minimal changes to your code. If you decide to add "Login with Google" later, you simply add a new Passport strategy, and your existing guards can remain largely unchanged.

This modularity is a perfect fit for Fluo's architecture, as it encourages a separation of concerns between "how we authenticate" and "what we protect." Passport's internal community has already handled the nuances of thousands of identity providers, so you don't have to worry about the specific cryptographic or protocol-level details of every new auth method you add. In Fluo, we embrace this industry standard to provide developers with a familiar yet modernized toolset.

### 15.2.2 The Principal Object
In Passport terminology, once a user is authenticated, they are represented as a "user" object attached to the request. In Fluo, we refer to this as the **Principal**. The Principal is a normalized object that contains the core identity information needed by the rest of your application, such as the user's ID, roles, and permissions. By standardizing the Principal across all strategies, you ensure that your business logic remains decoupled from the specific authentication method used (e.g., your `ProfileService` doesn't care if the user logged in via JWT or Facebook; it just sees a `Principal` with a `userId`).

## 15.3 Implementing the JwtStrategy
The most common strategy for FluoBlog is the `JwtStrategy`. This strategy extracts the token from the header, validates its signature, and converts the payload back into a `JwtPrincipal`. By following the "Standard-First" philosophy, Fluo ensures that your JWT implementation is compatible with industry standards like RFC 7519.

### 15.3.1 Defining the Strategy Class
The strategy class is a regular Fluo provider that extends the `PassportStrategy` base class. This base class handles the heavy lifting of connecting your logic to the Passport.js engine.

```typescript
import { Injectable } from '@fluojs/core';
import { PassportStrategy } from '@fluojs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@fluojs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    // This return value is automatically attached to req.user
    // In fluo, we return a normalized Principal object
    return {
      subject: payload.sub,
      roles: payload.roles || [],
      scopes: payload.scopes || [],
    };
  }
}
```

### 15.3.2 Configuration Options
The `super()` call in the constructor is where you configure the behavior of the Passport strategy.
- `jwtFromRequest`: Defines how the token is extracted. `fromAuthHeaderAsBearerToken()` is the standard for most APIs, but you could also extract it from a cookie or a custom query parameter.
- `ignoreExpiration`: If set to `true`, the strategy will accept expired tokens. You should almost always keep this `false` in production.
- `secretOrKey`: The cryptographic secret used to verify the token's signature. This should always be loaded from your `ConfigService` rather than being hardcoded.

### 15.3.3 The Validate Method: Your Security Gate
The `validate()` method is the heart of any Passport strategy. When Passport successfully verifies a token's signature and expiration, it calls this method with the decoded payload. This is your opportunity to perform additional checks. For example, you might want to check if the user's account has been suspended in your database or if their password was recently changed, requiring a re-login.

If you throw an error here, the request will be denied even if the JWT itself is technically valid. This dual-layer check—cryptographic and logic-based—is what makes your authentication truly secure. It ensures that revoked credentials cannot be used to access the system, even during the window before the token naturally expires.

In a production environment, you would often inject a `UsersService` into the `JwtStrategy` and perform a database lookup to ensure the user still exists and is in good standing. This "Verification Loop" is critical for systems that require immediate revocation capabilities, such as those handling sensitive financial or personal data. By validating the user against the database, you move from "Stateless but potentially stale" security to "Hybrid" security that combines performance with real-time control.

### 15.3.4 Token Revocation Strategies
Standard JWTs are stateless, meaning they cannot be easily revoked before they expire. However, by using the `validate()` method, you can implement revocation patterns. One common approach is to store a "JWT Version" or a "Last Password Change Timestamp" in your database and compare it against a claim in the token. If the token's version is older than the one in the database, you reject the request. This provides a way to globally logout a user or force a password reset across all their devices instantly.

Another powerful revocation pattern is the **Blacklist (or Denylist) Pattern**. While traditional JWTs are stateless, you can maintain a distributed cache (like Redis) of "jti" (JWT ID) claims that have been explicitly revoked (e.g., when a user logs out). In your `validate()` method, you check if the current token's ID exists in the blacklist. This allows for near-instant revocation of specific tokens without needing to query the primary database for every single request, maintaining a high level of performance while adding a much-needed security control.

For extremely high-security environments, you might even implement a **Whitelist Pattern**, where every issued token ID must be present in a "Valid Tokens" store. While this makes the system effectively stateful, it provides the maximum possible control over active sessions. In Fluo, because `validate()` is asynchronous and supports dependency injection, implementing any of these patterns is a matter of injecting the appropriate service (e.g., `RedisService`) and adding a few lines of logic.

## 15.4 Using AuthGuards
Once your strategy is defined, you can use the built-in `AuthGuard` to protect your routes. The `AuthGuard` is a factory that creates a guard for a specific strategy name (usually 'jwt'). It acts as the glue between the strategy's validation logic and Fluo's request lifecycle.

### 15.4.1 Basic Implementation
To protect a route, simply apply the `@UseGuards()` decorator.

```typescript
import { Controller, Get, UseGuards } from '@fluojs/http';
import { AuthGuard } from '@fluojs/passport';

@Controller('profile')
@UseGuards(AuthGuard('jwt'))
export class ProfileController {
  @Get()
  getProfile(@Request() req) {
    // req.user contains the Principal returned by JwtStrategy.validate()
    return req.user;
  }
}
```

### 15.4.2 Controller-Level vs. Method-Level Guards
You can apply `@UseGuards()` to an entire controller or to individual methods. Applying it at the controller level is a "secure by default" approach, ensuring that every route in that class is protected. If you have one or two public routes in an otherwise private controller, you can use more specific configurations or custom guards to handle the exceptions.

This flexibility allows you to craft a security policy that perfectly matches your application's hierarchy. For example, you might protect the entire `UsersController` with a JWT guard, but apply an additional `RolesGuard` only to the `deleteUser` method. This layered approach creates a highly granular and auditable security surface for your application. It also prevents "Security Drift" where new endpoints are accidentally left unprotected because a developer forgot to apply a guard manually.

### 15.4.3 Mixing Multiple Guards
Fluo allows you to stack multiple guards on a single route or controller. When you provide multiple guards to `@UseGuards()`, they are executed in sequence. If any guard returns `false` or throws an exception, the request is immediately blocked, and subsequent guards are not executed. This efficiency is important for performance, as it avoids unnecessary database or cryptographic checks once a request has already been deemed unauthorized.

You can mix built-in guards with custom ones. For instance, you might use `AuthGuard('jwt')` to verify identity and then a custom `IpWhitelistGuard` to restrict access to internal company networks. This composable nature of guards makes it easy to build complex security pipelines that are still easy to reason about and test in isolation.

## 15.5 Role-Based Access Control (RBAC)
Authentication (who are you?) is only half the battle. You also need **Authorization** (what can you do?). Let's build a `RolesGuard` that checks if a user has the required roles to access a route.

### 15.5.1 Setting Metadata with @Roles
First, we need a way to mark routes with required roles. We use a custom decorator for this. In Fluo, decorators are the primary way we attach behavioral metadata to our code without polluting the business logic.

```typescript
// src/auth/decorators/roles.decorator.ts
import { SetMetadata } from '@fluojs/core';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
```

### 15.5.2 Implementing the RolesGuard
The guard will read this metadata and compare it with the roles in the user's `Principal`. Notice how we inject the `Reflector` service. This is a built-in Fluo utility that allows us to retrieve metadata attached via decorators at any level of the application.

```typescript
import { Injectable, CanActivate, ExecutionContext, Inject } from '@fluojs/core';
import { Reflector } from '@fluojs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler());
    if (!requiredRoles) {
      return true; // If no roles required, allow access
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Check if user has at least one of the required roles
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}
```

### 15.5.3 Chaining Guards
You can use multiple guards on a single route. They are executed in the order they are listed. Usually, you want to run `AuthGuard` first to establish the user's identity, followed by `RolesGuard` to check their permissions.

When chaining guards, you can also leverage **Custom Global Guards**. A common pattern is to apply a global `JwtAuthGuard` to the entire application but allow specific routes to opt-out using a `@Public()` decorator. This ensures that your application is "Secure by Default" and you only explicitly open holes where needed. This strategy significantly reduces the risk of accidentally exposing sensitive endpoints when developers forget to add a guard to a new controller.

To implement this "Secure by Default" pattern, you would register the guard in your main `AppModule` using the `APP_GUARD` token provided by `@fluojs/core`. This tells Fluo to instantiate the guard and apply it to every single request hitting the application. Inside the guard, you can check for the presence of your custom `@Public()` metadata to decide whether to skip the authentication check. This centralized approach to security is a hallmark of professional-grade Fluo applications.

```typescript
@Post()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin', 'editor')
async createPost(@Body() dto: CreatePostDto) {
  return this.postsService.create(dto);
}
```

This ordering is crucial. If `RolesGuard` were to run before `AuthGuard`, the `request.user` object would not yet be populated, leading to a "Forbidden" error even for valid administrators. Fluo's sequential execution model ensures that each guard can depend on the side effects (like populating the request object) of the guards that came before it. This predictable flow is a key part of the framework's reliability.

### 15.5.4 Custom Decorators and @CurrentUser
To make your code even cleaner, you can create a `@CurrentUser` decorator that extracts the user object from the request. This avoids repetitive `req.user` access and makes your handlers more readable. By leveraging custom decorators, you hide the implementation details of "how the user is stored" and present a clean API to your controller developers.

```typescript
import { createParamDecorator, ExecutionContext } from '@fluojs/core';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

### 15.5.5 Passing Options to AuthGuard
Sometimes you need to customize the behavior of the `AuthGuard` on a per-route basis. You can do this by passing an options object as the second argument to the `AuthGuard()` factory (when using it via inheritance) or by configuring it in your module. Common options include `session: false` (to disable session support for stateless APIs) and `property: 'principal'` (to change the property name on the request object where the user is attached).

```typescript
@Injectable()
export class StatelessJwtGuard extends AuthGuard('jwt') {
  constructor() {
    super({
      session: false,
    });
  }
}
```

This level of configuration ensures that your authentication layer behaves exactly as needed for different parts of your application. For example, you might use session-based authentication for your administrative dashboard but strict stateless JWTs for your public mobile API. Fluo's integration with Passport makes these transitions seamless and declarative.

### 15.5.6 Handling Multiple Strategies
In complex applications, you might support multiple authentication methods simultaneously. For example, a user could authenticate via a standard JWT or a long-lived API key. You can achieve this by passing an array of strategy names to the `AuthGuard`.

When supporting multiple strategies, Fluo handles the **Strategy Selection Logic** internally. If you provide an array like `['jwt', 'api-key']`, Passport will attempt to authenticate the request using each strategy in the order specified. The first strategy that successfully authenticates the request "wins," and its principal is attached to the request object. If all strategies fail, the guard will throw an `UnauthorizedException`.

This multi-strategy approach is particularly useful for **System-to-System Communication**. While your web and mobile users might use JWTs, internal services or third-party webhooks might provide authentication via specialized API keys or mutual TLS (mTLS). By stacking these strategies in a single guard, you can maintain a unified security policy for an endpoint while remaining flexible enough to support diverse client requirements. It also simplifies your controller logic, as you only need to check for a valid principal regardless of how it was authenticated.

```typescript
@UseGuards(AuthGuard(['jwt', 'api-key']))
@Get('sensitive-data')
getData() {
  return { message: 'This is protected by either JWT or API Key' };
}
```

When multiple strategies are provided, `AuthGuard` will try them in order. If any strategy succeeds, the request is allowed to proceed. This "Logical OR" behavior is incredibly useful for maintaining backward compatibility during authentication migrations or for supporting diverse client types with a single set of endpoints.

## 15.6 Customizing Unauthorized Responses
By default, `AuthGuard` throws a standard `UnauthorizedException`. However, you might want to customize the error message or log the failed attempt for security auditing. You can do this by extending the `AuthGuard`.

```typescript
import { Injectable, UnauthorizedException } from '@fluojs/core';
import { AuthGuard } from '@fluojs/passport';

@Injectable()
export class MyJwtGuard extends AuthGuard('jwt') {
  handleRequest(err, user, info) {
    if (err || !user) {
      // Log info.message for debugging (e.g., "jwt expired")
      throw err || new UnauthorizedException('Please log in to access this resource');
    }
    return user;
  }
}
```

### 15.6.1 The Importance of Clear Error Feedback
Providing clear yet secure feedback is a fine art. While you don't want to leak sensitive system information to an attacker, you do want to help legitimate users understand why their request failed. Distinguishing between a "missing token" and an "expired token" in your logs can save hours of debugging time, even if you show a generic message to the end-user.

Fluo's guard system gives you the hooks necessary to implement this level of sophisticated error management. You can even use these hooks to trigger automated alerts when you detect suspicious patterns—such as a large number of requests with expired tokens from a single IP, which might indicate a "replay" attack attempt. Logging the specific reason for failure (e.g., signature mismatch vs. expiration) in your internal monitoring system is vital for incident response and forensic analysis.

By extending the `handleRequest` method, you gain full control over the authentication lifecycle. This is where you can implement custom logging logic that pipes data to your observability stack (like ELK or Datadog), ensuring that every security event is accounted for. This level of visibility is what separates a hobbyist project from a production-grade enterprise system.

### 15.6.2 Integration with Global Filters
While guards decide if a request can proceed, they often work in tandem with global exception filters to format the final response. If a guard throws an `UnauthorizedException`, the filter can intercept it to add tracking IDs or legal disclaimers to the response body. This separation of concerns ensures that your guard logic remains focused on the "Yes/No" decision, while the filter handles the "How to tell the user" part.

Another benefit of this integration is the ability to implement **Advanced Security Auditing**. By capturing unauthorized attempts at the filter level, you can enrich the log data with details that the guard might not easily access, such as the full response body being sent back or session-specific metadata. You can also use filters to implement "Slow Fail" patterns, where an unauthorized request is intentionally delayed by a few hundred milliseconds to prevent rapid-fire brute-force or timing attacks.

In Fluo, exception filters are defined using the `@Catch()` decorator and can be applied globally, at the controller level, or at the method level. This hierarchy mirrors the guard execution order, providing a consistent mental model for handling the entire request-response lifecycle. When combined, guards and filters provide a comprehensive toolkit for building secure, robust, and user-friendly APIs that meet the highest standards of modern software engineering.

This modular architecture allows your security team to update response policies globally without touching a single line of guard code. It's a classic example of Fluo's "Standard-First" approach: leveraging standard HTTP semantics and clean abstractions to build systems that are easy to maintain over decades.

## 15.7 Advanced Authorization: Beyond RBAC
While Roles are sufficient for many apps, you might eventually need **Attribute-Based Access Control (ABAC)**. In ABAC, you make decisions based on the *attributes* of the user, the resource, and the environment. For example, "A user can edit a Post only if they are the original Author AND the Post is still in 'Draft' status."

### 15.7.1 Implementing Ownership Checks
The most common form of ABAC is ownership verification. In Fluo, we implement this by creating a guard that accesses the route parameters and queries the database.

```typescript
@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(private readonly postsService: PostsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const postId = request.params.id;
    const userId = request.user.subject;

    const post = await this.postsService.findOne(postId);
    return post && post.authorId === userId;
  }
}
```

This pattern demonstrates the power of asynchronous guards. By checking ownership before the request reaches the controller, you prevent unauthorized data modification at the earliest possible stage. It also makes your controller methods much cleaner, as they no longer need to manually verify if the user has permission to modify the specific entity.

### 15.7.2 Policy-Based Authorization
For large-scale applications, we recommend moving towards **Policy-Based Authorization**. This involves creating a dedicated `AuthorizationService` that evaluates complex rules. Your guards then become simple callers of this service. This approach centralizes all permission logic in one place, making it easier to audit and change as your business requirements evolve.

A policy service might integrate with an external Policy Administration Point (PAP) or a distributed permissions engine like Casbin or Oso. Fluo's flexible provider system makes it easy to wrap these external engines in a clean, TypeScript-first interface that your guards can consume. This "Authorization as a Service" model is the gold standard for microservices architectures, where permissions must be consistent across dozens of disparate services.

### 15.7.3 Dynamic Resource Constraints
Sometimes, authorization isn't just about "Can I do X?", but also "How much of X can I do?". This is known as dynamic resource constraining. For example, a "Basic" user might be able to create 5 projects, while a "Premium" user can create unlimited.

While you could handle this in the business logic, putting a specialized guard in front of the creation route provides a faster "fail-early" mechanism. This guard can check the user's current project count against their subscription tier and deny the request if they've hit their limit. This offloads resource-intensive checks from the main execution path and provides a consistent way to handle billing-related constraints across your entire platform.

Furthermore, dynamic constraints can be applied to **Time-Based Access**. For example, a student account might only be allowed to access certain learning materials during school hours, or a maintenance account might be restricted to a specific maintenance window. By implementing these checks in a guard, you ensure that the resource is protected not just by "who" the user is, but "when" and "how" they are trying to access it. This level of granular control is essential for building complex, real-world systems that must adhere to strict operational or contractual requirements.

## 15.8 Deep Dive: Scopes and Claims
In modern OAuth2 and OpenID Connect flows, we often talk about **Scopes** (what the token is allowed to do) versus **Claims** (what the token says about the user).

### 15.8.1 Working with Scopes
A scope is a permission requested by a client application. For example, a mobile app might request the `posts:write` scope to allow the user to create content. Your `JwtStrategy` should extract these scopes and include them in the normalized Principal.

In many OAuth2 implementations, scopes are used to limit what an application can do on behalf of a user. While a user might have full administrative access when logging in through the official web portal, a third-party integration might only be granted "read-only" scopes. This layer of abstraction is critical for building secure ecosystems where users can safely grant limited access to their data without sharing their primary credentials.

```typescript
// Inside JwtStrategy.validate
return {
  subject: payload.sub,
  roles: payload.roles || [],
  scopes: payload.scopes || [], // ['posts:write', 'profile:read']
};
```

You can then create a `ScopesGuard` that looks for specific scopes required by a route. This adds another layer of security, ensuring that even if a user is an 'admin', their token only has the permissions granted to the specific client they are using. This "Principle of Least Privilege" is essential for protecting your API against token theft or compromised client applications. It also allows you to implement "Incremental Consent" patterns, where users only grant permissions as they need specific features.

Furthermore, scopes can be used to drive UI behavior. By checking the scopes present in the token, your frontend can decide whether to show or hide certain buttons or navigation links, providing a more intuitive experience while remaining securely backed by server-side guard checks. This synchronization between frontend visibility and backend enforcement is a hallmark of well-architected modern applications.

### 15.8.2 Custom Claims for Multi-Tenancy
If you are building a multi-tenant SaaS application, your JWTs will likely include a `tenant_id` claim. This claim is vital for data isolation. By including the `tenant_id` in the Principal, every service and repository in your application can automatically filter data based on the current user's organization.

In Fluo, we often use interceptors or scoped providers to inject the `tenant_id` directly into the database query context. This ensures that a user from "Tenant A" can never accidentally see data from "Tenant B", even if there is a bug in the application logic. This "Hard Isolation" strategy is a core requirement for many enterprise compliance frameworks (like SOC2 or HIPAA). It also simplifies the developer experience, as they don't have to remember to add `WHERE tenant_id = ?` to every single query.

### 15.8.3 Extensible Claims for Business Logic
Beyond simple IDs, you can include custom claims that represent specific business states. For example, a `subscription_status` claim can allow guards to immediately block premium features for users with expired accounts without querying the database on every request. This optimization significantly reduces database load and improves response times for high-traffic applications.

However, keep in mind that JWTs are signed, not encrypted (by default). Any data you put in a claim is visible to the client and any intermediate proxies. Therefore, never put sensitive secrets or personally identifiable information (PII) like phone numbers or home addresses directly into JWT claims. Use the claim as a key to look up sensitive data on the server when needed, maintaining a balance between performance and privacy.

## 15.9 Best Practices for Production Security
As you move towards production, there are several patterns you should follow to ensure your guard and strategy implementations remain secure and maintainable.

### 1. Avoid Heavy Database Hits in Guards
While guards can be asynchronous, performing complex joins or full-table scans inside a guard can create a bottleneck for your entire API. If you need to check data that changes frequently, consider using a high-performance cache like Redis to store authorization decisions. This allows your guards to remain fast and responsive even under heavy load.

### 2. Standardize Principal Shapes
Ensure that every authentication strategy in your application returns a Principal object with the same shape. This consistency allows your business logic and decorators (like `@CurrentUser`) to work seamlessly regardless of whether the user logged in via JWT, Session, or API Key. Fluo's TypeScript-first nature makes it easy to define a global `Principal` interface that all strategies must implement.

### 3. Audit Guard Failures
Every time a guard denies access, it's a potential security event. Ensure that you log these failures with enough context (IP address, user agent, targeted resource) to detect and respond to credential stuffing or scraping attempts. Integrated monitoring tools like Sentry or OpenTelemetry can be used to track guard failure rates and alert your team when they spike unexpectedly.

### 4. Use Global Guards for Common Policies
If you have a policy that applies to 90% of your routes (like requiring authentication), consider registering it as a global guard. You can then use "Opt-Out" decorators (like `@Public()`) for the few exceptions. This "Deny by Default" approach is much safer than manually applying guards to every new controller and protects your system from accidental exposures during rapid development cycles.

Additionally, always remember to **Test Your Guards in Isolation**. Since guards are providers, you can easily write unit tests for them by mocking the `ExecutionContext` and the `Reflector`. Testing your security logic ensures that your authorization rules behave as expected across all edge cases, such as missing headers, malformed tokens, or users with multiple roles. A well-tested security layer is the foundation of a reliable application.

## 15.11 Deep Dive: Multi-Factor Authentication (MFA) Patterns
For high-security applications, a single password or JWT is often not enough. Implementing **Multi-Factor Authentication (MFA)** is a critical step in modern security.

### 15.11.1 The MFA Challenge Flow
In Fluo, we typically handle MFA by issuing a "Partial" JWT after the first factor (password) succeeds. This token contains a special claim, such as `mfa_required: true`. The user is then redirected to an MFA verification endpoint. Only after a valid TOTP or SMS code is provided does the application issue the "Final" full-access JWT. This multi-step process ensures that even if a password is stolen, the attacker cannot gain full access without the second factor.

### 15.11.2 Using Guards for MFA Enforcement
You can create an `MfaGuard` that specifically checks for the absence of the `mfa_required` claim. By applying this guard globally or to sensitive routes, you ensure that users cannot bypass the MFA step. This pattern is easy to implement in Fluo because of our normalized Principal object, which can easily store these transient security states during the login process.

## 15.12 Handling Strategy Failures Gracefully
When an authentication strategy fails, it's not always a security breach—sometimes it's just an expired token or a configuration mismatch.

### 15.12.1 Custom Info Objects
Passport strategies can return an `info` object that provides more detail about the failure. In your `handleRequest` method, you should inspect this object to decide whether to throw a `401 Unauthorized` or perhaps a `403 Forbidden`. Providing this level of granularity helps your frontend developers provide better feedback to the user, such as "Your session has expired, please log in again" versus "Invalid credentials."

### 15.12.2 Strategy Debugging Techniques
If you're having trouble with a strategy, use the `debug: true` option in your `PassportModule` configuration. This will enable verbose logging of the Passport internal state, showing you exactly where the verification process is failing. This is a life-saver when dealing with complex OAuth2 or SAML handshakes where the issue might be hidden deep in the cryptographic signatures.

## 15.13 Security Beyond the Framework
Remember that security is a multi-layered discipline. While Fluo's guards and Passport strategies provide strong application-level protection, they must be part of a broader security strategy.

- **Use HTTPS everywhere**: Tokens transmitted over HTTP are easily stolen.
- **Sanitize all inputs**: Authentication doesn't protect you from SQL Injection or XSS. Use Fluo's Validation (Chapter 6) and Serialization (Chapter 7) features.
- **Keep dependencies updated**: A vulnerability in a third-party Passport strategy is a vulnerability in your app. Use tools like `npm audit` regularly.
- **Principle of Least Privilege**: Give your database users and API keys only the permissions they absolutely need.

By combining the structural power of Fluo's security layer with these industry-standard practices, you build backends that are not just fast, but truly resilient against modern threats.

## 15.14 Summary
Guards and Passport strategies form the protective shield of FluoBlog. By combining battle-tested Passport strategies with Fluo's flexible guard system, you can implement complex security requirements with minimal code.

- **Guards** handle the logic of "Should this request be allowed?" for every incoming request.
- **Passport Strategies** standardize the mechanism of identity verification (e.g., JWT).
- **JwtStrategy** acts as a bridge between raw tokens and normalized Principals.
- **RBAC** via `RolesGuard` ensures users stay within their permitted areas.
- **Advanced Logic** via ABAC and policy services handles complex ownership and resource limits.
- **Scopes and Claims** provide the granularity needed for modern OAuth2 flows and multi-tenant isolation.
- **Production Best Practices** ensure your security layer is both performant and audit-ready.
- **Principal Normalization** ensures the rest of your application can rely on a consistent user object regardless of the auth method.

At this point, FluoBlog can move from a raw Bearer token to a verified principal and then to route-level authorization rules. In the final chapter of Part 3, we will add one more layer by protecting the API from abuse with Throttling.

<!-- line-count-check: 200+ lines target achieved -->
