# @fluojs/auth-http

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

`@fluojs/auth`의 HTTP 인증 adapter입니다. Node.js 지원 범위는 `>=24.0.0 <27`입니다. 이 명시적 integration은 auth, core, DI, HTTP, JWT, runtime에 의존하며 concrete integration 없이 identity와 policy가 필요하면 neutral auth root를 사용하세요.

## Installation

```sh
pnpm add @fluojs/auth-http @fluojs/jwt
```

## Public imports and registration

```ts
import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import {
  AuthModule, BearerJwtStrategy, createBearerJwtStrategyRegistration,
} from '@fluojs/auth-http';

@Module({
  imports: [
    JwtModule.forRoot({ algorithms: ['HS256'], secret: 'application-owned-secret' }),
    AuthModule.forRoot({ defaultStrategy: 'jwt' }, [createBearerJwtStrategyRegistration()]),
  ],
  providers: [BearerJwtStrategy],
})
export class ApplicationAuthModule {}
```

`AuthModule`은 legacy `PassportModule`과 같은 class token입니다. `forRoot(options?, strategies?)`는 application-local registry 하나를 만들며 중복 이름을 거부하고 prototype-shadowing 이름을 지원합니다. `AuthGuard`만 export하고 내부 registry/options token은 공개하지 않습니다. `global` 기본값은 `false`입니다. custom provider는 이 module을 import하는 애플리케이션 module에 등록하세요. HTTP `AuthStrategy`는 neutral `AuthStrategy<GuardContext>`의 specialization이며 base class를 요구하지 않습니다.

## Guards and results

`UseAuth`, `UseOptionalAuth`, `RequireScopes`, `defineAuthRequirement`, `getAuthRequirement`는 HTTP metadata를 소유합니다. guard는 request container에서 strategy를 resolve하고 principal shape과 모든 scope를 검증합니다. canonical 401의 원래 cause를 보존하고 scope 누락은 403을 반환합니다. roles는 검증·전달하며 새 authorization policy를 만들지 않습니다. method mandatory auth는 class optional auth를 override하고 class/method scopes는 merge합니다.

optional route는 required scopes가 없을 때 명시적인 `{ authenticated: false }`만 허용합니다. missing-credential throw는 여전히 실패합니다. `{ handled: true }`는 response commit 뒤에만 terminal이며 principal이 함께 있어도 validation·assignment·scope enforcement·handler 실행을 건너뜁니다. commit 없는 완료는 인증 실패입니다.

## Bearer, cookie and refresh

`BearerJwtStrategy`, `BEARER_JWT_STRATEGY_NAME` (`jwt`), `createBearerJwtStrategyRegistration`은 RFC 6750 b64token parsing, case-insensitive header/scheme, ASCII spaces, 첫 array entry를 유지합니다. missing/malformed credential은 bare `WWW-Authenticate: Bearer`, expired/invalid JWT는 원래 JWT cause와 `Bearer error="invalid_token"`을 반환합니다. infrastructure/configuration error는 변경 없이 전파합니다.

`CookieAuthModule.forRoot(config?, options?, additionalStrategies?)`는 registry 하나와 공유 cookie reader/writer 설정을 소유합니다. `CookieAuthStrategy`는 `requireAccessToken: false`일 때만 missing cookie를 허용하며 malformed present cookie를 anonymous로 바꾸지 않습니다. unknown verifier failure는 기존 authentication-required wrapping을 유지합니다. `CookieManager.create(config?)`와 DI class token은 Secure/HttpOnly/SameSite 기본값, 초 단위 TTL 우선순위, encoding/validation, 순서 있는 Set-Cookie append와 clear를 유지합니다.

`RefreshTokenModule.forRoot()`는 두 번째 store·service·crypto 설정을 만들지 않고 정확히 JWT 소유 `RefreshTokenService`를 alias합니다. `RefreshTokenStrategy`는 `body.refreshToken`, Authorization bearer, `x-refresh-token` 순서로 읽으며 malformed present body에는 fallback하지 않습니다. 네 메서드의 `RefreshTokenServicePort`는 애플리케이션 소유 custom service를 지원하지만 rotated access token과 normalized subject에는 여전히 JWT verifier가 필요합니다. rotation, replay, revocation, algorithm과 key는 JWT 책임입니다.

## Passport and compatibility

`@fluojs/passport`의 `createPassportJsStrategyBridge`를 사용하고 named strategy와 provider를 이 module 또는 cookie module의 additional strategies에 등록하세요. bridge는 request-local action binding과 lifecycle cancellation을 소유하며 Passport middleware/session augmentation은 제공하지 않습니다.

기존 `@fluojs/passport` import는 이 클래스·decorator·error의 alias로 유지됩니다. framework service identity, metadata key, `Symbol.for` token과 compatible duplicate-copy guard resolution도 유지합니다. `AuthModuleOptions`는 `PassportModuleOptions`와 같습니다. [마이그레이션](../../docs/getting-started/migrate-auth-ownership.ko.md)을 참고하세요.

## Evidence

[Auth & JWT Contract](../../docs/architecture/auth-and-jwt.ko.md), [실행 예제](../../examples/auth-jwt-passport), [`auth-http.compatibility.test.ts`](../passport/src/auth-http.compatibility.test.ts), 기존 [Passport 회귀 suite](../passport/src)가 canonical과 compatibility 동작을 검증합니다.
