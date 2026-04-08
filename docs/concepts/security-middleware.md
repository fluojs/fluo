# Security & Middleware

<p><strong><kbd>English</kbd></strong> <a href="./security-middleware.ko.md"><kbd>한국어</kbd></a></p>

A secure backend is built in layers. Konekti provides transport-level security middleware and application-level throttlers to protect your system from common web vulnerabilities, malicious bots, and resource exhaustion.

## Why Security Middleware in Konekti?

- **Defense in Depth**: Protect your application at the earliest stage of the request journey, before any expensive business logic or database queries are executed.
- **Consistent Protection**: Apply security headers (CORS, CSP, HSTS, etc.) globally across all routes with a single configuration, ensuring no "shadow endpoints" are left vulnerable.
- **Granular Throttling**: Combine broad IP-based rate limiting with specific, user-driven limits (e.g., "Max 5 password resets per hour") using decorators.
- **Platform Agnostic**: Our security middleware works across Fastify, Node.js, Bun, and Deno, providing the same protection regardless of your deployment target.

## Responsibility Split

- **`@konekti/http` (Infrastructure Protection)**: Contains core middleware like `createCorsMiddleware`, `RateLimitMiddleware`, and security header injectors. These provide a baseline "shield" for the entire application.
- **`@konekti/throttler` (Application Protection)**: A more refined system for logic-driven limits. It uses decorators to protect specific methods and can store hit counts in shared Redis instances.
- **`@konekti/passport` (Identity Protection)**: Manages the authentication layer, ensuring that security middleware can differentiate between anonymous and authenticated traffic.

## Typical Workflows

### 1. Global Transport Protection
Configure baseline security during application bootstrap.

```typescript
const app = await bootstrapNodeApplication(AppModule);
app.use(createCorsMiddleware({ origin: '*' }));
app.use(new RateLimitMiddleware({ max: 100, windowMs: 60000 }));
```

### 2. Method-Level Throttling
Use the throttler for sensitive business actions that require stricter limits than the global baseline.

```typescript
@Post('/reset-password')
@Throttle({ default: { limit: 5, ttl: 3600000 } })
async resetPassword(@FromBody() dto: ResetDto) {
  // Logic...
}
```

### 3. Automated Security Headers
Konekti ensures every response carries the necessary metadata to instruct the browser on security policies.
- **Strict-Transport-Security**: Force HTTPS.
- **X-Content-Type-Options**: Prevent MIME sniffing.
- **Content-Security-Policy**: Control resource loading.

## Core Boundaries

- **Transport vs. Application**: 
  - **Middleware** (Transport) is fast and stops malicious traffic early (e.g., DDoS protection).
  - **Interceptors/Decorators** (Application) are smart and understand the user's identity and intent.
- **Stateless by Default**: Rate limiting in the HTTP package is memory-based (stateless per instance). For distributed environments, you **must** use the Redis-backed `@konekti/throttler`.
- **The "Fail-Fast" Rule**: Security checks always run before validation and business logic. A throttled request never hits your service code.

## Next Steps

- **HTTP Security**: Explore the security helpers in the [HTTP Package README](../../packages/http/README.md).
- **Advanced Throttling**: Configure distributed limits with the [Throttler Package](../../packages/throttler/README.md).
- **Authentication**: Connect security with identity via the [Auth & JWT Guide](./auth-and-jwt.md).
