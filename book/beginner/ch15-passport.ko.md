<!-- packages: @fluojs/passport, @fluojs/jwt -->
<!-- project-state: FluoBlog v1.12 -->

# Chapter 15. Guards and Passport Strategies

이 장은 FluoBlog의 인증 흐름을 가드와 Passport 전략으로 연결하는 방법을 설명합니다. Chapter 14가 JWT 발급과 검증을 다뤘다면, 이 장은 그 토큰을 실제 라우트 보호와 인가 규칙으로 확장합니다.

## Learning Objectives
- `fluo` 요청 생명주기에서 가드의 역할을 이해합니다.
- `@fluojs/passport`로 인증 전략을 구성합니다.
- 커스텀 `AuthStrategy`로 토큰을 검증하고 principal을 구성합니다.
- `@UseAuth()`로 라우트와 컨트롤러를 보호합니다.
- `RolesGuard`로 역할 기반 인가를 구현합니다.
- 여러 인증 전략을 조합하는 흐름을 살펴봅니다.
- 속성 기반 인가와 동적 정책 적용의 기초를 이해합니다.
- 프로덕션 보안 설계에서 가드와 전략의 역할을 정리합니다.

## Prerequisites
- Chapter 11, Chapter 13, Chapter 14 완료.
- JWT 토큰 기반 인증 흐름에 대한 기초 이해.
- 보호가 필요한 HTTP 컨트롤러와 라우트 구조 이해.

## 15.1 The Role of Guards
이전 장에서 우리는 JWT를 발급하고 검증하는 방법을 배웠습니다. 하지만 모든 컨트롤러 메서드에서 토큰을 수동으로 확인하는 것은 지루하고 오류가 발생하기 쉽습니다. 바로 여기서 **가드(Guards)**가 등장합니다.

가드는 요청이 라우트 핸들러로 진행될 수 있는지 여부를 결정하는 특수 클래스입니다. 가드는 모든 인터셉터 이후에 실행되지만, 파이프나 핸들러 자체보다 먼저 실행됩니다. 가드는 애플리케이션의 "경비원"과 같아서 권한이 있는 요청만 통과하도록 보장합니다. 보안 로직을 가드에 중앙 집중화함으로써 컨트롤러를 비즈니스 로직에 집중시키고 API 전체에 걸쳐 일관된 보안 태세를 유지할 수 있습니다.

### 15.1.1 The Request Lifecycle and Guards
`fluo` 애플리케이션에 요청이 들어오면 일련의 레이어를 거치게 됩니다. 가드는 중요한 지점에 위치합니다. passport 인증이 성공하면 검증된 신원은 `requestContext.principal`에 기록되고, 이후의 가드나 핸들러는 이 principal을 기준으로 권한을 판단할 수 있습니다.

이러한 생명주기를 이해하는 것은 견고하고 다층적인 방어 시스템을 구축하는 데 필수적입니다. 가드는 파이프보다 먼저 실행되기 때문에, 인증되지 않은 요청에 대해 비용이 많이 드는 데이터 변환이나 유효성 검사 로직이 실행되는 것을 방지하여 서버의 CPU 및 메모리 리소스를 크게 절약할 수 있습니다. 가드는 애플리케이션의 "신뢰 영역"을 위한 1차 필터 역할을 합니다. 일찍 그리고 명시적으로 실패함으로써 가드는 승인되지 않은 진입으로부터 시스템의 내부 경계를 보호합니다.

또한 Fluo의 가드는 비동기적으로 설계되었습니다. 즉, 전체 요청 처리 스레드를 중단시키지 않고 가드의 로직 내에서 비차단(non-blocking) 데이터베이스 확인이나 외부 권한 서비스 호출을 수행할 수 있습니다. 이러한 확장성은 Fluo 가드 아키텍처의 핵심적인 장점입니다.

### 15.1.2 Guard Execution Order
Fluo에서 가드는 특정 계층 구조에 따라 실행됩니다:
1. **전역 가드(Global Guards)**: 애플리케이션의 모든 요청에 적용됩니다.
2. **컨트롤러 가드(Controller Guards)**: 특정 컨트롤러 클래스 내의 모든 라우트에 적용됩니다.
3. **메서드 가드(Method Guards)**: 특정 라우트 핸들러에만 적용됩니다.

여러 수준에 가드가 있는 경우 위에서 아래로(전역 -> 컨트롤러 -> 메서드) 실행됩니다. 이러한 계층적 실행을 통해 애플리케이션 수준에서 광범위한 보안 기본값을 설정하는 동시에 특정 엔드포인트에 대한 특수 규칙을 제공할 수 있습니다. 또한 전역 가드가 접근을 거부하면 더 구체적이고(잠재적으로 리소스 집약적인) 컨트롤러나 메서드 가드가 아예 실행되지 않도록 하여 애플리케이션의 성능을 더욱 최적화합니다.

