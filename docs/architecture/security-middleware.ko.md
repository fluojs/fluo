# Security Middleware Requirements

<p><a href="./security-middleware.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/http`와 `@fluojs/throttler`가 구현하는 현재 HTTP 보안 헤더, CORS, throttling 요구사항을 정의합니다.

## Required Headers

`createSecurityHeadersMiddleware()`는 애플리케이션이 개별 헤더를 `false`로 비활성화하지 않는 한, `next()`를 호출하기 전에 아래 헤더를 기록합니다.

| Header | Default value | Rule | Source anchor |
| --- | --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'` | 기본으로 설정됩니다. 재정의하거나 비활성화할 수 있습니다. | `packages/http/src/middleware/security-headers.ts` |
| `Cross-Origin-Opener-Policy` | `same-origin` | 기본으로 설정됩니다. 재정의하거나 비활성화할 수 있습니다. | `packages/http/src/middleware/security-headers.ts` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 기본으로 설정됩니다. 재정의하거나 비활성화할 수 있습니다. | `packages/http/src/middleware/security-headers.ts` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | 기본으로 설정됩니다. `strictTransportSecurity: false`로 비활성화할 수 있습니다. | `packages/http/src/middleware/security-headers.ts` |
| `X-Content-Type-Options` | `nosniff` | 기본으로 설정됩니다. `xContentTypeOptions: false`로 비활성화할 수 있습니다. | `packages/http/src/middleware/security-headers.ts` |
| `X-Frame-Options` | `SAMEORIGIN` | 기본으로 설정됩니다. 재정의하거나 비활성화할 수 있습니다. | `packages/http/src/middleware/security-headers.ts` |
| `X-XSS-Protection` | `0` | 기본으로 설정됩니다. 재정의하거나 비활성화할 수 있습니다. | `packages/http/src/middleware/security-headers.ts` |

현재 HTTP 미들웨어 계약의 CORS 및 rate-limit 응답 헤더:

| Header | Emission rule | Source anchor |
| --- | --- | --- |
| `Access-Control-Allow-Origin` | CORS 미들웨어가 허용된 origin을 해석했을 때 기록됩니다. | `packages/http/src/middleware/cors.ts` |
| `Access-Control-Allow-Methods` | 구성된 메서드 목록 또는 기본 메서드 목록을 기준으로 모든 CORS 미들웨어 실행에서 기록됩니다. | `packages/http/src/middleware/cors.ts` |
| `Access-Control-Allow-Headers` | `allowHeaders`가 구성된 경우에만 기록됩니다. | `packages/http/src/middleware/cors.ts` |
| `Access-Control-Expose-Headers` | `exposeHeaders`가 구성된 경우에만 기록됩니다. | `packages/http/src/middleware/cors.ts` |
| `Access-Control-Allow-Credentials` | `allowCredentials`가 `true`일 때만 기록됩니다. | `packages/http/src/middleware/cors.ts` |
| `Access-Control-Max-Age` | `maxAge`가 구성된 경우에만 기록됩니다. | `packages/http/src/middleware/cors.ts` |
| `Vary: Origin` | CORS가 `*`가 아닌 특정 origin을 반영할 때 필요합니다. | `packages/http/src/middleware/cors.ts` |
| `Retry-After` | `createRateLimitMiddleware(...)`와 `ThrottlerGuard`가 제한한 응답에서 필요합니다. | `packages/http/src/middleware/rate-limit.ts`, `packages/throttler/src/guard.ts` |

## Middleware Order

현재 HTTP dispatcher 순서는 `createDispatcher(...)`에 의해 고정됩니다.

