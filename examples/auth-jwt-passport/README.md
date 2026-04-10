# auth-jwt-passport example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Runnable fluo authentication example that combines `@fluojs/jwt` and `@fluojs/passport` around the simplest official bearer-token flow.

## what this example demonstrates

- issuing access tokens with `DefaultJwtSigner`
- protecting a route with `@UseAuth('jwt')` and `@RequireScopes(...)`
- verifying bearer tokens through a custom `AuthStrategy`
- explicit DI token metadata instead of reflection-based injection
- runtime-owned `/health` and `/ready` endpoints alongside auth routes
- unit, integration, and e2e-style testing with `@fluojs/testing`

## routes

- `POST /auth/token` — issues a demo access token for a username
- `GET /profile/` — protected route that requires bearer auth and `profile:read`
- `GET /health`
- `GET /ready`

## how to run

From the repository root:

```sh
pnpm install
pnpm vitest run examples/auth-jwt-passport
```

## project structure

```text
examples/auth-jwt-passport/
├── src/
│   ├── app.ts
│   ├── main.ts
│   ├── app.test.ts
│   └── auth/
│       ├── auth.module.ts
│       ├── auth.controller.ts
│       ├── auth.service.ts
│       ├── bearer.strategy.ts
│       └── login.dto.ts
└── README.md
```

## recommended reading order

1. `src/auth/login.dto.ts` — explicit request boundary
2. `src/auth/auth.service.ts` — JWT issuance
3. `src/auth/bearer.strategy.ts` — bearer token verification through passport core
4. `src/auth/auth.controller.ts` — open token route + protected profile route
5. `src/auth/auth.module.ts` — provider registration for JWT + passport
6. `src/app.test.ts` — integration and e2e-style verification

## related docs

- `../README.md` — official examples index
- `../../docs/getting-started/first-feature-path.md`
- `../../docs/concepts/auth-and-jwt.md`
- `../../packages/jwt/README.md`
- `../../packages/passport/README.md`