## 15.2 Introduction to @fluojs/passport
`fluo`는 인증 전략을 처음부터 다시 만들지 않습니다. 대신 전 세계적으로 유명한 **Passport.js** 생태계를 "표준 우선(Standard-First)" 방식으로 감싼 `@fluojs/passport` 패키지를 제공합니다. 이를 통해 Fluo의 깔끔한 데코레이터 기반 개발자 경험을 유지하면서 수백 개의 검증된 전략(JWT, OAuth2, SAML 등)을 사용할 수 있습니다.

### 15.2.1 Why Passport?
Passport가 Node.js용 인증 미들웨어로 가장 인기 있는 데는 이유가 있습니다. 바로 믿을 수 없을 정도로 모듈화되어 있기 때문입니다. 인증 메커니즘(Strategy)을 애플리케이션 라우트와 분리함으로써, Passport는 코드 변경을 최소화하면서 인증 방법을 교체하거나 새로 추가할 수 있게 해줍니다. 나중에 "Google로 로그인"을 추가하기로 결정했다면 단순히 새로운 Passport 전략을 추가하기만 하면 되며, 기존 가드들은 거의 수정 없이 유지될 수 있습니다.

이러한 모듈성은 Fluo의 아키텍처와 완벽하게 어울리는데, "어떻게 인증하는가"와 "무엇을 보호하는가" 사이의 관심사 분리를 장려하기 때문입니다. Passport 커뮤니티는 이미 수천 개의 아이덴티티 공급자의 세부 사항을 처리해 두었으므로, 여러분은 새로 추가하는 모든 인증 방식의 구체적인 암호화나 프로토콜 수준의 세부 사항을 걱정할 필요가 없습니다. Fluo에서 우리는 개발자들에게 친숙하면서도 현대화된 도구 세트를 제공하기 위해 이러한 산업 표준을 수용합니다.

### 15.2.2 The Principal Object
Passport 용어에서 사용자가 인증되면 요청에 첨부된 "user" 객체로 표현됩니다. Fluo에서는 이를 **Principal**이라고 부릅니다. Principal은 사용자의 ID, 역할, 권한과 같이 애플리케이션의 나머지 부분에 필요한 핵심 신원 정보를 포함하는 정규화된 객체입니다. 모든 전략에서 Principal을 표준화함으로써 비즈니스 로직이 사용된 특정 인증 방법(예: `ProfileService`는 사용자가 JWT로 로그인했는지 Facebook으로 로그인했는지 상관하지 않고 단지 `userId`가 포함된 `Principal`만 봅니다)과 분리되도록 보장합니다.

## 15.3 Implementing the JWT AuthStrategy
FluoBlog에서 가장 흔히 쓰이는 전략은 Bearer 토큰을 읽어 `JwtPrincipal`로 정규화하는 커스텀 `AuthStrategy`입니다. "표준 우선(Standard-First)" 철학을 따름으로써, Fluo는 여러분의 JWT 구현이 RFC 7519와 같은 산업 표준과 호환되도록 보장합니다.

### 15.3.1 Defining the Strategy Class
전략 클래스는 `AuthStrategy` 계약을 구현하는 일반적인 Fluo provider입니다. 실제 예제도 이 저장소의 `examples/auth-jwt-passport/src/auth/bearer.strategy.ts`처럼 request header를 직접 읽고 `DefaultJwtVerifier`에 검증을 위임하는 형태를 사용합니다.

```typescript
import { Inject } from '@fluojs/core';
import type { GuardContext } from '@fluojs/http';
import { DefaultJwtVerifier } from '@fluojs/jwt';
import {
  AuthenticationFailedError,
  AuthenticationRequiredError,
  type AuthStrategy,
} from '@fluojs/passport';

@Inject(DefaultJwtVerifier)
export class BearerJwtStrategy implements AuthStrategy {
  constructor(private readonly verifier: DefaultJwtVerifier) {}

  async authenticate(context: GuardContext) {
    const authorization = context.requestContext.request.headers.authorization;
    if (typeof authorization !== 'string') {
      throw new AuthenticationRequiredError('Authorization header is required.');
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationFailedError('Authorization header must use Bearer token format.');
    }

    return await this.verifier.verifyAccessToken(token);
  }
}
```

### 15.3.2 Configuration Options
이 전략의 핵심 설정 포인트는 세 가지입니다.
- 토큰을 어디서 읽을지 (`Authorization` 헤더 같은 입력 경계)
- 어떤 verifier에 검증을 맡길지 (`DefaultJwtVerifier`)
- 검증이 성공했을 때 어떤 principal을 애플리케이션에 넘길지

### 15.3.3 The Strategy Method: Your Security Gate
`authenticate()` 메서드는 모든 custom strategy의 핵심입니다. 여기서 토큰의 형식을 검사하고, verifier가 돌려준 principal에 추가 검사를 수행할 수 있습니다. 예를 들어 데이터베이스에서 사용자 계정이 정지되었는지 확인하거나 비밀번호가 최근에 변경되었는지 확인하고 싶을 수 있습니다.

여기서 에러를 던지면 JWT 자체가 기술적으로 유효하더라도 요청이 거부됩니다. 암호화 기반과 로직 기반의 이러한 이중 레이어 체크가 여러분의 인증을 진정으로 안전하게 만듭니다. 이는 토큰이 자연적으로 만료되기 전의 기간 동안에도 폐기된 자격 증명이 시스템에 접근하는 데 사용될 수 없음을 보장합니다.

