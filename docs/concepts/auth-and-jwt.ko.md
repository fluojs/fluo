# 인증 및 JWT

<p><a href="./auth-and-jwt.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo의 인증은 "전략 독립적(strategy-agnostic)" 실행 모델을 기반으로 구축되었습니다. fluo는 라우트에 인증 로직을 직접 코딩하는 대신, 신원 확인과 라우트 보호를 분리합니다. 이를 통해 비즈니스 로직을 변경하지 않고도 다양한 인증 방식과 런타임(Node.js, Bun, Deno)에 걸쳐 애플리케이션을 확장할 수 있습니다.

## fluo 방식의 장점

- **표준 데코레이터**: `@UseAuth()` 및 `@RequireScopes()`와 같은 표준 TC39 데코레이터를 사용하여 깔끔하고 메타데이터 중심적인 보안 태세를 유지합니다.
- **Principal 정규화**: JWT, 세션 쿠키, API 키 등 어떤 방식을 사용하든 애플리케이션은 항상 일관된 `principal` 객체와 상호작용합니다.
- **멀티 런타임 안전성**: 인증 코어는 전송 방식에 구애받지 않으므로 HTTP, WebSockets, 심지어 CLI 기반 실행에서도 안전하게 사용할 수 있습니다.
- **명시적 스코프**: 라우트 레벨에서 직접 작동하는 스코프 기반 인가(RBAC/Scopes) 기능을 기본으로 지원합니다.

## 책임 분담

- **`@fluojs/jwt` (코어)**: 토큰의 "방법"을 처리합니다. JWT의 서명 및 검증, 클레임 정규화(예: `scope`와 `scopes` 클레임 병합)를 수행하며, 재생 공격 감지(replay detection) 기능이 포함된 리프레시 토큰 로테이션을 관리합니다.
- **`@fluojs/passport` (브릿지)**: "누구"를 처리합니다. `AuthStrategy` 인터페이스와 기존 Passport.js 전략들을 fluo 요청 컨텍스트로 연결하는 브릿지를 제공합니다.
- **`@fluojs/http` (오케스트레이터)**: "언제"를 처리합니다. HTTP 수명 주기 동안 `AuthGuard`를 실행하고, 자격 증명(헤더/쿠키)을 추출하며, `RequestContext.principal`에 데이터를 채웁니다.

## 요청의 여정

1.  **진입 (Ingress)**: `@UseAuth('jwt')`가 적용된 라우트에 요청이 도달합니다.
2.  **가드 트리거**: `AuthGuard`가 DI 컨테이너에서 'jwt' 전략을 식별합니다.
3.  **추출**: 전략이 `Authorization` 헤더에서 Bearer 토큰을 추출합니다.
4.  **검증**: `@fluojs/jwt`가 `@fluojs/config`로 관리되는 키를 사용하여 서명, 발행자(issuer), 대상(audience)을 검증합니다.
5.  **정규화**: 원시 클레임이 안정적인 `JwtPrincipal` 객체로 매핑됩니다.
6.  **인가 (Authorization)**: `@RequireScopes('admin')`이 있는 경우, 가드는 principal이 필요한 스코프를 가지고 있는지 확인합니다.
7.  **주입**: 검증된 principal이 컨텍스트에 첨부되어 컨트롤러에서 `ctx.principal`을 통해 접근할 수 있게 됩니다.

## 실무 사례: 리프레시 토큰 로테이션

fluo는 **일회용 로테이션(One-Time-Use Rotation)**을 구현하는 `RefreshTokenService`를 내장하고 있습니다. 사용자가 세션을 갱신할 때:
- 이전 리프레시 토큰은 무효화됩니다.
- 새로운 액세스/리프레시 토큰 쌍이 발급됩니다.
- 이전 리프레시 토큰이 재사용되면(재생 공격), 해당 토큰 가족 전체가 자동으로 취소될 수 있어 탈취된 자격 증명으로부터 사용자를 보호합니다.

## 다음 단계

- **빠른 시작**: [Auth JWT Passport 예제](../../examples/auth-jwt-passport/README.ko.md)에서 토큰 발급 및 검증을 확인하세요.
- **실무 적용**: [RealWorld API 예제](../../examples/realworld-api/README.ko.md)에서 완전한 로그인 흐름을 확인하세요.
- **상세 탐색**: [JWT 패키지](../../packages/jwt/README.ko.md) 및 [Passport 패키지](../../packages/passport/README.ko.md)를 살펴보세요.
