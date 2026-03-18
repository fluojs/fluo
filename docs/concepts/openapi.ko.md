# OpenAPI

<p><a href="./openapi.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 `@konekti/openapi`, `@konekti/http`, 그리고 요청 DTO 메타데이터 전반에 걸친 현재 OpenAPI 생성 모델을 설명합니다.

함께 보기:

- `./http-runtime.md`
- `../../packages/openapi/README.md`
- `../../packages/http/README.md`

## 모듈 등록

`OpenApiModule.forRoot(...)`를 통해 다음 기능을 제공합니다:

- `GET /openapi.json`
- `/docs`에서 선택적으로 Swagger UI 제공

문서는 애플리케이션 시작 시점에 수집된 핸들러 디스크립터(handler descriptors)를 기반으로 작성됩니다.

## 작업 수준 데코레이터 (operation-level decorators)

현재 Konekti는 다음 데코레이터들을 지원합니다:

- `@ApiTag(tag)`
- `@ApiOperation({ summary, description })`
- `@ApiResponse(status, { description, schema, type })`
- `@ApiBearerAuth()`

이 데코레이터들은 메타데이터 전용이며, 런타임 요청 처리에는 영향을 주지 않습니다.

## DTO 스키마 추출

- 요청 DTO 메타데이터는 표준화된 헬퍼를 통해 읽어옵니다.
- 검증기(validator) 메타데이터가 `components.schemas`를 구성합니다.
- 요청 DTO는 `requestBody`를 통해 연결됩니다.
- 응답 DTO는 `@ApiResponse(..., { type: ... })`를 통해 참조할 수 있습니다.
- 중첩된 DTO와 배열은 가능한 경우 컴포넌트 스키마 참조로 표현됩니다.

## 생성 모델

- 라우트 메타데이터는 핸들러 디스크립터에서 읽어옵니다.
- `@Version(...)`이 기록한 URI 버저닝은 `/v1/users` 같은 해결된 OpenAPI path에 그대로 반영됩니다.
- 태그, 작업 메타데이터, 응답 메타데이터, 요청 DTO 스키마가 하나의 OpenAPI 3.1 문서로 통합됩니다.
- 생성된 문서는 시작 시점에 빌드되어 정적으로 서빙됩니다.

## 소유권 경계

- `@konekti/openapi`가 스키마 생성 및 서빙 로직을 소유합니다.
- `@konekti/http`가 라우트 및 요청 메타데이터 작성을 담당합니다.
- `@konekti/openapi`는 표준화된 메타데이터를 읽으며, 패키지 내부의 저장 세부 사항에 직접 접근하지 않아야 합니다.
- 인증 방식 선언은 OpenAPI 데코레이터를 통해 애플리케이션 주도로 유지됩니다.

## 실용적인 멘탈 모델

```text
@konekti/http는 런타임 메타데이터를 기록합니다.
@konekti/dto-validator는 검증 메타데이터를 기록합니다.
@konekti/openapi는 문서를 생성하기 위해 이 둘을 모두 읽습니다.
```