프로덕션 환경에서는 종종 strategy에 `UsersService`를 주입하고 데이터베이스 조회를 수행하여 사용자가 여전히 존재하고 활성 상태인지 확인합니다. 이 "검증 루프(Verification Loop)"는 민감한 금융 또는 개인 데이터를 다루는 시스템과 같이 즉각적인 권한 취소 기능이 필요한 시스템에서 매우 중요합니다. 사용자를 데이터베이스와 대조하여 검증함으로써, "무상태(Stateless)이지만 잠재적으로 오래된(stale)" 보안에서 성능과 실시간 제어를 결합한 "하이브리드" 보안으로 나아갈 수 있습니다.

### 15.3.4 Token Revocation Strategies
표준 JWT는 무상태이므로 만료되기 전에 쉽게 폐기할 수 없습니다. 하지만 `authenticate()` 메서드 안에서 폐기 패턴을 구현할 수 있습니다. 한 가지 일반적인 접근 방식은 데이터베이스에 "JWT 버전" 또는 "마지막 비밀번호 변경 타임스탬프"를 저장하고 이를 토큰의 클레임과 비교하는 것입니다. 토큰의 버전이 데이터베이스의 버전보다 오래된 경우 요청을 거부합니다. 이를 통해 모든 기기에서 즉시 로그아웃시키거나 비밀번호 재설정을 강제하는 기능을 구현할 수 있습니다.

또 다른 강력한 폐기 패턴은 **블랙리스트(또는 거부 목록) 패턴**입니다. 전통적인 JWT는 무상태이지만, 명시적으로 폐기된(예: 사용자가 로그아웃할 때) "jti" (JWT ID) 클레임의 분산 캐시(예: Redis)를 유지할 수 있습니다. `authenticate()` 메서드에서 현재 토큰의 ID가 블랙리스트에 존재하는지 확인합니다. 이를 통해 매 요청마다 기본 데이터베이스를 쿼리할 필요 없이 특정 토큰을 거의 즉시 폐기할 수 있으며, 필요한 보안 제어를 추가하면서도 높은 수준의 성능을 유지할 수 있습니다.

고도로 보안이 중요한 환경에서는 발급된 모든 토큰 ID가 "유효한 토큰" 저장소에 있어야 하는 **화이트리스트 패턴**을 구현할 수도 있습니다. 이 방식은 시스템을 사실상 상태 유지(stateful) 방식으로 만들지만, 활성 세션에 대해 가능한 최대의 제어 권한을 제공합니다. Fluo에서는 strategy가 비동기적이고 의존성 주입을 지원하기 때문에, 적절한 서비스(예: `RedisService`)를 주입하고 몇 줄의 로직을 추가하는 것만으로 이러한 패턴들을 쉽게 구현할 수 있습니다.

## 15.4 Protecting Routes with Passport
전략이 정의되면 `@UseAuth()`를 사용하여 라우트를 보호할 수 있습니다. 내부적으로는 passport 가드가 선택된 전략을 실행하지만, 컨트롤러는 raw request 객체 대신 검증된 principal을 받는 쪽이 fluo 스타일에 더 가깝습니다.

### 15.4.1 Basic Implementation
라우트를 보호하려면 `@UseAuth()` 데코레이터를 적용하면 됩니다.

```typescript
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';

@Controller('profile')
@UseAuth('jwt')
export class ProfileController {
  @Get()
  getProfile(_input: undefined, ctx: RequestContext) {
    return ctx.principal;
  }
}
```

### 15.4.2 Controller-Level vs. Method-Level Guards
`@UseAuth()`는 클래스 전체(컨트롤러)에 적용하거나 개별 메서드에 적용할 수 있습니다. 컨트롤러 수준에서 적용하는 것은 "기본적으로 보안 적용(secure by default)" 접근 방식으로, 해당 클래스의 모든 라우트가 보호되도록 보장합니다. 일부 라우트만 공개해야 하는 경우, 더 구체적인 설정이나 커스텀 가드를 사용하여 예외를 처리할 수 있습니다.

이러한 유연성을 통해 애플리케이션의 계층 구조에 딱 맞는 보안 정책을 설계할 수 있습니다. 예를 들어, `UsersController` 전체를 JWT 가드로 보호하면서 `deleteUser` 메서드에만 추가적으로 `RolesGuard`를 적용할 수 있습니다. 이러한 계층적 접근 방식은 애플리케이션을 위해 고도로 세분화되고 감사 가능한 보안 표면을 생성합니다. 또한 개발자가 실수로 가드를 적용하는 것을 잊어버려 새로운 엔드포인트가 무방비로 노출되는 "보안 편차(Security Drift)"를 방지합니다.

### 15.4.3 Mixing Multiple Guards
Fluo를 사용하면 passport 인증 뒤에 추가 가드를 쌓을 수 있습니다. 인증이 먼저 principal을 만들고, 뒤의 가드는 그 principal이나 요청 컨텍스트를 기준으로 추가 정책을 검사합니다. 이러한 효율성은 성능 면에서 중요한데, 요청이 이미 승인되지 않은 것으로 간주된 후 불필요한 데이터베이스 조회나 암호화 체크를 피할 수 있기 때문입니다.

