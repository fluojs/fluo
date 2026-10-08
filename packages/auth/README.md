# @fluojs/auth

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Transport-neutral identity, authentication results, strategy contracts and account-linking policy. Node.js support is `>=24.0.0 <27`; the root depends only on `@fluojs/core` and does not load HTTP, JWT, Passport.js or runtime orchestration.

## Installation

```sh
pnpm add @fluojs/auth
```

## Public imports and usage

```ts
import { type AuthStrategy, type Principal } from '@fluojs/auth';

class ServiceStrategy implements AuthStrategy<{ identity: string }> {
  authenticate(input: { identity: string }): Principal {
    return { subject: input.identity, claims: {} };
  }
}
```

`AuthStrategy<Context = unknown>` parameterizes the input without imposing inheritance or a transport. `AuthStrategyResult` is a `Principal`, `{ authenticated: false }`, or `{ handled: true, principal?: Principal }`. The adapter, not this package, decides whether absence or completion permits execution. HTTP applications use the `GuardContext` specialization from `@fluojs/auth-http`.

`Principal` retains mutable `subject: string`, `claims: Record<string, unknown>`, and optional `issuer`, `audience: string | string[]`, `roles: string[]`, and `scopes: string[]`. HTTP re-exports this type; `JwtPrincipal` extends it while JWT verification still owns claim validation and normalization.

## Account linking

`createConservativeAccountLinkPolicy()` and `resolveAccountLinking(context, policy?, options?)` evaluate application-supplied identity and candidates. Existing links are deduplicated; ambiguous candidates produce `AccountLinkConflictError` with `candidateAccountIds`. Explicit linking requires user confirmation and a valid target. Without a policy, the default resolution is skipped; explicit `fallback: 'create-account'` requests account creation. `AccountLinkRejectedError` preserves rejection codes.

`ACCOUNT_LINKING_POLICY`, `AccountIdentity`, `AccountLinkContext`, `AccountLinkPolicy`, decision and resolution types support application-owned persistence. The package does not create, merge or persist accounts, discover providers or collect consent.

## Errors and compatibility

`AuthenticationRequiredError`, `AuthenticationFailedError`, `AuthenticationExpiredError`, and `AuthStrategyResolutionError` are the same classes re-exported by `@fluojs/passport`. `isAuthError` is the same function as legacy `isPassportError`; compatible duplicate copies retain the versioned `@fluojs/passport` error owner. A matching code alone is not sufficient. The account-linking token keeps its existing `Symbol.for` key.

## Ownership and evidence

`auth -> core`; HTTP and JWT consume auth identity; `auth-http` owns HTTP execution; Passport owns Passport.js action binding. No dependency points from auth back to those integrations.

See [Auth & JWT Contract](../../docs/architecture/auth-and-jwt.md), [migration](../../docs/getting-started/migrate-auth-ownership.md), [`runtime-boundary.test.ts`](./src/runtime-boundary.test.ts), and the legacy [account-linking regressions](../passport/src/account/account-linking.test.ts).
