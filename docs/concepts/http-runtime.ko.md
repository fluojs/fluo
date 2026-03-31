# http runtime

<p><a href="./http-runtime.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 `@konekti/http`, `@konekti/runtime`, 인증 패키지, 그리고 생성된 스타터 애플리케이션에서 사용되는 HTTP 실행 모델을 설명합니다.

### 관련 문서

- `./architecture-overview.ko.md`
- `./auth-and-jwt.ko.md`
- `../../packages/http/README.md`

## 요청 생명주기 (request lifecycle)

요청 실행 경로는 다음 순서를 따릅니다:

1.  **HTTP 어댑터**가 요청을 수신합니다.
2.  **RequestContext** 생성.
3.  **애플리케이션 미들웨어** 실행.
4.  **라우트 매칭**.
5.  **모듈 미들웨어** 실행.
6.  **가드 체인** 검증.
7.  **인터셉터 체인** 실행.
8.  **요청 DTO 바인딩**.
9.  **DTO 검증**.
10. **컨트롤러 호출**.
11. **성공 상태 해결**.
12. **응답 쓰기**.
13. **예외 매핑** (에러 발생 시).

## 성공 상태 기본값 (success status defaults)

재정의되지 않는 한, 디스패처는 메서드 기반의 기본값을 사용합니다:

- `GET`, `PUT`, `PATCH`, `HEAD`: `200`
- `POST`: `201`
- `DELETE`, `OPTIONS`: 결과가 `undefined`이면 `204`, 그렇지 않으면 `200`.

이러한 기본값을 재정의하려면 `@HttpCode(code)`를 사용하세요. 상태 해결은 인터셉터 체인 이후에 발생하므로, 인터셉터는 여전히 최종 상태 코드에 영향을 줄 수 있습니다.

## DTO 경계

- **바인딩**: `@konekti/http`가 요청 DTO 바인딩을 처리합니다.
- **소스 데코레이터**: `@FromBody()`와 `@FromPath()`는 `@konekti/http`에서 제공합니다.
- **유효성 검사**: `@IsString()`과 `@MinLength()`는 `@konekti/validation` 패키지에서 제공합니다.

Konekti는 요청 DTO를 트랜스포트 계층과 애플리케이션 로직 사이의 명시적인 경계로 취급합니다.

## 스타터 앱 정책

생성된 스타터 애플리케이션은 다음과 같은 몇 가지 HTTP 기본값을 유지합니다:

- 내장된 `/health` 및 `/ready` 엔드포인트.
- `health/` 모듈을 통한 예제 `/health-info/` 엔드포인트.
- 런타임 부트스트랩 설정에 의해 관리되는 기본 CORS 정책.

## 개발 경계 (development boundaries)

HTTP 및 런타임 규약은 안정성과 명확성을 보장하기 위해 의도적으로 좁게 유지됩니다.

### 현재 우선순위

- 핸들러 시그니처를 `handler(input, ctx)`로 유지합니다.
- 일반 반환 값과 `@HttpCode(...)`를 주요 응답 모델로 사용합니다.
- 미들웨어를 애플리케이션 및 모듈 레벨로 제한합니다.
- 현재의 불리언(허용/거부) 가드 모델을 유지합니다.

### 유보된 기능 (deferred features)

아키텍처의 명확성을 유지하기 위해 다음 항목들은 향후 업데이트로 유보되었습니다:

- 트랜스포트 중립적인 `handler(requestObject)` API.
- 성공 경로를 위한 퍼스트 클래스 응답 래퍼(wrapper) 객체.
- 라우트 레벨 미들웨어 지원.
- 불리언 허용/거부 이상의 복잡한 가드 결과.

## 추가 정보

- **HTTP API 상세**: `../../packages/http/README.md`
- **런타임 부트스트랩**: `../../packages/runtime/README.md`
- **인증 흐름**: `./auth-and-jwt.md`
- **스타터 기본값**: `../getting-started/quick-start.md`
