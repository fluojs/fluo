# OpenAPI 생성 계약

<p><a href="./openapi.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/openapi`가 구현하는 현재 OpenAPI 문서 생성 계약을 정의합니다.

## 모듈 등록 규칙

| 규칙 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 모듈 진입점 | 애플리케이션은 `OpenApiModule.forRoot(options)` 또는 `OpenApiModule.forRootAsync(options)`로 OpenAPI를 등록합니다. | `packages/openapi/src/openapi-module.ts` |
| 필수 옵션 | 옵션 프로바이더는 반드시 `title`과 `version`을 해석해야 합니다. 둘 중 하나라도 없으면 모듈 설정이 실패합니다. `sources`와 `descriptors`는 값으로는 선택 사항이지만, 둘 다 생략하면 module이 application graph를 scan하지 않으므로 문서화된 operation이 생성되지 않습니다. | `packages/openapi/src/openapi-module.ts` |
| 핸들러 포함 경계 | 이 모듈은 `sources`와 `descriptors`에서만 HTTP 핸들러를 포함합니다. `@Module({ controllers: [...] })`만으로는 핸들러를 자동 추론하지 않습니다. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/README.md` |
| 소스 합성과 충돌 | 두 입력을 모두 제공하면 `sources`에서 발견한 descriptor를 먼저, explicit `descriptors`를 나중에 합성합니다. 같은 OpenAPI path/method operation이 중복되면 나중 descriptor가 우선하므로 explicit descriptor가 discovered source operation을 덮어씁니다. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/schema-builder.ts`, `packages/openapi/src/openapi-module.test.ts` |
| 노출 경로 | 각 runtime module은 `documentPath`(기본 `/openapi.json`)에서 JSON을 제공하고 `uiPath`(기본 `/docs`)를 예약합니다. Swagger UI는 opt-in이며, UI route는 `ui: true`일 때만 페이지를 제공하고 그 외에는 `NotFoundException`을 던집니다. | `packages/openapi/src/openapi-module.ts` |
| Async route option | `forRootAsync(...)`의 `documentPath`와 `uiPath`는 injected document-options factory가 resolve되기 전에 route가 compile되므로 outer registration에서 받습니다. | `packages/openapi/src/openapi-module.ts` |
| Runtime route 충돌 | Document/UI path는 일반 HTTP path normalization을 사용합니다. 한 registration 내부, 여러 OpenAPI registration 사이, 또는 다른 application controller와 정규화된 `GET` route가 중복되면 bootstrap이 `RouteConflictError`로 실패합니다. Runtime route에는 OpenAPI descriptor의 later-wins precedence가 적용되지 않습니다. | `packages/openapi/src/openapi-module.ts`, `packages/http/src/mapping.ts`, `packages/openapi/src/openapi-module-routes.test.ts` |

## 메타데이터 소스

