# 보안 미들웨어 (security middleware)

<p><a href="./security-middleware.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 `@konekti/http`의 현재 트랜스포트 수준 보안 미들웨어 모델을 설명합니다.

함께 보기:

- `./http-runtime.ko.md`
- `../../packages/http/README.ko.md`

## 현재 미들웨어 제품군

### 속도 제한 (rate limiting)

`RateLimitMiddleware`는 다음과 같은 트랜스포트 수준 미들웨어입니다:

- `@konekti/http`에서 내보내집니다.
- 표준 미들웨어 인터페이스를 따릅니다.
- 커스텀 리졸버를 통해 요청 키(request key)를 식별할 수 있습니다.
- 제한을 초과하면 `Retry-After` 헤더와 함께 `429 Too Many Requests`를 반환합니다.
- 기본적으로 프로세스 내 저장소를 사용하므로, 공유 어댑터 없이는 클러스터 환경에서 안전하지 않습니다.

### 보안 헤더 (security headers)

`SecurityHeadersMiddleware`는 다음과 같은 트랜스포트 수준 미들웨어입니다:

- `@konekti/http`에서 내보내집니다.
- 보안에 중점을 둔 기본 헤더 세트를 작성합니다.
- 개별 헤더를 덮어쓰거나 비활성화할 수 있습니다.
- `X-Powered-By` 헤더는 절대 설정하지 않습니다.

## 기본 헤더 세트

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection: 0`
- `Strict-Transport-Security: max-age=15552000; includeSubDomains`
- `Content-Security-Policy: default-src 'self'`
- `Referrer-Policy: strict-origin-when-cross-origin`

## 소유권 경계

- 이 미들웨어들은 HTTP 런타임 패키지와 함께 위치합니다.
- 애플리케이션이 명시적으로 사용하도록 설정해야 하며, 기본적으로 활성화되어 있지는 않습니다.
- 속도 제한은 라우트 디스패치 전에 동작하며 핸들러의 정체는 알지 못합니다.
- 보안 헤더는 핸들러의 결과와 관계없이 적용되어야 합니다.