| Stage | Current order | Result | Source anchor |
| --- | --- | --- | --- |
| 1 | Request context creation and request observers start | 미들웨어 실행 전에 요청 메타데이터를 생성하고, 활성 파이프라인이 request scope를 필요로 할 수 있을 때만 request scope로 승격합니다. | `packages/http/src/dispatch/dispatcher.ts` |
| 2 | Global application middleware | 모든 요청에서 `appMiddleware`를 먼저 실행합니다. | `packages/http/src/dispatch/dispatcher.ts` |
| 3 | Route match and param update | 모듈 미들웨어 전에 핸들러를 선택하고 라우트 파라미터를 기록합니다. | `packages/http/src/dispatch/dispatcher.ts` |
| 4 | Module middleware | 라우트 매칭 후, guard 전에 라우트 모듈 미들웨어를 실행합니다. | `packages/http/src/dispatch/dispatcher.ts` |
| 5 | Guard chain | `AuthGuard`, `ThrottlerGuard` 같은 라우트 guard를 실행합니다. | `packages/http/src/dispatch/dispatcher.ts`, `packages/passport/src/guard.ts`, `packages/throttler/src/guard.ts` |
| 6 | Interceptor chain | guard가 성공한 뒤 전역 및 라우트 interceptor를 실행합니다. | `packages/http/src/dispatch/dispatcher.ts` |
| 7 | Handler invocation and response write | 컨트롤러 핸들러를 실행한 뒤, 응답이 이미 커밋되지 않았다면 성공 응답을 기록합니다. | `packages/http/src/dispatch/dispatcher.ts` |
| 8 | Error mapping and request-scope disposal | 처리되지 않은 실패를 정규화하고, 오류 응답을 기록하고, finish observer를 호출한 뒤 isolated request scope로 승격된 dispatch에서만 요청 컨테이너를 dispose합니다. | `packages/http/src/dispatch/dispatcher.ts` |

미들웨어별 순서 규칙:

- `createSecurityHeadersMiddleware()`는 `next()`를 기다리기 전에 헤더를 설정하므로, 하위 핸들러는 이미 응답에 붙은 헤더 상태를 보게 됩니다.
- `createCorsMiddleware()`는 미들웨어 단계에서 실행됩니다. `OPTIONS` preflight 요청은 상태 `204`로 단락 종료되며 guard나 handler까지 진행하지 않습니다.
- `createRateLimitMiddleware()`는 미들웨어 단계에서 실행됩니다. 구성된 제한을 초과한 요청은 `429`를 반환하며, app middleware로 사용된 경우 라우트 매칭이나 핸들러 로직까지 진행하지 않습니다.
- `ThrottlerGuard`는 미들웨어와 라우트 매칭 이후의 guard 단계에서 실행됩니다. 해석된 라우트 descriptor로부터 handler별 저장소 키를 만들기 때문입니다.

## Constraints

- 기본 보안 헤더 집합이 필요한 애플리케이션은 `createSecurityHeadersMiddleware()`를 명시적으로 설치해야 합니다. dispatcher가 이를 자동으로 추가하지는 않습니다.
- `allowCredentials: true`인 CORS는 명시적 origin을 사용해야 합니다. `allowOrigin: '*'` 또는 `allowOrigin` 생략은 거부되며, `'*'`를 반환하는 origin 콜백도 요청 시점에 거부됩니다.
- origin을 반영하는 CORS 응답은 캐시가 서로 다른 origin 정책을 합치지 않도록 `Vary: Origin`을 포함해야 합니다.
- 내장 HTTP rate-limit 미들웨어는 기본적으로 프로세스 로컬 메모리를 사용합니다. 다중 인스턴스 배포에서는 이를 공유 quota 메커니즘으로 취급하면 안 됩니다.
- 프록시 기반 client identity는 기본적으로 비활성화되어 있습니다. `trustProxyHeaders: true`는 어댑터가 `Forwarded`, `X-Forwarded-For`, `X-Real-IP`를 재작성하는 신뢰 가능한 프록시 뒤에 있을 때만 활성화해야 합니다.
- `@fluojs/throttler`의 handler 단위 throttling은 해석된 라우트 시그니처와 client identity를 저장소 키로 사용하므로, 하나의 전역 버킷이 아니라 route-handler 경계마다 제한을 적용합니다.
- `@Throttle({ ttl, limit })`와 `@SkipThrottle()`는 guard 단계의 throttling 정책만 바꿉니다. app 레벨 HTTP 미들웨어 동작은 바꾸지 않습니다.
