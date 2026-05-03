# OpenAPI 생성 계약

<p><a href="./openapi.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/openapi`가 구현하는 현재 OpenAPI 문서 생성 계약을 정의합니다.

## 모듈 등록 규칙

| 규칙 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 모듈 진입점 | 애플리케이션은 `OpenApiModule.forRoot(options)` 또는 `OpenApiModule.forRootAsync(options)`로 OpenAPI를 등록합니다. | `packages/openapi/src/openapi-module.ts` |
| 필수 옵션 | 옵션 프로바이더는 반드시 `title`과 `version`을 해석해야 합니다. 둘 중 하나라도 없으면 모듈 설정이 실패합니다. | `packages/openapi/src/openapi-module.ts` |
| 핸들러 포함 경계 | 이 모듈은 `sources`와 `descriptors`에서만 HTTP 핸들러를 포함합니다. `@Module({ controllers: [...] })`만으로는 핸들러를 자동 추론하지 않습니다. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/README.md` |
| 소스 합성 | `sources`와 `descriptors`가 모두 제공되면, 모듈은 두 집합을 하나의 문서 입력으로 이어 붙입니다. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/openapi-module.test.ts` |
| 노출 경로 | 런타임 모듈은 항상 `GET /openapi.json`을 마운트합니다. `GET /docs`는 Swagger UI 페이지로 마운트되지만, `ui`가 비활성화되면 `NotFoundException`을 던집니다. | `packages/openapi/src/openapi-module.ts` |

## 메타데이터 소스

| 소스 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 기본 문서 버전 | `buildOpenApiDocument(...)`는 항상 `openapi: '3.1.0'`을 생성합니다. | `packages/openapi/src/schema-builder.ts` |
| HTTP 라우트 메타데이터 | 경로, HTTP 메서드, 핸들러 이름, 해석된 URI 버전 경로는 fluo HTTP handler descriptor에서 옵니다. Express 스타일 `:id` 경로 세그먼트는 최종 문서에서 `{id}`로 변환됩니다. | `packages/openapi/src/schema-builder.ts` |
| 컨트롤러 태그 | `@ApiTag(...)`가 컨트롤러 태그를 정의합니다. 없으면 컨트롤러 클래스 이름이 기본 태그가 됩니다. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/schema-builder.ts` |
| 오퍼레이션 메타데이터 | `@ApiOperation(...)`는 핸들러별 `summary`, `description`, `deprecated` 플래그를 저장합니다. | `packages/openapi/src/decorators.ts` |
| 응답 메타데이터 | `@ApiResponse(...)`는 명시적 status/description/schema/type 메타데이터를 저장합니다. DTO `type` 값은 component schema reference로 변환됩니다. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/schema-builder.ts` |
| 파라미터 및 body 메타데이터 | `@ApiParam(...)`, `@ApiQuery(...)`, `@ApiHeader(...)`, `@ApiCookie(...)`, `@ApiBody(...)`가 명시적 parameter와 request-body 메타데이터를 제공합니다. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/schema-builder.ts` |
| DTO 스키마 생성 | DTO 스키마는 `getDtoBindingSchema(...)`와 `getDtoValidationSchema(...)`를 통한 바인딩/검증 메타데이터에서 파생되며, `components.schemas`로 출력됩니다. | `packages/openapi/src/schema-builder.ts` |
| 보안 메타데이터 | `@ApiBearerAuth()`와 `@ApiSecurity()`는 operation 수준 보안 요구사항을 추가합니다. `securitySchemes` 옵션은 `components.securitySchemes`를 채웁니다. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/schema-builder.ts` |

## 출력 표면

| 표면 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| JSON 문서 | `GET /openapi.json`은 생성된 `OpenApiDocument`를 반환합니다. | `packages/openapi/src/openapi-module.ts` |
| Swagger UI | `GET /docs`는 런타임 JSON 경로를 가리키는 HTML을 렌더링하며, 고정된 `swagger-ui-dist` 버전 `5.32.2`를 사용합니다. | `packages/openapi/src/openapi-module.ts` |
| 기본 오류 응답 | `defaultErrorResponsesPolicy`의 기본값은 `'inject'`입니다. `'omit'`으로 설정하면 builder가 프레임워크 기본 오류 응답을 추가하지 않을 수 있습니다. | `packages/openapi/src/schema-builder.ts`, `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/openapi-module.test.ts` |
| 추가 모델 | `extraModels`를 사용하면 핸들러에서 직접 발견되지 않는 DTO 생성자도 포함할 수 있습니다. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/schema-builder.ts` |
| 최종 변환 | `documentTransform(document)`는 생성된 문서를 노출 전에 다시 쓸 수 있습니다. | `packages/openapi/src/openapi-module.ts` |

## 생성 경계

- `@ApiExcludeEndpoint()`는 생성된 `paths`에서 특정 핸들러를 제거하지만, 런타임 라우트 자체를 바꾸지는 않습니다.
- OpenAPI 생성은 descriptor 기반입니다. `sources`나 `descriptors`에 표현되지 않은 컨트롤러 또는 핸들러는 생성 문서 경계 밖입니다.
- 이 패키지는 HTTP 표면만 문서화합니다. 비HTTP 전송에 대한 계약은 생성하지 않습니다.
- Swagger UI는 선택적이며 런타임에서 제공됩니다. UI 지원이 비활성화되어도 OpenAPI JSON 문서는 계속 제공됩니다.
- 이 패키지는 fluo 패키지의 명시적 메타데이터와 DTO 스키마 리더를 사용합니다.