내장 passport 인증과 커스텀 가드를 혼합하여 사용할 수도 있습니다. 예를 들어, `@UseAuth('jwt')`로 신원을 확인한 다음 커스텀 `IpWhitelistGuard`를 사용하여 사내 네트워크로 접근을 제한할 수 있습니다. 가드의 이러한 조합 가능한 특성은 복잡한 보안 파이프라인을 구축하면서도 각 부분을 독립적으로 추론하고 테스트하기 쉽게 만들어 줍니다.

## 15.5 Role-Based Access Control (RBAC)
인증(누구인가?)은 전투의 절반일 뿐입니다. 나머지 절반은 **인가(무엇을 할 수 있는가?)**입니다. Fluo에서는 인증이 끝난 뒤 `requestContext.principal.roles`나 `requestContext.principal.scopes`를 기준으로 추가 가드나 서비스 정책을 적용하는 식으로 RBAC를 설계하는 것이 자연스럽습니다.

실무에서는 먼저 `@UseAuth('jwt')`로 principal을 확보하고, 그 다음 단계에서 역할이나 스코프를 검사하는 guard를 붙이면 됩니다. 핵심은 인증과 인가를 분리해 두어, 어떤 전략이 principal을 만들었는지와 무관하게 같은 권한 정책을 재사용하는 것입니다.

### 15.5.5 Passing Options to AuthGuard
때때로 라우트별로 인증 동작을 커스터마이징해야 할 때가 있습니다. fluo에서는 요청 객체의 임의 속성을 바꾸는 방식보다, 전략에서 어떤 principal을 반환할지와 라우트에 어떤 `@UseAuth()` 조합을 붙일지를 명시적으로 유지하는 편이 더 안전합니다.

이러한 설정을 통해 애플리케이션의 서로 다른 부분에 필요한 보안 요구 사항을 정확하게 충족할 수 있습니다. 예를 들어, 관리 대시보드에는 세션 기반 인증을 사용하고 공용 모바일 API에는 엄격한 무상태 JWT를 사용할 수 있습니다. Fluo의 Passport 통합은 이러한 전환을 원활하고 선언적으로 만들어 줍니다.

### 15.5.6 Handling Multiple Strategies
복잡한 애플리케이션에서는 여러 인증 방법을 동시에 지원해야 할 수도 있습니다. 예를 들어, 사용자가 표준 JWT 또는 수명이 긴 API 키를 통해 인증할 수 있는 경우입니다. 이때도 핵심은 어떤 전략이 선택되었든 최종적으로는 같은 principal 형태로 정규화하는 것입니다.

이러한 다중 전략 접근 방식은 특히 **시스템 간 통신(System-to-System Communication)**에 유용합니다. 웹 및 모바일 사용자는 JWT를 사용할 수 있지만, 내부 서비스나 제3자 웹훅은 특수한 API 키나 상호 TLS(mTLS)를 통해 인증을 제공할 수 있습니다. 단일 가드에 이러한 전략들을 쌓음으로써 엔드포인트에 대해 통합된 보안 정책을 유지하면서도 다양한 클라이언트 요구 사항을 지원할 수 있는 유연성을 확보할 수 있습니다. 또한 인증 방식에 관계없이 유효한 principal만 확인하면 되므로 컨트롤러 로직이 단순해집니다.

여러 전략이 제공되면 passport 레이어는 이를 순서대로 시도하고, 성공한 전략의 결과를 동일한 principal 형식으로 애플리케이션에 넘겨줄 수 있습니다. 이러한 "논리적 OR" 동작은 인증 방식 마이그레이션 중에 하위 호환성을 유지하거나 단일 엔드포인트 집합으로 다양한 클라이언트 유형을 지원하는 데 매우 유용합니다.

## 15.6 Customizing Unauthorized Responses
기본적으로 passport 인증 실패는 표준 `UnauthorizedException`으로 이어집니다. 하지만 에러 메시지를 커스터마이징하거나 보안 감사를 위해 실패한 시도를 로그로 남기고 싶을 수 있습니다. fluo에서는 이런 처리를 request 객체를 다시 래핑하는 가드 확장보다, 전략 내부의 실패 분기나 전역 예외 필터 쪽에서 명시적으로 다루는 편이 더 자연스럽습니다.

### 15.6.1 The Importance of Clear Error Feedback
명확하면서도 안전한 피드백을 제공하는 것은 정교한 기술입니다. 공격자에게 민감한 시스템 정보를 유출해서는 안 되지만, 정당한 사용자에게는 왜 요청이 실패했는지 이해하도록 도와야 합니다. 로그에서 "토큰 누락"과 "토큰 만료"를 구분하는 것만으로도, 사용자에게는 일반적인 메시지를 보여주면서 개발자의 디버깅 시간은 몇 시간씩 단축할 수 있습니다.

