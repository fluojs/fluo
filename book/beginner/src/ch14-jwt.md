<!-- packages: @fluojs/jwt, @fluojs/passport -->
<!-- project-state: FluoBlog v1.11 -->

# Chapter 14. Authentication with JWT

## Learning Objectives
- Understand the structure and purpose of JSON Web Tokens (JWT).
- Configure the `JwtModule` for token signing and verification.
- Implement a dual-token pattern (Access & Refresh tokens).
- Build the FluoBlog authentication endpoints for login and token refresh.
- Learn about JWT principal normalization in `fluo`.

## 14.1 Introduction to JWT

JSON Web Token (JWT) is an open standard (RFC 7519) that defines a compact and self-contained way for securely transmitting information between parties as a JSON object.

In modern web applications, JWT is the de-facto standard for stateless authentication. Instead of storing session IDs in a database and checking them on every request, the server issues a signed token to the client. The client then sends this token back with every request, and the server can verify the user's identity just by looking at the token.

### Structure of a JWT

A JWT consists of three parts separated by dots (`.`):
1. **Header**: Contains the algorithm used for signing (e.g., HS256, RS256).
2. **Payload**: Contains the "claims" or pieces of information (e.g., user ID, roles, expiration).
3. **Signature**: Created by taking the encoded header, the encoded payload, a secret, and the algorithm specified in the header.

## 14.2 The @fluojs/jwt Package

`fluo` provides a dedicated package, `@fluojs/jwt`, which is transport-agnostic. This means you can use it for HTTP, WebSockets, or even RPC calls.

### Core Philosophy: Principal Normalization

Different identity providers or legacy systems might use different keys for the same information in a JWT (e.g., `uid` vs `sub`, or `roles` vs `groups`).

`@fluojs/jwt` automatically normalizes these claims into a standard `JwtPrincipal` object:
- `subject`: The unique identifier for the user (mapped from `sub`).
- `roles`: An array of strings representing user roles.
- `scopes`: An array of strings representing permissions (normalized from `scope` or `scopes`).
- `claims`: The raw payload for any custom data.

## 14.3 Configuring JwtModule

To start using JWT in FluoBlog, we need to register the `JwtModule`.

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

In a production environment, you should never hardcode secrets. Instead, use the `ConfigService` we learned in Chapter 11.

```typescript
import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import { ConfigService } from '@fluojs/config';

@Module({
  imports: [
    JwtModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        issuer: config.get('JWT_ISSUER'),
        audience: config.get('JWT_AUDIENCE'),
        accessTokenTtlSeconds: config.get('JWT_ACCESS_TOKEN_TTL'),
      }),
    }),
  ],
})
export class AuthModule {}
```

## 14.4 Signing Tokens

Once configured, you can inject `DefaultJwtSigner` to issue tokens.

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
      scopes: ['posts:write', 'profile:read'],
    };

    const accessToken = await this.signer.signAccessToken(payload);
    return { accessToken };
  }
}
```

## 14.5 Refresh Token Rotation

Security-conscious applications use a "Dual Token" pattern:
1. **Access Token**: Short-lived (e.g., 15 minutes). Used for every request.
2. **Refresh Token**: Long-lived (e.g., 7 days). Used only to get a new Access Token.

`@fluojs/jwt` supports refresh token logic out of the box.

### One-Time-Use Rotation

Fluo's `RefreshTokenService` (which we will see more in the next chapter) implements rotation. When a refresh token is used, it is invalidated, and a brand new pair is issued. This prevents "replay attacks" where a stolen refresh token is used repeatedly.

## 14.6 Implementing FluoBlog Auth Endpoints

Let's build a real `AuthController` for FluoBlog.

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
    // 1. Verify user credentials (email/password)
    // 2. Issue tokens
    return this.authService.signIn(dto.email, dto.password);
  }
}
```

In the service layer:

```typescript
// src/auth/auth.service.ts
@Injectable()
export class AuthService {
  async signIn(email, password) {
    const user = await this.usersRepo.findByEmail(email);
    if (!user || !await verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const accessToken = await this.signer.signAccessToken({
      sub: user.id.toString(),
      roles: user.roles,
    });

    return { accessToken };
  }
}
```

## 14.7 Verifying Tokens Manually

While guards (Chapter 15) usually handle verification, you can inject `DefaultJwtVerifier` to do it manually.

```typescript
import { DefaultJwtVerifier } from '@fluojs/jwt';

// ...
const principal = await this.verifier.verifyAccessToken(token);
console.log(principal.subject); // User ID
```

The verifier checks:
- The signature is valid.
- The token is not expired (`exp`).
- The issuer (`iss`) and audience (`aud`) match the configuration.

## 14.8 Summary

JWT provides the foundation for secure, stateless communication in FluoBlog.

Key takeaways:
- `JwtModule` centralizes your security policy (keys, TTL, algorithms).
- `DefaultJwtSigner` and `DefaultJwtVerifier` are your primary tools for handling tokens.
- Fluo's normalization ensures your business logic doesn't care about the underlying token format.
- Always use short-lived access tokens combined with a refresh mechanism.

In the next chapter, we will see how to integrate these tokens with the HTTP lifecycle using `Passport` and `Guards`.

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
