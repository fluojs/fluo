# @konekti/openapi

Konekti 애플리케이션을 위한 데코레이터 기반 OpenAPI 3.1.0 문서 생성. 컨트롤러와 핸들러에 어노테이션을 달고 `OpenApiModule`을 마운트하면 `/openapi.json`에서 스펙을 자동으로 서빙하고 선택적으로 `/docs`에서 Swagger UI도 제공합니다.

## 설치

```bash
pnpm add @konekti/openapi
```

## 빠른 시작

```typescript
import { Controller, Get, Post, createHandlerMapping } from '@konekti/http';
import { Module } from '@konekti/core';
import { bootstrapApplication } from '@konekti/runtime';
import {
  ApiTag,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  OpenApiModule,
} from '@konekti/openapi';

@ApiTag('Users')
@Controller('/users')
class UsersController {
  @ApiOperation({ summary: '전체 사용자 목록' })
  @ApiResponse({ status: 200, description: '사용자 배열' })
  @Get('/')
  listUsers() {
    return [];
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: '사용자 생성' })
  @ApiResponse({ status: 201, description: '생성된 사용자' })
  @Post('/')
  createUser() {
    return {};
  }
}

const descriptors = createHandlerMapping([{ controllerToken: UsersController }]).descriptors;

@Module({
  controllers: [UsersController],
  imports: [
    OpenApiModule.forRoot({
      descriptors,
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

두 개의 HTTP 엔드포인트를 등록하고 어느 모듈에나 import할 수 있는 `ModuleType`을 반환합니다.

```typescript
interface OpenApiModuleOptions {
  title: string;
  version: string;
  descriptors?: readonly HandlerDescriptor[];  // createHandlerMapping()의 핸들러 디스크립터
  ui?: boolean;                                 // /docs에서 Swagger UI 제공 (기본값: false)
}

class OpenApiModule {
  static forRoot(options: OpenApiModuleOptions): ModuleType;
}
```

**제공되는 엔드포인트:**

| 라우트 | 설명 |
|--------|------|
| `GET /openapi.json` | 항상 제공. 생성된 OpenAPI 3.1.0 JSON 반환. |
| `GET /docs` | `ui: true`일 때만 제공. Swagger UI HTML 반환. |

---

## 데코레이터

### `@ApiTag(tag)`

컨트롤러 클래스의 모든 오퍼레이션에 OpenAPI 태그를 붙입니다.

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
}

@ApiOperation({ summary: 'ID로 상품 조회', description: '단일 상품을 반환합니다.' })
@Get('/:id')
getProduct() { ... }
```

### `@ApiResponse(options)`

핸들러의 응답을 문서화합니다.

```typescript
interface ApiResponseOptions {
  status: number;
  description?: string;
  type?: Constructor;   // 응답 바디 스키마 (향후 사용)
}

@ApiResponse({ status: 200, description: '상품' })
@ApiResponse({ status: 404, description: '찾을 수 없음' })
@Get('/:id')
getProduct() { ... }
```

같은 핸들러에 `@ApiResponse` 데코레이터를 여러 개 중첩할 수 있습니다.

### `@ApiBearerAuth()`

핸들러에 Bearer 토큰 인증이 필요함을 표시합니다. 오퍼레이션의 `security` 요구사항에 `bearerAuth`를 추가하고 생성된 문서에 `bearerAuth` 보안 스킴을 등록합니다.

```typescript
@ApiBearerAuth()
@Post('/')
createProduct() { ... }
```

---

## 문서 구조

생성된 문서는 OpenAPI 3.1.0을 따릅니다:

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
        "operationId": "UsersController_listUsers",
        "tags": ["Users"],
        "summary": "전체 사용자 목록",
        "responses": {
          "200": { "description": "사용자 배열" }
        }
      }
    }
  }
}
```

- **`operationId`**는 `ControllerName_methodName`으로 자동 생성됩니다.
- **`tags`**는 `@ApiTag`를 사용하지 않으면 컨트롤러 클래스 이름으로 기본 설정됩니다.
- **`security`** 스킴은 최소 하나의 핸들러가 `@ApiBearerAuth()`를 사용할 때만 문서에 포함됩니다.

---

## 저수준 API

고급 사용 사례(예: 커스텀 문서 생성 파이프라인)를 위해 export됩니다.

### `buildOpenApiDocument(options)`

서버를 마운트하지 않고 핸들러 디스크립터에서 직접 OpenAPI 문서를 빌드합니다.

```typescript
interface BuildOpenApiDocumentOptions {
  descriptors: readonly HandlerDescriptor[];
  title: string;
  version: string;
}

function buildOpenApiDocument(options: BuildOpenApiDocumentOptions): OpenApiDocument;
```

### 메타데이터 리더

데코레이터 메타데이터를 프로그래밍 방식으로 읽습니다:

```typescript
function getControllerTags(target: Function): string[] | undefined;
function getMethodApiMetadata(target: Function, propertyKey: MetadataPropertyKey): MethodApiMetadata | undefined;
```

---

## 의존성

| 패키지 | 역할 |
|--------|------|
| `@konekti/core` | 공유 메타데이터 유틸리티 |
| `@konekti/http` | 컨트롤러/라우팅 데코레이터, `HandlerDescriptor` |
| `@konekti/runtime` | `bootstrapApplication`, `ModuleType` |