| 소스 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 기본 문서 버전 | `buildOpenApiDocument(...)`는 항상 `openapi: '3.1.0'`을 생성합니다. | `packages/openapi/src/schema-builder.ts` |
| HTTP 라우트 메타데이터 | 경로, HTTP 메서드, 핸들러 이름, 해석된 URI 버전 경로는 fluo HTTP handler descriptor에서 옵니다. Express 스타일 `:id` 경로 세그먼트는 최종 문서에서 `{id}`로 변환됩니다. | `packages/openapi/src/schema-builder.ts` |
| 컨트롤러 태그 | `@ApiTag(...)`가 컨트롤러 태그를 정의합니다. 없으면 컨트롤러 클래스 이름이 기본 태그가 됩니다. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/schema-builder.ts` |
| 오퍼레이션 메타데이터 | `@ApiOperation(...)`는 핸들러별 `summary`, `description`, `deprecated` 플래그를 저장합니다. | `packages/openapi/src/decorators.ts` |
| 응답 메타데이터 | `@ApiResponse(...)`는 명시적 status/description/schema/type 메타데이터를 저장합니다. DTO `type` 값은 component schema reference로 변환됩니다. Handler 반환값과 TypeScript 반환 타입은 검사하지 않습니다. `@ApiResponse(...)`가 없으면 builder는 추론된 response schema가 아니라 method-derived 또는 `@HttpCode(...)` success status와 `OK` description만 생성합니다. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/schema-builder.ts` |
| 파라미터 및 body 메타데이터 | `@ApiParam(...)`, `@ApiQuery(...)`, `@ApiHeader(...)`, `@ApiCookie(...)`, `@ApiBody(...)`가 명시적 parameter와 request-body 메타데이터를 제공합니다. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/schema-builder.ts` |
| DTO 스키마 생성 | DTO 스키마는 `getDtoBindingSchema(...)`와 `getDtoValidationSchema(...)`를 통한 바인딩/검증 메타데이터에서 파생되며, `components.schemas`로 출력됩니다. | `packages/openapi/src/schema-builder.ts` |
| 보안 메타데이터 | `@ApiBearerAuth()`와 `@ApiSecurity()`는 operation 수준 보안 요구사항을 추가합니다. `securitySchemes` 옵션은 `components.securitySchemes`를 채웁니다. | `packages/openapi/src/decorators.ts`, `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/schema-builder.ts` |

## 출력 표면

| 표면 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| JSON 문서 | `GET documentPath`는 생성된 `OpenApiDocument`를 반환하며, `documentPath`의 기본값은 `/openapi.json`입니다. | `packages/openapi/src/openapi-module.ts` |
| Swagger UI | `ui: true`일 때 `GET uiPath`는 runtime global prefix 아래에서도 해당 module instance의 `documentPath`를 가리키는 HTML을 렌더링합니다. `uiPath`의 기본값은 `/docs`입니다. 기본 asset은 고정된 `swagger-ui-dist` 버전 `5.32.2`를 사용하며, self-hosted 또는 CSP-controlled deployment에서는 `swaggerUiAssets.cssUrl`과 `swaggerUiAssets.jsBundleUrl`로 URL을 교체할 수 있습니다. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/swagger-ui.ts` |
| 기본 오류 응답 | `defaultErrorResponsesPolicy`의 기본값은 `'inject'`입니다. `'omit'`으로 설정하면 builder가 프레임워크 기본 오류 응답을 추가하지 않을 수 있습니다. | `packages/openapi/src/schema-builder.ts`, `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/openapi-module.test.ts` |
| 추가 모델 | `extraModels`를 사용하면 핸들러에서 직접 발견되지 않는 DTO 생성자도 포함할 수 있습니다. | `packages/openapi/src/openapi-module.ts`, `packages/openapi/src/schema-builder.ts` |
| 최종 변환 | `documentTransform(document)`는 생성된 문서를 노출 전에 다시 쓸 수 있습니다. | `packages/openapi/src/openapi-module.ts` |

## 생성 경계

- `@ApiExcludeEndpoint()`는 생성된 `paths`에서 특정 핸들러를 제거하지만, 런타임 라우트 자체를 바꾸지는 않습니다.
- OpenAPI 생성은 descriptor 기반입니다. `sources`나 `descriptors`에 표현되지 않은 컨트롤러 또는 핸들러는 생성 문서 경계 밖입니다.
- Response 생성은 return-value-driven 방식이 아니라 metadata-driven 방식입니다. Client가 문서에서 response content를 확인해야 하면 `@ApiResponse(...)`에 `schema` 또는 `type`을 사용합니다.
- 이 패키지는 HTTP 표면만 문서화합니다. 비HTTP 전송에 대한 계약은 생성하지 않습니다.
- Swagger UI는 선택적이며 런타임에서 제공됩니다. UI 지원이 비활성화되어도 OpenAPI JSON 문서는 계속 제공됩니다.
- Swagger UI를 비활성화해도 `uiPath` 등록은 제거되지 않습니다. 해당 route는 계속 예약되며 명시적인 disabled-UI not-found response를 반환합니다.
- 이 패키지는 fluo 패키지의 명시적 메타데이터와 DTO 스키마 리더를 사용합니다.
