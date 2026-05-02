# @fluojs/openapi

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 데코레이터 기반 OpenAPI 3.1.0 문서 생성 패키지입니다. 별도의 수동 동기화 없이 API 문서를 자동으로 생성하고 제공하며, 선택적으로 Swagger UI를 지원합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [핵심 기능](#핵심-기능)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/openapi
```

## 사용 시점

- **Swagger UI**를 사용하여 REST API에 대한 대화형 문서를 제공하고 싶을 때.
- 클라이언트 생성 또는 테스트를 위해 기계 읽기 가능한 **OpenAPI 3.1.0** 명세가 필요할 때.
- 표준 데코레이터를 사용하여 API 문서와 코드를 동기화된 상태로 유지하고 싶을 때.
- DTO 및 검증 메타데이터를 사용하여 복잡한 요청/응답 모델을 문서화해야 할 때.

## 빠른 시작

`OpenApiModule`을 등록하고 `sources`(또는 미리 만든 `descriptors`)를 전달해 문서에 포함할 HTTP 핸들러를 명시합니다.

```typescript
import { Controller, Get } from '@fluojs/http';
import { Module } from '@fluojs/core';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';
import { OpenApiModule, ApiOperation, ApiResponse, ApiTag } from '@fluojs/openapi';

@ApiTag('Users')
@Controller('/users')
class UsersController {
  @ApiOperation({ summary: '전체 사용자 목록 조회' })
  @ApiResponse(200, { description: '성공' })
  @Get('/')
  list() {
    return [];
  }
}

@Module({
  imports: [
    OpenApiModule.forRoot({
      sources: [{ controllerToken: UsersController }],
      title: 'My API',
      version: '1.0.0',
      ui: true, // /docs에서 Swagger UI 활성화
    })
  ],
  controllers: [UsersController]
})
class AppModule {}

const app = await bootstrapNodeApplication(AppModule);
await app.listen(3000);
// OpenAPI JSON: http://localhost:3000/openapi.json
// Swagger UI: http://localhost:3000/docs
```

컨트롤러 탐색을 직접 건너뛰고 싶다면 `descriptors: createHandlerMapping([...]).descriptors`를 대신 전달할 수 있습니다. `OpenApiModule`은 `@Module({ controllers: [...] })`만으로 핸들러를 자동 추론하지 않습니다.

## 핵심 기능

### 자동 명세 생성
fluo는 컨트롤러와 메서드를 조사하여 전체 OpenAPI 3.1.0 문서를 작성합니다. 여기에는 경로, 메서드, 파라미터 및 요청 바디가 포함됩니다.

### 응답 미디어 타입
HTTP 핸들러가 `@fluojs/http`의 `@Produces(...)`를 선언하면, 생성된 OpenAPI 응답은 해당 미디어 타입을 response `content` 키로 사용합니다. 예를 들어 `@ApiResponse(...)` 스키마가 있는 핸들러에 `@Produces('application/json', 'application/problem+json')`를 붙이면, `application/json`만으로 되돌아가지 않고 두 미디어 타입 모두 같은 응답 스키마로 방출합니다.

### 통합 DTO 스키마
`@fluojs/validation`과 원활하게 작동합니다. DTO 클래스는 자동으로 OpenAPI 컴포넌트로 변환되어 적절한 오퍼레이션에서 참조됩니다.

### 버전 관리 지원
`@fluojs/http`의 URI 기반 버전 관리를 자동으로 처리합니다. OpenAPI 경로에 해결된 버전 경로가 올바르게 반영됩니다.

### 보안 문서화
`@ApiBearerAuth()` 및 `@ApiSecurity()`를 사용하여 Bearer 토큰이나 API 키와 같은 보안 요구사항을 쉽게 문서화할 수 있습니다.

같은 scheme에 대해 여러 `@ApiSecurity()` 데코레이터를 쌓으면, 해당 scheme의 scope가 하나의 누적 OpenAPI security requirement로 병합됩니다. 따라서 라우트가 `['reports:read']`와 `['reports:write', 'reports:read']`처럼 겹치는 scope를 선언해도 OAuth 스타일 요구사항은 결정적으로 유지되며, 서로 다른 scheme은 별도 requirement로 남습니다.

### 결정적인 Swagger UI 자산
`ui: true`를 활성화하면 생성되는 `/docs` 페이지는 정확한 `swagger-ui-dist` 버전의 자산을 참조하여 패키지 릴리스마다 동일한 동작을 유지합니다. 오프라인 또는 CSP 제어 환경에서 자체 호스팅 자산이 필요하면 `swaggerUiAssets.cssUrl`과 `swaggerUiAssets.jsBundleUrl`을 설정하세요. 생성된 HTML은 해당 URL을 이스케이프하며 Swagger UI 인스턴스를 `window.ui`에 노출하지 않습니다.

### 모듈 옵션 결정성
`OpenApiModule.forRoot(...)`는 등록 시점에 옵션을 스냅샷하고 freeze합니다. 등록 후 원본 options 객체, `sources`, `descriptors`, `securitySchemes`, `extraModels`, `swaggerUiAssets`를 변경해도 제공되는 OpenAPI 문서나 `/docs` HTML은 바뀌지 않습니다. `OpenApiModule.forRootAsync(...)`도 async factory가 resolve된 뒤 같은 스냅샷을 적용하며, factory 실패는 bootstrap 중 전파됩니다.

## 공개 API

- `OpenApiModule`: OpenAPI 통합을 위한 메인 엔트리 포인트.
- `ApiTag`, `ApiOperation`, `ApiResponse`: 문서화 데코레이터.
- `ApiBody`, `ApiParam`, `ApiQuery`, `ApiHeader`, `ApiCookie`: 이름이 겹칠 때 추론된 요청 문서를 대체하는 명시적 요청 본문 및 파라미터 문서화 데코레이터.
- `ApiBearerAuth`, `ApiSecurity`: 보안 요구사항 데코레이터.
- `ApiExcludeEndpoint`: 특정 핸들러를 문서화에서 제외.
- `buildOpenApiDocument`: 프로그래밍 방식의 문서 빌더 (저수준).
- `OpenApiHandlerRegistry`: 고급 통합에서 문서 생성 전에 handler descriptor를 스냅샷하는 mutable descriptor registry.
- `getControllerTags`, `getMethodApiMetadata`: 고급 테스트와 통합 tooling을 위한 metadata reader.
- `OpenApiSchemaObject`: 명시적 `@ApiBody(...)` 및 `@ApiResponse(...)` 스키마를 위한 타입화된 스키마 표면입니다. OpenAPI 3.1 조합(`allOf`, `oneOf`, `anyOf`), 객체/배열 제약, examples/defaults, 읽기/쓰기/Deprecated 주석을 포함합니다.

## 관련 패키지

- `@fluojs/core`: 공유 메타데이터 유틸리티.
- `@fluojs/http`: 컨트롤러 및 라우팅 통합.
- `@fluojs/validation`: DTO를 통한 스키마 및 모델 생성.

## 예제 소스

- `packages/openapi/src/openapi-module.test.ts`: 통합 테스트 및 사용 예제.
- `examples/openapi-swagger`: 전체 OpenAPI 애플리케이션 예제.
