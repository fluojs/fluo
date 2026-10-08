# @fluojs/auth

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

transport-neutral identity, 인증 결과, 전략 계약과 account-linking 정책을 소유합니다. Node.js 지원 범위는 `>=24.0.0 <27`이며 root는 `@fluojs/core`만 의존하고 HTTP, JWT, Passport.js나 runtime orchestration을 로드하지 않습니다.

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

`AuthStrategy<Context = unknown>`는 상속이나 transport를 강제하지 않고 입력을 parameterize합니다. `AuthStrategyResult`는 `Principal`, `{ authenticated: false }`, 또는 `{ handled: true, principal?: Principal }`입니다. 부재나 완료가 실행을 허용하는지는 이 패키지가 아니라 adapter가 판정합니다. HTTP 애플리케이션은 `@fluojs/auth-http`의 `GuardContext` specialization을 사용합니다.

`Principal`은 mutable `subject: string`, `claims: Record<string, unknown>`과 optional `issuer`, `audience: string | string[]`, `roles: string[]`, `scopes: string[]`를 유지합니다. HTTP는 이 타입을 re-export하고 `JwtPrincipal`은 이를 확장하지만 claim 검증과 정규화는 계속 JWT가 소유합니다.

## Account linking

`createConservativeAccountLinkPolicy()`와 `resolveAccountLinking(context, policy?, options?)`는 애플리케이션이 제공한 identity와 candidate를 평가합니다. 기존 link는 deduplicate하며 모호한 candidate는 `candidateAccountIds`가 있는 `AccountLinkConflictError`를 발생시킵니다. 명시적 linking에는 사용자 확인과 유효한 target이 필요합니다. policy가 없으면 기본 resolution은 skipped이며 명시적 `fallback: 'create-account'`가 account 생성을 요청합니다. `AccountLinkRejectedError`는 rejection code를 보존합니다.

`ACCOUNT_LINKING_POLICY`, `AccountIdentity`, `AccountLinkContext`, `AccountLinkPolicy`, decision과 resolution 타입은 애플리케이션 소유 persistence를 지원합니다. 패키지는 account 생성·병합·저장, provider 탐색이나 consent 수집을 수행하지 않습니다.

## Errors and compatibility

`AuthenticationRequiredError`, `AuthenticationFailedError`, `AuthenticationExpiredError`, `AuthStrategyResolutionError`는 `@fluojs/passport`가 re-export하는 것과 같은 클래스입니다. `isAuthError`는 legacy `isPassportError`와 같은 함수이며 compatible duplicate copy는 versioned `@fluojs/passport` error owner를 유지합니다. code만 일치하는 것으로는 충분하지 않습니다. account-linking token도 기존 `Symbol.for` key를 유지합니다.

## Ownership and evidence

`auth -> core`이며 HTTP와 JWT는 auth identity를 소비합니다. `auth-http`가 HTTP 실행을, Passport가 Passport.js action binding을 소유합니다. auth에서 integration으로 돌아가는 의존성은 없습니다.

[Auth & JWT Contract](../../docs/architecture/auth-and-jwt.ko.md), [마이그레이션](../../docs/getting-started/migrate-auth-ownership.ko.md), [`runtime-boundary.test.ts`](./src/runtime-boundary.test.ts), 기존 [account-linking 회귀](../passport/src/account/account-linking.test.ts)를 참고하세요.