Fluo의 passport 전략과 예외 처리 계층은 이러한 정교한 에러 관리를 구현하는 데 필요한 도구들을 제공합니다. 예를 들어 특정 IP에서 만료된 토큰으로 대량의 요청이 들어오는 것과 같은 의심스러운 패턴을 감지했을 때(예: "재전송(replay)" 공격 시도) 자동화된 알림을 트리거할 수도 있습니다. 내부 모니터링 시스템에 구체적인 실패 원인(예: 서명 불일치 vs 만료)을 기록하는 것은 사고 대응 및 포렌식 분석에 필수적입니다.

### 15.6.2 Integration with Global Filters
가드가 요청의 진행 여부를 결정하는 동안, 가드는 종종 최종 응답 형식을 지정하기 위해 전역 예외 필터(Global Exception Filters)와 협력합니다. 가드가 `UnauthorizedException`을 던집면, 필터가 이를 가로채 응답 본문에 추적 ID나 법적 면책 조항을 추가할 수 있습니다. 이러한 관심사 분리(Separation of Concerns)를 통해 가드 로직은 "예/아니오" 결정에 집중하고, 필터는 "사용자에게 어떻게 알릴 것인가"라는 부분을 처리하게 됩니다.

이러한 통합의 또 다른 이점은 **고급 보안 감사(Advanced Security Auditing)**를 구현할 수 있다는 점입니다. 필터 수준에서 권한 없는 시도를 캡처함으로써, 가드에서 쉽게 접근할 수 없는 세부 정보(예: 다시 전송되는 전체 응답 본문이나 세션별 메타데이터)로 로그 데이터를 풍부하게 만들 수 있습니다. 또한 필터를 사용하여 "느린 실패(Slow Fail)" 패턴을 구현할 수도 있습니다. 이는 신속한 무차별 대입 공격이나 타이밍 공격을 방지하기 위해 권한 없는 요청을 의도적으로 몇 백 밀리초 동안 지연시키는 방식입니다.

Fluo에서 예외 필터는 `@Catch()` 데코레이터를 사용하여 정의되며 전역, 컨트롤러 수준 또는 메서드 수준에서 적용될 수 있습니다. 이러한 계층 구조는 가드 실행 순서를 그대로 반영하며, 전체 요청-응답 생명주기를 처리하기 위한 일관된 멘탈 모델을 제공합니다. 가드와 필터가 결합되면 현대 소프트웨어 엔지니어링의 최고 표준을 충족하는 안전하고 견고하며 사용자 친화적인 API를 구축하기 위한 종합적인 툴킷이 완성됩니다.

이러한 모듈식 아키텍처를 통해 보안 팀은 가드 코드를 한 줄도 수정하지 않고 전역 응답 정책을 업데이트할 수 있습니다. 이는 Fluo의 "표준 우선(Standard-First)" 접근 방식의 전형적인 예로, 표준 HTTP 시맨틱과 깔끔한 추상화를 활용하여 수십 년 동안 유지보수하기 쉬운 시스템을 구축하는 방법입니다.

## 15.7 Advanced Authorization: Beyond RBAC
역할만으로 충분하지 않은 앱에서는 **속성 기반 인가(ABAC)**가 필요할 수 있습니다. 예를 들어 "작성자 본인이고 아직 Draft 상태인 글만 수정 가능" 같은 규칙입니다.

ABAC의 핵심은 principal 하나만 보는 대신, principal + 리소스 상태 + 환경 조건을 함께 판단하는 것입니다. 이때도 passport가 맡는 역할은 인증 결과를 `requestContext.principal`로 정규화하는 데 있고, 실제 소유권 검사나 정책 평가는 별도의 guard나 service 계층에서 수행하는 편이 더 유지보수하기 쉽습니다.

이 패턴은 비동기 가드의 강력함을 보여줍니다. 요청이 컨트롤러에 도달하기 전에 소유권을 확인함으로써, 가장 이른 단계에서 승인되지 않은 데이터 수정을 방지할 수 있습니다. 또한 컨트롤러 메서드가 특정 엔터티를 수정할 권한이 있는지 수동으로 확인할 필요가 없어지므로 코드가 훨씬 깔끔해집니다.

### 15.7.2 Policy-Based Authorization
대규모 애플리케이션의 경우 **정책 기반 인가(Policy-Based Authorization)**로 이동하는 것을 권장합니다. 이는 복잡한 규칙을 평가하는 전용 `AuthorizationService`를 만드는 것을 포함합니다. 그러면 가드는 단순히 이 서비스를 호출하는 역할만 수행하게 됩니다. 이러한 방식은 모든 권한 로직을 한곳에 집중시켜 비즈니스 요구 사항이 변함에 따라 감사하고 변경하기 쉽게 만들어 줍니다.

정책 서비스는 외부 정책 관리 지점(PAP)이나 Casbin, Oso와 같은 분산 권한 엔진과 통합될 수 있습니다. Fluo의 유연한 공급자(Provider) 시스템을 사용하면 이러한 외부 엔진을 가드가 사용할 수 있는 깔끔한 TypeScript 우선 인터페이스로 쉽게 감싸서 사용할 수 있습니다. 이러한 "서비스로서의 인가(Authorization as a Service)" 모델은 수십 개의 서로 다른 서비스 간에 권한 일관성이 유지되어야 하는 마이크로서비스 아키텍처의 골드 표준입니다.

