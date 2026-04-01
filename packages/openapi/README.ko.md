# @konekti/openapi

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션을 위한 데코레이터 기반 OpenAPI 3.1.0 문서 생성 패키지입니다. 컨트롤러와 핸들러에 어노테이션을 달고 `OpenApiModule`을 마운트하면 `/openapi.json`에서 스펙을 자동으로 제공하고, 선택적으로 `/docs`에서 Swagger UI를 제공합니다.

## 관련 문서

- `../../docs/concepts/openapi.md`
- `../../docs/concepts/http-runtime.md`

## 설치

```bash
pnpm add @konekti/openapi
```

## 빠른 시작

```typescript
import { Controller, Get, Post, Version } from '@konekti/http';
import { Module } from '@konekti/core';
import { bootstrapApplication } from '@konekti/runtime';
import {
  ApiTag,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  OpenApiModule,
} from '@konekti/openapi';

@Version('1')
@ApiTag('Users')
@Controller('/users')
class UsersController {
  @ApiOperation({ summary: '전체 사용자 목록 조회' })
  @ApiResponse(200, { description: '사용자 배열' })
  @Get('/')
  listUsers() {
    return [];
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: '사용자 생성' })
  @ApiResponse(201, { description: '생성된 사용자' })
  @Post('/')
  createUser() {
    return {};
  }
}

@Module({
  controllers: [UsersController],
  imports: [
    OpenApiModule.forRoot({
      sources: [{ controllerToken: UsersController }],
      title: 'My API',
      version: '1.0.0',
      ui: true,               // /docs에서 Swagger UI 활성화
    }),
  ],
})
class AppModule {}

await bootstrapApplication({ rootModule: AppModule });
// GET /openapi.json  → OpenAPI 3.1.0 JSON 문서
// GET /docs          → Swagger UI
```

## 핵심 API

### `OpenApiModule.forRoot(options)`

두 개의 HTTP 엔드포인트를 등록하고 다른 모듈로 임포트할 수 있는 `ModuleType`을 반환합니다.

```typescript
interface OpenApiModuleOptions {
  title: string;
  version: string;
  defaultErrorResponsesPolicy?: 'inject' | 'omit'; // 기본값: 'inject'
  descriptors?: readonly HandlerDescriptor[];  // createHandlerMapping()의 핸들러 디스크립터
  sources?: readonly HandlerSource[];          // createHandlerMapping()에서 사용하는 핸들러 소스 모델
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
  extraModels?: Constructor[];
  documentTransform?: (document: OpenApiDocument) => OpenApiDocument;
  ui?: boolean;                                 // /docs에서 Swagger UI 제공 (기본값: false)
}

class OpenApiModule {
  static forRoot(options: OpenApiModuleOptions): ModuleType;
}
```

**엔드포인트:**

| 라우트 | 설명 |
|-------|-------------|
| `GET /openapi.json` | 생성된 OpenAPI 3.1.0 JSON을 반환합니다. |
| `GET /docs` | Swagger UI HTML을 반환합니다 (`ui: true`인 경우에만). |

---

## 데코레이터

### `@ApiTag(tag)`

컨트롤러 클래스의 모든 오퍼레이션에 OpenAPI 태그를 부여합니다.

```typescript
@ApiTag('Products')
@Controller('/products')
class ProductsController { ... }
```

### `@ApiOperation(options)`

핸들러의 오퍼레이션 객체를 문서화합니다.

```typescript
interface ApiOperationOptions {
  summary?: string;
  description?: string;
  deprecated?: boolean;
}

@ApiOperation({ summary: 'ID로 상품 조회', description: '단일 상품 정보를 반환합니다.' })
@Get('/:id')
getProduct() { ... }
```

### `@ApiResponse(status, options)`

핸들러의 응답을 문서화합니다.

```typescript
interface ApiResponseOptions {
  description?: string;
  schema?: Record<string, unknown>;
  type?: Constructor;
}

@ApiResponse(200, { description: '조회된 상품', type: ProductDto })
@ApiResponse(404, { description: '상품을 찾을 수 없음' })
@Get('/:id')
getProduct() { ... }
```

동일한 핸들러에 여러 개의 `@ApiResponse` 데코레이터를 중첩해서 사용할 수 있습니다.

### `@konekti/validation` 패키지의 매핑된 DTO 헬퍼

OpenAPI 생성 시 `PickType()`, `OmitType()`, `IntersectionType()`, `PartialType()` 요청 DTO의 메타데이터가 보존되므로, 파생된 요청 바디와 파라미터 스키마가 해결된 DTO 클래스를 기반으로 계속 렌더링됩니다.

`PartialType()`은 필수 여부 시맨틱도 변경합니다. 생성된 OpenAPI 문서에서 요청 바디와 경로가 아닌 파라미터는 선택 사항(optional)이 되지만, 경로 파라미터는 OpenAPI 스펙상 필수여야 하므로 필수 상태로 유지됩니다.

### `@konekti/http`의 `@Version(value)`

컨트롤러나 핸들러 레벨에서 URI 버전 관리가 적용되면, OpenAPI 경로에 해결된 버전 경로가 직접 반영됩니다.

```typescript
@Version('1')
@Controller('/users')
class UsersController {
  @Get('/')
  listUsers() {}
}

// OpenAPI 경로: /v1/users
```

### `@ApiBearerAuth()`

