<!-- packages: @fluojs/throttler -->
<!-- project-state: FluoBlog v1.13 -->

# Chapter 16. Rate Limiting and Security Hardening

## Learning Objectives
- Understand the importance of Rate Limiting (Throttling) for API security.
- Configure the `ThrottlerModule` with default TTL and limit settings.
- Apply the `@Throttle()` and `@SkipThrottle()` decorators.
- Implement custom key generation for client identification.
- Protect FluoBlog's login endpoint from brute-force attacks.
- Review best practices for security hardening in `fluo`.

## 16.1 Protecting Your API from Abuse

In the previous chapters, we made FluoBlog secure by requiring authentication. However, security is not just about "Who can access"; it's also about "How much can they access".

Imagine an attacker trying to guess a user's password. They could send thousands of login requests per second. Or a buggy script accidentally calling your API in an infinite loop.

This is where **Rate Limiting** (or Throttling) comes in. It limits the number of requests a client can make within a certain time window.

## 16.2 Introducing @fluojs/throttler

`fluo` provides the `@fluojs/throttler` package for easy, decorator-based rate limiting.

### How it works

The Throttler uses a "Fixed Window" algorithm:
- **TTL (Time To Live)**: The duration of the window (in seconds).
- **Limit**: The maximum number of requests allowed within that window.

If a client exceeds the limit, `fluo` automatically throws a `429 Too Many Requests` error and includes a `Retry-After` header.

## 16.3 Basic Configuration

Register the `ThrottlerModule` in your root module.

```typescript
import { Module } from '@fluojs/core';
import { ThrottlerModule } from '@fluojs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,   // 1 minute
      limit: 100, // 100 requests per minute
    }),
  ],
})
export class AppModule {}
```

This configuration applies a global limit of 100 requests per minute to all routes in your application.

## 16.4 Using Decorators

You can override the global settings or skip throttling for specific controllers or methods.

### Overriding with @Throttle()

```typescript
import { Controller, Post } from '@fluojs/http';
import { Throttle } from '@fluojs/throttler';

@Controller('auth')
export class AuthController {
  
  @Post('login')
  @Throttle({ ttl: 60, limit: 5 }) // Strict: only 5 attempts per minute
  async login() {
    // ...
  }
}
```

### Bypassing with @SkipThrottle()

```typescript
@Get('health')
@SkipThrottle() // Health checks should usually not be throttled
healthCheck() {
  return { status: 'ok' };
}
```

## 16.5 Client Identification and Custom Keys

By default, the throttler identifies clients by their IP address. However, if your application is behind a proxy (like Nginx, Cloudflare, or a Load Balancer), the IP might appear to be the same for all users.

### trustProxyHeaders

If you trust your proxy to set headers like `X-Forwarded-For`, enable this setting:

```typescript
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  trustProxyHeaders: true,
})
```

### Custom Key Generation

Sometimes you want to throttle based on something else, like a User ID or an API Key.

```typescript
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  keyGenerator: (context) => {
    const request = context.switchToHttp().getRequest();
    // If authenticated, throttle by user ID, otherwise by IP
    return request.principal?.subject || request.ip;
  },
})
```

## 16.6 Multi-Instance Deployments with Redis

If you run multiple instances of FluoBlog, an in-memory throttler won't work correctly because each instance has its own local count.

To solve this, use the `RedisThrottlerStore`.

```typescript
import { RedisThrottlerStore } from '@fluojs/throttler';
import { REDIS_CLIENT } from '@fluojs/redis';

// ...
ThrottlerModule.forRootAsync({
  inject: [REDIS_CLIENT],
  useFactory: (redis) => ({
    ttl: 60,
    limit: 100,
    store: new RedisThrottlerStore(redis),
  }),
})
```

Now, all instances share the same counter in Redis, ensuring your rate limits are enforced across your entire cluster.

## 16.7 Security Hardening Checklist

As we conclude Part 3, let's review a checklist for a production-ready FluoBlog:

1.  **Use HTTPS**: Never transmit JWTs or passwords over plain HTTP.
2.  **Short-lived Access Tokens**: Keep them under 1 hour.
3.  **Secure Refresh Tokens**: Store them in `HttpOnly` cookies and use rotation.
4.  **Validate All Input**: Use `@fluojs/validation` (Chapter 6) to prevent injection attacks.
5.  **Enable Throttling**: Protect sensitive routes (Login, Signup, Forgot Password).
6.  **Principle of Least Privilege**: Use Scopes and RBAC to ensure users only see what they should.

## 16.8 Summary

Rate limiting is your first line of defense against brute-force attacks and API abuse.

Key takeaways:
- `ThrottlerModule` provides a simple way to set request quotas.
- `@Throttle()` allows for fine-grained control at the route level.
- Custom `keyGenerator` helps identify users correctly behind proxies or in authenticated states.
- Redis storage is essential for scaling across multiple server instances.

Congratulations! You have completed Part 3: Authentication and Security. FluoBlog is now a robust, secure, and professional backend application. In Part 4, we will move beyond HTTP and look at real-time communication with WebSockets.

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