### 15.7.3 Dynamic Resource Constraints
때때로 인가는 단순히 "X를 할 수 있는가?"가 아니라 "X를 얼마나 많이 할 수 있는가?"에 관한 것입니다. 이를 동적 리소스 제한(Dynamic resource constraining)이라고 합니다. 예를 들어, "기본" 사용자는 5개의 프로젝트를 생성할 수 있지만, "프리미엄" 사용자는 무제한으로 생성할 수 있는 경우입니다.

비즈니스 로직에서 이를 처리할 수도 있지만, 생성 라우트 앞에 특수 가드를 배치하면 더 빠른 "조기 실패(fail-early)" 메커니즘을 제공할 수 있습니다. 이 가드는 사용자의 현재 프로젝트 수를 구독 티어와 비교하여 한도에 도달한 경우 요청을 거부할 수 있습니다. 이는 주 실행 경로에서 리소스 집약적인 체크를 분리하고 전체 플랫폼에서 결제 관련 제한을 처리하는 일관된 방법을 제공합니다.

나아가, 동적 제한은 **시간 기반 액세스(Time-Based Access)**에도 적용될 수 있습니다. 예를 들어, 학생 계정은 수업 시간 중에만 특정 학습 자료에 접근할 수 있도록 하거나, 유지보수 계정은 특정 유지보수 시간대로 제한될 수 있습니다. 이러한 체크를 가드에서 구현함으로써, 리소스가 사용자가 "누구인지"뿐만 아니라 "언제", "어떻게" 접근하려 하는지에 따라서도 보호되도록 보장할 수 있습니다. 이러한 수준의 세밀한 제어는 엄격한 운영상 또는 계약상 요구 사항을 준수해야 하는 복잡한 실제 시스템을 구축하는 데 필수적입니다.

## 15.8 Deep Dive: Scopes and Claims
현대적인 OAuth2 및 OpenID Connect 흐름에서는 **Scopes**(토큰이 무엇을 할 수 있는가)와 **Claims**(토큰이 사용자에 대해 무엇을 말하는가)를 구분합니다.

### 15.8.1 Working with Scopes
스코프는 클라이언트 애플리케이션이 요청한 권한입니다. 예를 들어, 모바일 앱은 사용자가 콘텐츠를 생성할 수 있도록 `posts:write` 스코프를 요청할 수 있습니다. `JwtStrategy`는 이러한 스코프를 추출하여 정규화된 Principal에 포함해야 합니다.

많은 OAuth2 구현에서 스코프는 애플리케이션이 사용자를 대신하여 수행할 수 있는 작업을 제한하는 데 사용됩니다. 사용자가 공식 웹 포털을 통해 로그인할 때는 모든 관리자 권한을 가질 수 있지만, 제3자 통합 서비스에는 "읽기 전용" 스코프만 부여될 수 있습니다. 이러한 추상화 레이어는 사용자가 기본 자격 증명을 공유하지 않고도 데이터에 대한 제한된 액세스 권한을 안전하게 부여할 수 있는 보안 생태계를 구축하는 데 매우 중요합니다.

```typescript
// custom AuthStrategy 내부
return {
  subject: payload.sub,
  roles: payload.roles || [],
  scopes: payload.scopes || [], // ['posts:write', 'profile:read']
};
```

그런 다음 라우트에서 요구하는 특정 스코프를 확인하는 `ScopesGuard`를 만들 수 있습니다. 이는 또 다른 보안 레이어를 추가하여, 사용자가 'admin'이더라도 사용 중인 특정 클라이언트에 부여된 권한만 토큰에 포함되도록 보장합니다. 이러한 "최소 권한의 원칙(Principle of Least Privilege)"은 토큰 탈취나 손상된 클라이언트 애플리케이션으로부터 API를 보호하는 데 필수적입니다. 또한 사용자가 특정 기능이 필요할 때만 권한을 부여하는 "점진적 동의(Incremental Consent)" 패턴을 구현할 수 있게 해줍니다.

또한 스코프는 UI 동작을 제어하는 데 사용될 수 있습니다. 토큰에 있는 스코프를 확인하여 프론트엔드에서 특정 버튼이나 내비게이션 링크를 표시하거나 숨길지 결정함으로써, 서버 측 가드 체크를 통해 보안을 유지하면서도 더 직관적인 사용자 경험을 제공할 수 있습니다. 프론트엔드 가시성과 백엔드 집행 사이의 이러한 동기화는 잘 설계된 현대적 애플리케이션의 특징입니다.

### 15.8.2 Custom Claims for Multi-Tenancy
다중 테넌트(Multi-tenant) SaaS 애플리케이션을 구축하는 경우, JWT에는 `tenant_id` 클레임이 포함될 가능성이 높습니다. 이 클레임은 데이터 격리에 매우 중요합니다. Principal에 `tenant_id`를 포함하면 애플리케이션의 모든 서비스와 리포지토리가 현재 사용자의 조직을 기반으로 데이터를 자동으로 필터링할 수 있습니다.