핸들러에 Bearer 토큰 인증이 필요함을 표시합니다. 오퍼레이션의 `security` 요구사항에 `bearerAuth`를 추가하고, 생성된 문서에 `bearerAuth` 보안 스킴을 등록합니다.

```typescript
@ApiBearerAuth()
@Post('/')
createProduct() { ... }
```

### `@ApiSecurity(name, scopes?)`

런타임 인증 동작을 바꾸지 않고 OpenAPI 보안 요구사항을 일반화하여 선언합니다.

```typescript
@ApiSecurity('apiKeyAuth')
@ApiSecurity('oauth2Auth', ['users:read'])
@Get('/')
listProducts() { ... }
```

### `@ApiExcludeEndpoint()`

핸들러를 생성된 OpenAPI `paths`에서 제외합니다.

```typescript
@ApiExcludeEndpoint()
@Get('/internal')
getInternalHealth() { ... }
```

---

## 문서 구조

생성된 문서는 OpenAPI 3.1.0 표준을 따릅니다.

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "My API",
    "version": "1.0.0"
  },
  "paths": {
    "/users": {
      "get": {
        "operationId": "<자동 생성됨>",
        "tags": ["Users"],
        "summary": "전체 사용자 목록 조회",
        "responses": {
          "200": { "description": "사용자 배열" }
        }
      }
    }
  }
}
```

- **`operationId`**는 기본 태그, 핸들러 이름, HTTP 메서드, 정규화된 라우트 경로를 조합하여 자동으로 생성됩니다 (예: `Users_listUsers_get_v1_users`).
- **`tags`**는 `@ApiTag`를 사용하지 않은 경우 컨트롤러 클래스 이름이 기본값으로 사용됩니다.
- **`security`** 요구사항은 `@ApiBearerAuth()` 또는 `@ApiSecurity(...)`로 선언할 수 있습니다.
- **`securitySchemes`**는 모듈/문서 옵션으로 등록할 수 있습니다(API key, HTTP, OAuth2, OpenID Connect). `@ApiBearerAuth()`가 사용되면 `bearerAuth`는 기존처럼 자동 등록됩니다.
- `@konekti/validation` 패키지로 장식된 요청 DTO는 `components.schemas` 항목으로 생성되며 `requestBody`를 통해 연결됩니다.
- `extraModels`로 요청/응답 DTO 탐색에 직접 연결되지 않은 모델도 `components.schemas`에 미리 등록할 수 있습니다.
- 쿠키에 바인딩된 DTO 필드는 `in: cookie` 파라미터로 생성됩니다.
- 요청 바디는 바인딩된 DTO 필드 중 최소 하나 이상이 필수인 경우에만 `required: true`로 표시됩니다.
- 기본 오류 응답 (`400`, `401`, `403`, `404`, `500`)은 기본적으로 주입되며, `defaultErrorResponsesPolicy: 'omit'` 설정을 통해 비활성화할 수 있습니다.
- 바디가 아닌 파라미터 필드는 런타임 호환 스칼라/배열 형태로 생성됩니다. 쿼리/헤더/쿠키/경로 파라미터에 대해서는 중첩된 객체 참조가 생성되지 않습니다.
- `@ApiOperation({ deprecated: true })`는 OpenAPI operation deprecation 메타데이터를 출력합니다.
- `@ApiExcludeEndpoint()`는 해당 핸들러를 문서화 대상에서 제외합니다.

---

## 저수준 API

고급 사용 사례(예: 커스텀 문서 생성 파이프라인)를 위해 익스포트됩니다.

추가적인 공개 익스포트에는 `OpenApiHandlerRegistry`, `OpenApiModuleOptions`, 그리고 `src/index.ts`에서 다시 익스포트되는 스키마/타입 인터페이스가 포함됩니다.

### `buildOpenApiDocument(options)`

서버를 구동하지 않고 핸들러 디스크립터로부터 직접 OpenAPI 문서를 빌드합니다.

```typescript
interface BuildOpenApiDocumentOptions {
  defaultErrorResponsesPolicy?: 'inject' | 'omit'; // 기본값: 'inject'
  descriptors: readonly HandlerDescriptor[];
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
  extraModels?: Constructor[];
  documentTransform?: (document: OpenApiDocument) => OpenApiDocument;
  title: string;
  version: string;
}

function buildOpenApiDocument(options: BuildOpenApiDocumentOptions): OpenApiDocument;
```

### 메타데이터 리더

프로그래밍 방식으로 데코레이터 메타데이터를 읽습니다.

```typescript
function getControllerTags(target: Function): string[] | undefined;
function getMethodApiMetadata(target: Function, propertyKey: MetadataPropertyKey): MethodApiMetadata | undefined;
```

두 게터(getter) 모두 내부 데코레이터 메타데이터의 예기치 않은 외부 변경을 방지하기 위해 방어적 복사본을 반환합니다.

```typescript
interface MethodApiMetadata {
  operation?: ApiOperationOptions;
  responses: ApiResponseMetadata[];
  security?: string[];
  securityRequirements?: Record<string, string[]>[];
  excludeEndpoint?: boolean;
}
```

## 의존성

| 패키지 | 역할 |
|---------|------|
| `@konekti/core` | 공유 메타데이터 유틸리티 |
| `@konekti/http` | 컨트롤러/라우팅 데코레이터, `HandlerDescriptor` |
| `@konekti/runtime` | `bootstrapApplication`, `ModuleType` |
