# auth and jwt

<p><strong><kbd>English</kbd></strong> <a href="./auth-and-jwt.ko.md"><kbd>한국어</kbd></a></p>


This guide explains how the current auth stack is split across Konekti packages.

## package boundary

- `@konekti/jwt` owns JWT token-core contracts, signing, verification, claim validation, and principal normalization
- `@konekti/passport` owns strategy registration metadata, generic auth guard wiring, and strategy adapter contracts
- `@konekti/http` owns guard orchestration, `RequestContext`, and runtime execution order
- `@konekti/config` owns key material and issuer/audience loading

## execution ownership

- token extraction: strategy-owned adapter logic
- signature and claim verification: `JwtVerifier`
- verified principal normalization: `JwtVerifier`
- route-aware auth requirement: passport metadata and auth guard
- principal attachment to `RequestContext`: passport guard path
- HTTP auth error mapping: passport + HTTP exception layer

## current default request flow

```text
HTTP request
-> route-aware auth guard
-> selected auth strategy
-> verified principal
-> RequestContext.principal set
-> controller/service execution
```

## current stance

- JWT is one strategy, not the whole auth model
- `@konekti/passport` is strategy-generic today
- `@konekti/jwt` stays transport-agnostic
- app code should prefer normalized principals over raw JWT payloads

## current shipped JWT scope

- the built-in JWT core supports HMAC algorithms: `HS256`, `HS384`, and `HS512`
- the built-in JWT core supports asymmetric algorithms: `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, and `ES512`
- for asymmetric algorithms, pass `privateKey` and `publicKey` (PEM string or `KeyObject`) to `JwtVerifierOptions`; key-per-kid rotation is supported via the `keys` array

## official default auth story

The current official docs/examples story is bearer-token auth with JWT verification through the `Authorization: Bearer <token>` header.

Explicitly not standardized as framework-wide defaults today:

- HttpOnly cookie auth as the primary official preset
- refresh-token lifecycle and rotation policy
- logout/revoke semantics
- account-linking policy across identity sources

Those remain application-level policy choices. The current framework docs should describe them as app-owned behavior rather than implying a hidden default lifecycle.

## related package docs

- `../../packages/jwt/README.md`
- `../../packages/passport/README.md`
- `../../packages/http/README.md`