Fluo에서는 종종 인터셉터나 스코프 지정 공급자(Scoped provider)를 사용하여 데이터베이스 쿼리 컨텍스트에 `tenant_id`를 직접 주입합니다. 이를 통해 애플리케이션 로직에 버그가 있더라도 "테넌트 A"의 사용자가 절대 "테넌트 B"의 데이터를 실수로 볼 수 없도록 보장합니다. 이러한 "강력한 격리(Hard Isolation)" 전략은 많은 엔터프라이즈 컴플라이언스 프레임워크(SOC2 또는 HIPAA 등)의 핵심 요구 사항입니다. 또한 개발자가 모든 쿼리에 `WHERE tenant_id = ?`를 추가하는 것을 잊어버릴 걱정이 없으므로 개발자 경험을 단순화합니다.

### 15.8.3 Extensible Claims for Business Logic
단순한 ID를 넘어, 특정 비즈니스 상태를 나타내는 커스텀 클레임을 포함할 수 있습니다. 예를 들어, `subscription_status` 클레임을 사용하면 가드가 매 요청마다 데이터베이스를 조회하지 않고도 만료된 계정의 사용자가 프리미엄 기능에 접근하는 것을 즉시 차단할 수 있습니다. 이러한 최적화는 데이터베이스 부하를 크게 줄이고 트래픽이 많은 애플리케이션의 응답 시간을 개선합니다.

하지만 JWT는 기본적으로 암호화되지 않고 서명만 된다는 점을 명심하십시오. 클레임에 넣는 모든 데이터는 클라이언트와 중간 프록시에서 볼 수 있습니다. 따라서 전화번호나 집 주소와 같은 민감한 비밀 정보나 개인 식별 정보(PII)를 JWT 클레임에 직접 넣지 마십시오. 성능과 개인정보 보호 사이의 균형을 유지하면서 필요할 때 서버에서 민감한 데이터를 조회하기 위한 키로 클레임을 사용하십시오.

## 15.9 Best Practices for Production Security
프로덕션으로 나아갈 때, 가드 및 전략 구현이 안전하고 유지보수 가능하도록 보장하기 위해 따라야 할 몇 가지 패턴이 있습니다.

### 1. Avoid Heavy Database Hits in Guards
가드는 비동기적일 수 있지만, 가드 내부에서 복잡한 조인(Join)이나 전체 테이블 스캔을 수행하면 전체 API의 병목 현상이 발생할 수 있습니다. 자주 변경되는 데이터를 확인해야 하는 경우 Redis와 같은 고성능 캐시를 사용하여 인가 결정을 저장하는 것을 고려하십시오. 이를 통해 과부하 상태에서도 가드가 빠르고 응답성 있게 유지될 수 있습니다.

### 2. Standardize Principal Shapes
애플리케이션의 모든 인증 전략이 동일한 형태의 Principal 객체를 반환하도록 하십시오. 이러한 일관성을 통해 사용자가 JWT, 세션, API 키 중 어떤 방식으로 로그인했는지에 관계없이 비즈니스 로직과 데코레이터(`@CurrentUser` 등)가 원활하게 작동할 수 있습니다. Fluo의 TypeScript 우선 특성을 활용하면 모든 전략이 구현해야 하는 전역 `Principal` 인터페이스를 쉽게 정의할 수 있습니다.

### 3. Audit Guard Failures
가드가 접근을 거부할 때마다 이는 잠재적인 보안 이벤트입니다. 이러한 실패를 충분한 컨텍스트(IP 주소, 사용자 에이전트, 대상 리소스)와 함께 기록하여 자격 증명 스터핑(Credential stuffing)이나 스크레이핑 시도를 감지하고 대응할 수 있도록 하십시오. Sentry나 OpenTelemetry와 같은 통합 모니터링 도구를 사용하여 가드 실패율을 추적하고 예상치 못한 급증 시 팀에 알림을 보낼 수 있습니다.

### 4. Use Shared Auth Policies for Common Routes
라우트의 대부분에 적용되는 정책(예: 인증 필요)이 있는 경우, 같은 `@UseAuth(...)` 조합과 공통 권한 가드 구성을 반복 가능하게 정리해 두는 것을 고려하십시오. 이러한 "기본 거부(Deny by Default)" 방식은 모든 새 컨트롤러에 수동으로 정책을 덧붙이는 것보다 훨씬 안전하며, 빠른 개발 주기 동안 실수로 데이터가 노출되는 것을 방지합니다.

또한 항상 **인증과 인가 로직을 격리하여 테스트**해야 한다는 점을 기억하십시오. 헤더 누락, 잘못된 형식의 토큰, 여러 역할을 가진 사용자 등 모든 엣지 케이스에 대해 정책이 예상대로 작동하는지 확인해야 합니다. 잘 테스트된 보안 레이어는 신뢰할 수 있는 애플리케이션의 토대입니다.

## 15.11 Deep Dive: Multi-Factor Authentication (MFA) Patterns
For high-security applications, a single password or JWT is often not enough. Implementing **Multi-Factor Authentication (MFA)** is a critical step in modern security.

