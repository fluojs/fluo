# Authentication Ownership Migration

<p><a href="./migrate-auth-ownership.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Scope

이 additive 분리는 기존 import와 runtime 계약을 보존합니다. canonical 소유권을 바꾸지만 인증 정책은 바꾸지 않습니다. 기존 Passport.js bridge, bearer challenge, cookie와 refresh 동작은 유지됩니다.

## Imports

| 책임 | Canonical import | Compatibility |
| --- | --- | --- |
| Principal, neutral AuthStrategy&lt;Context&gt;, 결과와 인증 오류 | `@fluojs/auth` | HTTP Principal과 Passport error/result import 유지 |
| Account-linking 정책과 token | `@fluojs/auth` | 기존 Passport export와 class/token identity 공유 |
| HTTP AuthStrategy, guard, decorator와 등록 | `@fluojs/auth-http` | `@fluojs/passport`의 `AuthStrategy`는 `GuardContext` 입력 유지 |
| Bearer JWT, cookie와 HTTP refresh integration | `@fluojs/auth-http` | 기존 Passport export는 같은 클래스의 alias |
| 서명, 검증, JwtPrincipal과 refresh rotation/replay | `@fluojs/jwt` | 변경 없음 |
| Passport.js provider bundle과 action binding | `@fluojs/passport` | 변경 없음 |

```ts
import { type Principal, AuthenticationFailedError } from '@fluojs/auth';
import { AuthModule, type AuthStrategy, UseAuth } from '@fluojs/auth-http';
import { createPassportJsStrategyBridge } from '@fluojs/passport';
```

일반 HTTP import를 Passport에서 auth-http로 바꾸고 `AuthModule.forRoot(...)`를 사용하세요. `AuthModule === PassportModule`이며 애플리케이션 클래스도 AuthModule이라면 import alias나 다른 local 이름을 사용하세요. 같은 registry에 두 module을 함께 등록하지 마세요. cookie 조합은 계속 하나의 `CookieAuthModule.forRoot(config, options, additionalStrategies)`를 사용합니다.

## Identity and dependency direction

neutral root는 core만 의존합니다. HTTP와 JWT는 공유 mutable Principal을 소비하고 JwtPrincipal은 검증된 claim 정규화를 축소하지 않고 이를 확장합니다. auth-http는 auth, HTTP, JWT, DI, runtime을 소비합니다. Passport는 bridge와 compatibility export를 위해 adapter를 소비합니다. auth의 역방향 의존성이나 package 간 cycle은 없습니다.

이전·새 class token, decorator metadata와 error를 같은 애플리케이션에서 혼합할 수 있습니다. guard service identity, legacy `@fluojs/passport` error owner/version, `Symbol.for` key를 유지합니다. `isAuthError`는 `isPassportError`의 alias이며 관련 없는 code-string lookalike와 incompatible copy는 여전히 거부합니다.

## Behavior and limits

neutral strategy가 새 protocol을 자동 지원하지는 않습니다. HTTP custom strategy는 `authenticate(GuardContext)`를 유지하며 상속이 필요하지 않습니다. optional auth는 scopes 없는 명시적 unauthenticated 결과가 필요하고 bearer missing credential은 여전히 throw합니다. committed handled 결과는 terminal입니다. roles는 정규화·전달하지만 자동 인가하지 않습니다.

JWT는 계속 crypto, key, claim, refresh store/rotation/replay를 소유합니다. `RefreshTokenModule.forRoot()`는 기존 service를 alias합니다. custom refresh port도 JWT access-token 검증이 필요합니다. Passport.js action, raw request delegation, timeout, shutdown cancellation은 bridge 소유이며 middleware/session augmentation은 추가하지 않습니다.

[auth](../../packages/auth/README.ko.md), [auth-http](../../packages/auth-http/README.ko.md), [Auth & JWT Contract](../architecture/auth-and-jwt.ko.md), canonical [예제](../../examples/auth-jwt-passport)를 참고하세요.
