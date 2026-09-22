# Package-guide workstream fixtures: jwt, passport, throttler (security)

Evidence fixtures for the three package guides this workstream owns:

- `apps/docs/content/docs/packages/jwt.mdx`
- `apps/docs/content/docs/packages/passport.mdx`
- `apps/docs/content/docs/packages/throttler.mdx`

Machine-readable summary: `evidence.json` (repository-relative paths, actual results only).

## Files

| File | Purpose |
| --- | --- |
| `jwt-guide-app.ts` | Complete example from the JWT guide: `JwtModule.forRoot` + `TokenService` consuming `JwtService` through explicit `@Inject` tokens. |
| `jwt-guide.test.ts` | Real sign/verify round trip through the registered providers: principal normalization (`scope` string and `scopes` array), per-call `expiresIn` override over payload `exp`, audience mismatch, expiry, missing subject, `decode()` diagnostics boundary. |
| `passport-guide-app.ts` | Complete example from the Passport guide: bearer preset (exact guide wiring), optional-auth route, custom `ApiKeyStrategy`, and an unregistered-strategy route. |
| `passport-guide.test.ts` | Guard pipeline through `Test.createApp`: 401 with `WWW-Authenticate: Bearer`, 200 with scope, 403 envelope for scope misses, expired-token 401 with `error="invalid_token"` challenge, malformed credential, optional-auth bearer boundary (anonymous stays 401), custom strategy, unregistered strategy name → 500. |
| `cookie-guide-app.ts` | Cookie-auth preset composition: `CookieAuthModule.forRoot` with combined registry (cookie default + bearer registration), login/logout via `CookieManager`, guest variant with `requireAccessToken: false`. |
| `cookie-guide.test.ts` | Strict-default `Set-Cookie` attributes (`Path=/sessions`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Max-Age=900`), cookie-carried authentication through the real pipeline, expired-cookie 401, guard-level classification of missing vs malformed cookies (`UnauthorizedException` cause chain), guest strategy `{ authenticated: false }` vs malformed failure. |
| `security-guide-app.ts` | Cross-package composition: `JwtModule.forRoot({ global: true, refreshToken })` owning crypto/store, `RefreshTokenModule.forRoot()` aliasing the JWT-owned service, `PassportModule.forRoot` with bearer + refresh-token registrations, `ThrottlerModule.forRoot` with an API-key `keyGenerator`. |
| `security-guide.test.ts` | Credential lifecycle: login mints access/refresh pair, refresh strategy rotates, replay of the consumed token → 401 and family revocation kills the successor → 401, unknown token → 401, 429 + `Retry-After` after route budget with per-client bucket isolation, `@SkipThrottle` exemption, missing key-generator identity → 500, `RedisThrottlerStore` structural-client contract. |

## Commands and results

Recorded on this worktree (`docs-foundation`), Node v24.20.0, pnpm 10.4.1, vitest 4.1.11 (darwin-arm64).

```
pnpm vitest run --project tooling tooling/docs/fixtures/package-guides/security --maxWorkers=1
# exit 0 — Test Files 4 passed (4), Tests 27 passed (27)

pnpm exec tsc -p tsconfig.tools.json --noEmit
# exit 2 overall, but 0 errors under tooling/docs/fixtures/package-guides/security;
# remaining errors are in other workstreams' fixture dirs (native-platforms, transports)
# and were not touched.

node tooling/docs/verify-package-guides.mjs
# run after evidence.json was written; see commands below for the result
```

No fixed sleeps, polling delays, or wall-clock waits appear in any fixture: rate-limit windows
advance on consume, expiry is produced by minting tokens with past `exp` claims, and every
app, module, and container is closed in `finally`.

## Per-package source and contract evidence

### @fluojs/jwt

- Contract: `packages/jwt/README.md` (forRoot/forRootAsync, configuration guardrails, refresh
  lifecycle, Node runtime boundary, decode trust boundary, migration list).
- Source: `packages/jwt/src/index.ts` (export surface), `src/module.ts` (`forRoot` registers
  `JWT_OPTIONS`, `DefaultJwtSigner`, `DefaultJwtVerifier`, `JwtService`, and — always, in both
  registration paths — a `RefreshTokenService` provider that throws `JwtConfigurationError` at
  resolution when `refreshToken` is unconfigured; `global` defaults `false`), `src/service.ts`
  (`SignOptions` claim-override precedence, duration parsing, `decode` three-segment check),
  `src/signing/signer.ts` (first-supported-algorithm selection, TTL default `3600`,
  `accessTokenTtlSeconds` validation at sign time, `kid` header from `keys[]`),
  `src/signing/verifier.ts` (verification order, key-source precedence, claim validation with
  clock skew and equality-expired boundary, scope/scope unification, refresh verification
  options requiring an HMAC algorithm at construction), `src/signing/jwks.ts` (defaults
  `600_000`/`5_000`/`100`, eviction, dispose), `src/refresh/refresh-token.ts` (store contract,
  atomic `rotate` vs `consume`+`save`, replay → family/subject revocation),
  `src/errors.ts` (error codes), `src/types.ts`.
- Also read: `packages/jwt/src/module-async-visibility.test.ts` (forRootAsync global-visibility
  contract), `packages/jwt/src/module.test.ts`, `signing/verifier.test.ts`,
  `refresh/refresh-token.test.ts` for behavior cross-checks.
- Verified in fixtures: normalization, per-call overrides, expiry/audience/subject failures with
  typed errors, `decode` null. Guide fragments mirror `jwt-guide-app.ts` and `jwt-guide.test.ts`.

### @fluojs/passport

- Contract: `packages/passport/README.md` (module wiring, bearer strictness, cookie preset,
  refresh ownership, bridge settlement contract, account linking, migration).
- Source: `src/index.ts`, `src/module.ts` (registry build, duplicate-name throw at `forRoot`
  call time, only `AuthGuard` exported, `global` default `false`), `src/guard.ts` (requirement
  resolution, per-request strategy resolution from the request container, result variants,
  principal validation, scope → `ForbiddenException`, `UnauthorizedException` wrapping with
  `cause`, `handled` requires committed response), `src/decorators.ts` + `src/metadata.ts` +
  `src/scope.ts` (decorator metadata, class/method merge, optional semantics),
  `src/bearer/bearer-jwt.ts` (RFC 6750 `b64token` grammar, challenge headers, typed error
  mapping with `cause`), `src/cookie/cookie-auth.ts` + `cookie-auth-module.ts` +
  `cookie-manager.ts` (single registry recipe, defaults `Path=/ Secure HttpOnly SameSite=Strict`,
  TTL precedence positional → per-token → `maxAge`, append-only `Set-Cookie`, missing-vs-malformed
  classification, `requireAccessToken: false` → `{ authenticated: false }`),
  `src/refresh/refresh-token.ts` (`REFRESH_TOKEN_SERVICE` `useExisting` alias, extraction order
  `body.refreshToken` → `Authorization: Bearer` → `x-refresh-token`, `RefreshTokenPrincipal`
  shape), `src/adapters/passport-js.ts` (settle-exactly-once state machine, `actionTimeoutMs`
  default `30_000`, `RangeError` on invalid values), `src/account/account-linking.ts`
  (conservative policy + `resolveAccountLinking` mapping), `src/errors.ts`, `src/types.ts`.
- Also read: `packages/passport/src/cookie/cookie-auth-module.integration.test.ts` (guard-level
  synthetic-context pattern reused here), `src/guard.test.ts`, `src/bearer/bearer-jwt.guard.test.ts`.
- Verified in fixtures: full 401/403/200 matrix, challenge headers, cookie attributes and
  classification, combined registry, unregistered strategy → 500. Bridge and account-linking
  sections are source/README-derived; the bridge is not fixture-executed (see gaps).

### @fluojs/throttler

- Contract: `packages/throttler/README.md` (guard-stage model, seconds-not-milliseconds,
  NestJS migration boundaries, key/identity rules, store contracts).
- Source: `src/index.ts` (barrel: metadata helpers exported, `THROTTLER_OPTIONS` not),
  `src/module.ts` (validation + registration, `global` default `true`, exports `ThrottlerGuard`),
  `src/validation.ts` (positive finite integers, trustProxy/keyGenerator/store checks, options
  captured by value), `src/guard.ts` (method > class > module policy with per-handler WeakMap
  cache, `throttler:<handlerKey>:<clientKey>` store key with compiled-route identity,
  `Retry-After` from `retryAfterMs` or `resetAt`, `TooManyRequestsException` with meta),
  `src/store.ts` (per-instance memory store, lazy sweep), `src/redis-store.ts` (atomic Lua
  `EVAL`, Redis `TIME` clock anchor, `PX` remaining-window expiry, structural
  `RedisThrottlerClient`), `src/decorators.ts` (TC39 standard decorators, validation at
  class-definition time), `src/tokens.ts`, `src/types.ts`, `src/status.ts`.
- Also read: `packages/throttler/src/module.test.ts` (guard integration and public-surface
  expectations), `redis-store.test.ts` (server-time anchoring expectations).
- Verified in fixtures: 429 + `Retry-After` through the real pipeline, per-client bucket
  isolation, skip exemption, missing-identity throw, `RedisThrottlerStore` consume parsing and
  script arguments against a structural client.

## Behaviors discovered while authoring (documented in the guides)

- `@UseOptionalAuth` only bypasses strategies that *report* missing credentials
  (`{ authenticated: false }`). The bearer preset raises `AuthenticationRequiredError`, so an
  optional route on `'jwt'` still returns 401 for anonymous callers; the cookie preset reports
  only with `requireAccessToken: false`. Pinned by `passport-guide.test.ts` and
  `cookie-guide.test.ts`.
- An unregistered strategy name is a wiring defect: `AuthStrategyResolutionError` surfaces as
  HTTP 500 (`INTERNAL_SERVER_ERROR`), not 401. Pinned by `passport-guide.test.ts`.
- POST routes default to HTTP 201 in the fluo HTTP layer; fixtures pin 201.
- The test client merges multiple `Set-Cookie` writes into an array under one header key;
  logout assertions read all values.
- The lead-owned `tsconfig.tools.json` catch-all `@fluojs/*` path mapping typechecks fixtures
  against `packages/*/dist/index.d.ts`; no subpath imports are used by these fixtures.

## Not executed (explicit gaps)

- Real Redis server: the `RedisThrottlerStore` fixture test verifies the structural client
  contract and Lua-script shape, not live Redis connectivity or cross-process window sharing.
  The package's own tests use the same mock level; no fixture infrastructure for a native Redis
  was exercised in this workstream (Docker was available but the claim does not require it).
- Passport.js bridge against a real `passport-*` strategy: documented from
  `src/adapters/passport-js.ts` and the README; no third-party strategy was installed or run.
- Account-linking flows: `createConservativeAccountLinkPolicy` / `resolveAccountLinking`
  documented from source; not fixture-executed.
- Status/diagnostic helpers (`create*PlatformStatusSnapshot`, `create*PlatformDiagnosticIssues`)
  for all three packages: documented from source and status tests; not fixture-executed here.
- Remote JWKS fetches (network identity provider), Deno/Workers execution (unsupported by
  contract), and `forRootAsync` with `@fluojs/config` end to end (the async registration shape
  is documented from `src/module.ts` and `module-async-visibility.test.ts`; the fixture uses
  the synchronous path).
- Guide prose fragments (bridge, account-linking, account-link examples) are source-derived and
  shaped by the compiled fixture apps, but not every inline fragment was separately compiled.
