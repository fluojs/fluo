# http runtime

<p><a href="./http-runtime.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 `@konekti/http`, `@konekti/runtime`, 인증 패키지 및 생성된 시작 애플리케이션 전반에 걸친 현재 HTTP 실행 모델을 설명합니다.

함께 보기:

- `./architecture-overview.md`
- `./auth-and-jwt.md`
- `../../packages/http/README.md`

## request lifecycle

```text
HTTP adapter
-> RequestContext 생성
-> app middleware
-> route match
-> module middleware
-> guard chain
-> interceptor chain
-> request DTO 바인딩
-> DTO 유효성 검사
-> controller 호출
-> 성공 상태(success status) 해소
-> response 쓰기
-> 필요한 경우 예외 매핑
```

## success status defaults

명시적인 재정의가 없으면 dispatcher는 메서드 기반의 성공 상태 기본값을 사용합니다:

- `GET`, `PUT`, `PATCH`, `HEAD` -> `200`
- `POST` -> `201`
- `DELETE`, `OPTIONS` -> 최종 해소된 값이 `undefined`이면 `204`, 그렇지 않으면 `200`

`@SuccessStatus(code)`는 항상 이러한 기본값보다 우선합니다.

이 결정은 interceptor 체인이 해소된 후에 발생하므로, interceptor의 결과 가공(shaping)은 여전히 최종 기본 상태에 영향을 미칩니다.

## DTO boundary

- 요청 DTO 바인딩은 `@konekti/http`의 소관입니다.
- `@FromBody()`, `@FromPath()`와 같은 필드 소스 데코레이터도 `@konekti/http`에 속합니다.
- `@IsString()`, `@MinLength()`와 같은 유효성 검사 데코레이터는 `@konekti/dto-validator`에 속합니다.

runtime은 요청 DTO를 단순한 편의성 복제 단계가 아닌 명확한 경계로 취급합니다.

## starter-app HTTP policies

생성된 시작 애플리케이션은 몇 가지 HTTP 기본값을 일관되게 유지합니다:

- runtime 소유의 `/health` 및 `/ready`
- `@konekti/metrics`를 통한 `/metrics`
- `@konekti/openapi`를 통한 `/openapi.json`
- runtime 부트스트랩 설정에 따른 기본 CORS 정책

이러한 기본값들은 시작 애플리케이션에서 패키지들이 어떻게 구성되는지 설명하므로, 개별 패키지 README보다 상위 수준에서 다뤄집니다.

## where to look next

- 패키지 API 상세 -> `packages/http/README.md`
- runtime 부트스트랩 -> `packages/runtime/README.md`
- 인증 strategy 흐름 -> `./auth-and-jwt.md`
- 시작 애플리케이션 HTTP 기본값 -> `../getting-started/quick-start.md`