### 15.11.1 The MFA Challenge Flow
Fluo에서는 보통 첫 번째 요소(비밀번호)가 성공한 후 "부분적인(Partial)" JWT를 발급하여 MFA를 처리합니다. 이 토큰에는 `mfa_required: true`와 같은 특수 클레임이 포함됩니다. 이후 사용자는 MFA 인증 엔드포인트로 리다이렉트됩니다. 유효한 TOTP 또는 SMS 코드가 제공된 후에야 애플리케이션은 "최종적인(Final)" 전체 액세스용 JWT를 발급합니다. 이러한 다단계 프로세스는 비밀번호가 도난당하더라도 공격자가 두 번째 요소 없이는 전체 액세스 권한을 얻을 수 없도록 보장합니다.

### 15.11.2 Using Guards for MFA Enforcement
`mfa_required` 클레임이 없는지 명시적으로 확인하는 `MfaGuard`를 만들 수 있습니다. 이 가드를 전역적으로 또는 민감한 라우트에 적용함으로써 사용자가 MFA 단계를 우회할 수 없도록 보장합니다. 이러한 패턴은 Fluo의 정규화된 Principal 객체 덕분에 구현하기 쉽습니다. Principal 객체는 로그인 과정 중 이러한 일시적인 보안 상태를 쉽게 저장할 수 있기 때문입니다.

## 15.12 Handling Strategy Failures Gracefully
인증 전략이 실패한다고 해서 항상 보안 침해를 의미하는 것은 아닙니다. 만료된 토큰이거나, 잘못된 헤더 형식이거나, 설정 불일치일 수도 있습니다.

### 15.12.1 Failure Shape
따라서 strategy는 `AuthenticationRequiredError`와 `AuthenticationFailedError`처럼 의미가 분명한 실패를 던지고, 응답 메시지와 로깅은 그 위 계층에서 일관되게 정리하는 편이 좋습니다. 이런 분리는 프론트엔드가 "세션이 만료되었습니다"와 "자격 증명 형식이 잘못되었습니다"를 더 쉽게 구분하게 해 줍니다.

### 15.12.2 Strategy Debugging Techniques
전략 구현에 어려움을 겪고 있다면, 먼저 예제의 `BearerJwtStrategy`처럼 입력 헤더 읽기와 verifier 호출을 분리해서 로그를 남기십시오. 이렇게 하면 검증 프로세스의 어느 부분에서 실패하는지 정확히 확인할 수 있고, 문제의 원인이 암호화 서명인지 헤더 형식인지도 빠르게 좁힐 수 있습니다.

## 15.13 Security Beyond the Framework
보안은 다층적인 작업입니다. Fluo의 가드와 Passport 전략이 강한 애플리케이션 레벨 보호를 제공하더라도, 더 넓은 보안 전략의 일부여야 합니다.

- **Use HTTPS everywhere**: Tokens transmitted over HTTP are easily stolen.
- **Sanitize all inputs**: Authentication doesn't protect you from SQL Injection or XSS. Use Fluo's Validation (Chapter 6) and Serialization (Chapter 7) features.
- **Keep dependencies updated**: A vulnerability in a third-party Passport strategy is a vulnerability in your app. Use tools like `npm audit` regularly.
- **Principle of Least Privilege**: Give your database users and API keys only the permissions they absolutely need.

Fluo의 보안 계층과 이러한 업계 표준 관행을 함께 적용하면, 단지 빠르기만 한 것이 아니라 현대적 위협에도 잘 버티는 백엔드를 만들 수 있습니다.

## 15.14 Summary
가드와 Passport 전략은 FluoBlog를 지키는 보호막을 형성합니다. 검증된 Passport 전략과 Fluo의 유연한 가드 시스템을 결합하면 아주 적은 코드로 복잡한 보안 요구 사항을 구현할 수 있습니다.

- **가드**는 모든 요청에 대해 "들어와도 되는가?"라는 로직을 처리합니다.
- **Passport 전략**은 신원 확인 방식(JWT 등)을 표준화합니다.
- **JwtStrategy**는 원본 토큰과 정규화된 Principal 사이의 가교 역할을 합니다.
- `RolesGuard`를 통한 **RBAC**는 사용자가 허용된 영역 내에 머물도록 보장합니다.
- ABAC 및 정책 서비스를 통한 **고급 로직**은 복잡한 소유권 및 리소스 제한을 처리합니다.
- **스코프와 클레임**은 현대적인 OAuth2 흐름과 다중 테넌트 격리에 필요한 세밀함을 제공합니다.
- **프로덕션 베스트 프랙티스**는 보안 레이어가 성능과 감사 준비 상태를 모두 갖추도록 보장합니다.
- **Principal 정규화**를 통해 인증 방식에 관계없이 애플리케이션의 나머지 부분이 일관된 사용자 객체에 의존할 수 있도록 보장합니다.

이제 FluoBlog는 Bearer 토큰을 검증된 principal로 바꾸고, 그 principal을 바탕으로 경로별 인가 규칙까지 적용할 수 있습니다. Part 3의 마지막 장에서는 한 가지 계층을 더 추가하여, Throttling으로 API 남용을 막는 방법을 살펴보겠습니다.
