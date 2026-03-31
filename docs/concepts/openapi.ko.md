# OpenAPI

<p><strong><kbd>English</kbd></strong> <a href="./openapi.ko.md"><kbd>한국어</kbd></a></p>

이 가이드는 `@konekti/openapi`, `@konekti/http`, 그리고 요청 DTO 메타데이터 시스템에서 사용되는 OpenAPI 생성 모델을 설명합니다.

### 관련 문서

- `./http-runtime.ko.md`
- `../../packages/openapi/README.md`
- `../../packages/http/README.md`

## 등록 및 서빙

OpenAPI 지원을 활성화하려면 `OpenApiModule.forRoot(...)`를 사용하세요. 기본적으로 다음 기능을 제공합니다:

- **JSON 문서**: `GET /openapi.json`
- **Swagger UI** (선택 사항): `GET /docs`

OpenAPI 문서는 애플리케이션 시작 시점에 핸들러 디스크립터(handler descriptors)로부터 구축됩니다. `OpenApiModule.forRoot(...)`는 빌드된 디스크립터 또는 `createHandlerMapping()`에서 사용되는 `HandlerSource[]` 모델을 받아들입니다.

## 문서화 데코레이터

Konekti는 OpenAPI 메타데이터를 위해 특화된 몇 가지 데코레이터를 제공합니다:

- **`@ApiTag(tag)`**: 작업을 그룹화합니다.
- **`@ApiOperation({ summary, description })`**: 엔드포인트의 목적을 설명합니다.
- **`@ApiResponse(status, { description, schema, type })`**: 가능한 응답 코드와 구조를 문서화합니다.
- **`@ApiBearerAuth()`**: 작업에 대해 Bearer 인증을 선언합니다.

이 데코레이터들은 문서화에만 영향을 미치며 런타임 동작을 변경하지 않습니다.

## DTO 스키마 추출

OpenAPI 생성기는 DTO에서 스키마 정보를 추출합니다:

- **메타데이터 읽기**: 요청 DTO 메타데이터는 정규화된 헬퍼 API를 통해 접근됩니다.
- **컴포넌트 스키마**: 검증기 메타데이터(예: `@IsString()`)를 사용하여 `components.schemas`를 구성합니다.
- **요청 바디**: `requestBody`를 통해 연결됩니다.
- **파라미터**: 쿠키 바인딩된 DTO 필드는 쿠키 파라미터로 매핑됩니다.
- **응답**: 응답 DTO는 `@ApiResponse(..., { type: ... })`를 사용하여 지정할 수 있습니다.
- **중첩**: 중첩된 DTO와 배열은 스키마 참조로 표현됩니다.

## 생성 프로세스

- **라우트 메타데이터**: 핸들러 디스크립터에서 추출됩니다.
- **버저닝**: `@Version(...)`을 통해 정의된 버저닝은 URI 경로(예: `/v1/users`)에 반영됩니다.
- **구성**: 태그, 작업, 응답 및 DTO 스키마가 하나의 OpenAPI 3.1 문서로 결합됩니다.
- **라이프사이클**: 문서는 시작 시점에 한 번 생성되어 정적으로 서빙됩니다.

## 아키텍처 경계

- **`@konekti/openapi`**: 스키마 생성 및 서빙 레이어를 처리합니다.
- **`@konekti/http`**: 라우트 및 요청 메타데이터 작성을 관리합니다.
- **디커플링**: `@konekti/openapi`는 정규화된 메타데이터와만 상호작용하며 패키지 내부 저장소에 접근하지 않습니다.
- **인증 방식**: 인증 스킴(scheme)은 OpenAPI 데코레이터를 사용하여 애플리케이션 레벨에서 선언됩니다.

## 개념적 흐름

```text
@konekti/http는 라우트 메타데이터를 기록합니다.
`@konekti/validation` 패키지는 검증 메타데이터를 기록합니다.
@konekti/openapi는 문서를 조립하기 위해 이 둘을 읽습니다.
```
