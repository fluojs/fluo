<!-- packages: @fluojs/http, @fluojs/openapi -->
<!-- project-state: FluoBlog v1.7 -->

# Chapter 10. OpenAPI Automation

이 장은 FluoBlog에 자동 API 문서를 연결해 구현과 문서가 함께 움직이도록 만드는 방법을 설명합니다. Chapter 9까지 쌓아 온 라우트, DTO, 예외, 보호 규칙을 이제 기계가 읽는 계약으로 정리합니다.

## Learning Objectives
- 생성된 API 문서가 왜 코드와 가까이 있어야 하는지 이해합니다.
- FluoBlog에 `OpenApiModule`을 등록하고 생성된 문서를 노출합니다.
- `@ApiTag()`, `@ApiOperation()`, `@ApiResponse()` 같은 문서화 데코레이터를 사용합니다.
- DTO와 HTTP 메타데이터가 어떻게 OpenAPI 스키마 정보가 되는지 배웁니다.
- 보호된 라우트와 버전 경로가 생성 문서에 어떤 영향을 주는지 이해합니다.
- 문서화된 HTTP API 기반과 함께 Part 1을 마무리합니다.

## Prerequisites
- Chapter 5와 Chapter 9 완료.
- FluoBlog 라우트, DTO, 예외, guard에 익숙합니다.
- Swagger UI 또는 기계가 읽을 수 있는 API 스펙에 대한 기본적인 이해가 있습니다.
- 모듈 설정 예제를 읽는 데 익숙합니다.

## 10.1 Why API Documentation Should Not Drift from the Code

수동 API 문서는 보통 좋은 의도로 시작합니다. 팀이 위키 페이지를 만들거나 프로젝트 루트의 `docs/` 폴더에 별도의 Markdown 파일을 작성하곤 하죠. 처음에는 정확하고 도움이 됩니다.

하지만 현실은 복잡합니다. API는 계속 변합니다. 필드 이름이 바뀌고, 새로운 필수 쿼리 매개변수가 추가되거나, 상태 코드가 `200`에서 `201`로 변경되기도 합니다. 개발자가 구현에 집중하다 보면 이 수동 문서를 업데이트하는 것을 깜빡하기 쉽습니다.

결국 문서는 코드보다 뒤처지게 됩니다(Drift). 곧 다른 개발자나 프런트엔드 팀은 문서와 실제 동작이 다르다는 것을 눈치챕니다. 문서를 신뢰하기 어려워지면 결국 "진실"을 찾기 위해 소스 코드를 직접 읽게 됩니다. 그렇게 되면 문서화의 본래 목적이 사라집니다.

바로 이런 drift를 줄이기 위해 데코레이터 기반 OpenAPI 통합이 존재합니다. fluo에서는 코드가 "진실의 원천(Source of Truth)"이 되어야 한다고 봅니다. 이미 라우트와 DTO가 코드에 있다면, 문서는 그 정보를 멀리 복사하기보다 가까운 곳에서 확장해야 합니다.
- 라우트 선언은 이미 컨트롤러에 있습니다.
- DTO(Data Transfer Object)는 이미 요청의 형태를 정의하고 있습니다.
- 응답 타입과 보안 힌트는 이미 비즈니스 로직의 일부입니다.

`@fluojs/openapi` 패키지를 사용하면 이러한 기존 구조에 필요한 정보만 "태그"로 붙일 수 있습니다. DTO를 변경하면 OpenAPI 스펙도 자동으로 업데이트됩니다. 새로운 라우트를 추가하면 즉시 문서에 나타납니다. 문서가 구현과 가까이, 말 그대로 코드 바로 윗줄에 머물면 업데이트 누락 가능성이 크게 줄어듭니다.

### What OpenAPI Gives You

OpenAPI(과거 Swagger로 알려짐)는 단지 보기 좋은 인터랙티브 문서 페이지가 아닙니다. 이는 업계 표준이며 기계가 읽을 수 있는 API 설명 형식(보통 JSON 또는 YAML)입니다.

이 설명은 서비스의 "계약(Contract)" 역할을 하며 앞선 장에서 쌓은 작업을 이제 도구가 이해할 수 있는 계약으로 바꾸는 역할을 합니다. 다음과 같은 작업을 가능하게 합니다.

- **인터랙티브 문서**: Swagger UI를 통해 브라우저에서 직접 API에 요청을 보내고 결과를 확인할 수 있는 "Try it out" 기능을 제공합니다.
- **클라이언트 생성**: 프런트엔드 팀은 OpenAPI 스펙을 바탕으로 완전히 타입이 지정된 TypeScript나 Swift 클라이언트를 생성할 수 있습니다. 잘못된 데이터를 보낼 위험이 사라집니다.
- **자동화된 테스트**: 도구를 사용하여 실제 API 구현이 문서화된 내용과 일치하는지 자동으로 검증할 수 있습니다.
- **계약 검토**: 비즈니스 로직을 한 줄도 작성하기 전에 API 설계를 이해관계자들과 검토할 수 있습니다.
- **온보딩**: 새로 합류한 개발자가 `src/` 폴더를 뒤지지 않고도 애플리케이션의 "표면"을 몇 분 만에 파악할 수 있습니다.

초기 프로젝트에서는 이것이 "엔터프라이즈급 오버헤드"처럼 들릴 수 있습니다. 하지만 여기서 배울 교훈은 더 단순합니다. **좋은 API 문서는 제품의 핵심 부분이지, 나중에 덧붙이는 사후 산출물이 아닙니다.** fluo는 지루한 기술적 형식을 자동으로 처리하므로, 개발자는 명확한 설명을 작성하는 데 집중할 수 있습니다.

## 10.2 Registering OpenApiModule

OpenAPI 패키지의 중심은 `OpenApiModule`입니다. 문서 빌더가 최종 스펙에 어떤 핸들러, DTO, 스키마를 포함해야 하는지 알 수 있도록 애플리케이션에 이 모듈을 등록합니다.

```typescript
import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';
import { PostsController } from './posts/posts.controller';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [
    PostsModule,
    OpenApiModule.forRoot({
      // 어떤 컨트롤러를 문서화할지 명시적으로 알려줍니다.
      sources: [{ controllerToken: PostsController }],
      title: 'FluoBlog API',
      description: 'FluoBlog 엔진을 위한 공식 API 문서입니다.',
      version: '1.0.0',
      ui: true, // 내장 Swagger UI를 활성화합니다.
    }),
  ],
})
export class AppModule {}
```

`OpenApiModule.forRoot()` 메서드는 주요 진입점입니다. 다음과 같은 설정 객체를 받으며, 이 값들이 생성될 문서의 범위와 공개 표면을 결정합니다.
- `title` 및 `description`: API의 인간 친화적인 이름과 설명입니다.
- `version`: API의 시맨틱 버전입니다 (예: `1.0.0`).
- `sources`: 가장 중요한 부분입니다. fluo는 명시성을 중시합니다. OpenAPI 빌더가 검사해야 할 컨트롤러를 직접 정의합니다. `controllerToken`을 직접 전달하거나 미리 설정된 descriptor 목록을 전달할 수도 있습니다.
- `ui: true`: 이 설정은 fluo가 특정 엔드포인트에서 멋진 Swagger UI를 제공하도록 합니다.

생성된 JSON 문서와 UI는 표준화된 경로에서 확인할 수 있습니다. 이 두 경로는 각각 자동화 도구와 사람이 읽는 문서를 위한 진입점입니다.
- `/openapi.json`: 기계가 읽을 수 있는 원본 문서입니다.
- `/docs`: 인터랙티브한 Swagger UI 페이지입니다.

이 동작은 fluo 소스 코드, 특히 `packages/openapi/src/openapi-module.test.ts`에서 확인할 수 있습니다. 여기서 모듈이 부트스트랩되고 `/openapi.json` 엔드포인트가 호출되어 데코레이터들이 OpenAPI 스키마로 올바르게 변환되었는지 검증합니다.

### A Detail Worth Remembering

다른 프레임워크와 달리 `OpenApiModule`은 프로젝트 전체의 모든 `@Module({ controllers: [...] })`을 자동으로 찾아내 문서화하지 않습니다.

반드시 `forRoot()` 설정의 `sources`나 `descriptors`를 통해 명시적으로 제공해야 합니다. 한 단계가 더 필요한 것처럼 보일 수 있지만, 이는 공공에 노출될 내용을 완전히 제어하게 합니다. 예를 들어, 외부에 노출하고 싶지 않은 내부(Internal)용 컨트롤러가 있다면 `sources` 목록에서 제외하면 됩니다.

이 명시성은 프레임워크의 다른 철학과 일치합니다. **중요한 것은 눈에 보이는 계약 없이 마법처럼 발견되어서는 안 됩니다.**

## 10.3 Adding Documentation Decorators to FluoBlog

모듈 등록이 끝나면 API의 "뼈대"는 이미 문서화됩니다. 하지만 operation summary나 구체적인 응답 설명 같은 인간 친화적인 디테일은 부족할 것입니다. 이를 위해 문서화 데코레이터를 사용합니다.

```typescript
import {
  ApiOperation,
  ApiResponse,
  ApiTag,
  ApiBearerAuth,
  ApiProperty,
} from '@fluojs/openapi';
import { Controller, Get, Post, RequestDto } from '@fluojs/http';
import { CreatePostDto } from './dto/create-post.dto';

@ApiTag('Posts') // 이 컨트롤러의 모든 라우트를 "Posts" 헤더 아래로 그룹화합니다.
@Controller('/posts')
export class PostsController {
  @ApiOperation({ 
    summary: '발행된 게시글 목록 조회',
    description: '공개된 상태이며 모든 사용자가 볼 수 있는 게시글 목록을 반환합니다.' 
  })
  @ApiResponse(200, { description: '게시글 목록을 성공적으로 불러왔습니다.' })
  @Get('/')
  findAll() {
    return this.postsService.findAllPublic();
  }

  @ApiOperation({ 
    summary: '새 게시글 작성',
    description: '인증된 작가가 새로운 블로그 게시글을 작성할 수 있도록 허용합니다.' 
  })
  @ApiResponse(210, { description: '게시글이 성공적으로 생성되었습니다.' })
  @ApiResponse(400, { description: '잘못된 입력 데이터입니다.' })
  @ApiResponse(401, { description: '권한 없음 - 로그인이 필요합니다.' })
  @ApiBearerAuth() // 이 라우트가 JWT 토큰을 필요로 함을 나타냅니다.
  @Post('/')
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }
}
```

이때 `CreatePostDto` 자체가 각 필드에 `@FromBody('fieldName')`를 선언해 입력 바인딩을 담당한다고 이해하면 됩니다. 이는 `examples/realworld-api`가 사용하는 canonical 패턴과 같습니다.

이 데코레이터들이 `@Get()`이나 `@Post()` 같은 HTTP 데코레이터를 **대체하는 것이 아님**을 이해하는 것이 중요합니다. 대신 서로 나란히 작동합니다.
- 한 계층은 **동작(Behavior)**을 정의합니다 (서버가 요청을 어떻게 처리할 것인가).
- 다른 계층은 **의도(Intent)**를 설명합니다 (인간이나 도구가 요청을 어떻게 이해할 것인가).

### Why Tags and Summaries Matter

이런 작은 설명은 단순한 주석처럼 보일 수 있습니다. 하지만 생성된 문서를 훨씬 더 전문적으로 만들고 탐색하기 쉽게 합니다.

1. **ApiTag**: 관련 엔드포인트를 그룹화합니다. 이것이 없으면 API는 URL의 긴 나열에 불과합니다. 태그를 사용하면 모든 "Posts" 관련 로직이 한 카테고리 아래 깔끔하게 정리됩니다.
2. **ApiOperation Summary**: 라우트에 대한 짧은(한 문장) 제목입니다.
3. **ApiOperation Description**: 라우트가 하는 일, 부수 효과 또는 특별한 요구사항에 대한 더 자세한 설명입니다.
4. **ApiResponse**: 클라이언트가 기대할 수 있는 상태 코드를 명시적으로 나열합니다. 이는 에러 처리 로직을 작성해야 하는 프런트엔드 개발자에게 직접적인 도움이 됩니다.

작은 문서 힌트만으로도 API를 사용하는 모든 사람(미래의 자신을 포함하여)에게 더 좋은 첫인상을 줄 수 있습니다.

## 10.4 DTO Schemas, Responses, and Security Hints

fluo 코드에서 OpenAPI를 생성하는 가장 강력한 이유는 **메타데이터 재사용**입니다.

6장에서 우리는 `@fluojs/validation`을 사용하여 앱에 요청 DTO를 알려주었습니다. 5장에서 HTTP 계층은 이미 라우트와 메서드 정보를 얻었습니다. 이제 OpenAPI 계층은 이 모든 정보를 재사용하여 복잡한 components와 schema를 구축할 수 있습니다.

### What FluoBlog Can Now Describe

이러한 재사용 덕분에 이제 FluoBlog는 자동으로 다음을 표현할 수 있습니다. 중요한 점은 이 정보가 별도 문서 파일에서 새로 작성되는 것이 아니라, 이미 작성한 라우트와 DTO 선언에서 나온다는 것입니다.

- **Request Body 구조**: `CreatePostDto`에서 필드, 타입, 제약 조건(예: "최소 5자 이상")을 직접 가져옵니다.
- **Path 및 Query Parameter**: `/posts/:id`와 같은 URL의 동적인 부분을 정확히 식별합니다.
- **응답 기대값**: `@ApiResponse`를 명시하지 않더라도 fluo는 기본적으로 `200` 또는 `201` 응답 형태를 추론할 수 있습니다.
- **보안 요구사항**: 보호된 라우트는 Swagger UI에서 "자물쇠" 아이콘으로 표시됩니다.

DTO에서 `@IsString()`이나 `@IsEmail()` 같은 유효성 검사 데코레이터를 사용하면, `OpenApiModule`은 이를 자동으로 OpenAPI 제약 조건으로 변환합니다. 예를 들어 `@IsString({ minLength: 10 })`은 생성된 JSON에서 `minLength: 10`으로 나타납니다. 이 로직은 `packages/openapi/src/schema-builder.test.ts`에서 철저하게 테스트됩니다.

### Protected Routes in the Docs

9장에서 Guard를 다뤘습니다. 라우트가 보호되어 있다면 문서도 이를 반영해야 합니다. 그렇지 않으면 사용자는 왜 `403 Forbidden` 에러가 나는지 파악하기 어렵습니다.

`@ApiBearerAuth()`를 추가하면 Swagger UI에 이 엔드포인트가 Bearer 토큰이 포함된 `Authorization` 헤더를 필요로 한다는 것을 알릴 수 있습니다. 그러면 UI 상단에 "Authorize" 버튼이 생기고, 여기에 JWT를 붙여넣을 수 있습니다. 덕분에 Postman 같은 별도 도구 없이 브라우저에서 직접 보호된 엔드포인트를 테스트할 수 있습니다.

이는 **보안과 문서화가 별개의 작업이 아니라 함께 설계되어야 하는** 또 다른 이유입니다.

### The Importance of Schema Names

OpenAPI 문서를 생성할 때, DTO 클래스에 부여된 이름이 최종 사양의 스키마 이름이 됩니다. 그래서 이름은 단순한 내부 구현 세부사항이 아니라 문서 사용자가 보게 될 공개 어휘의 일부가 됩니다.

예를 들어, `CreatePostDto`는 OpenAPI JSON의 `components/schemas` 섹션에서 `CreatePostDto`라는 이름의 컴포넌트가 됩니다. 이것이 일관된 명명 규칙이 중요한 이유입니다. 만약 서로 다른 모듈에 똑같이 `CreateDto`라는 이름의 클래스가 있다면, 문서 생성기에서 이름 충돌이 발생할 수 있습니다.

`PostCreateDto`나 `UserCreateDto`와 같이 더 구체적인 이름을 사용하는 것이 이러한 문제를 피하고 문서를 명확하고 모호하지 않게 유지하는 좋은 습관입니다.

### Customizing Schema Properties

TypeScript 속성에서 OpenAPI 속성으로의 기본 매핑만으로는 충분하지 않은 경우가 있습니다. 예시 값을 제공하거나 특정 필드를 읽기 전용(read-only)으로 표시하고 싶을 수 있습니다. `@ApiProperty()` 데코레이터를 사용하면 이러한 세부 사항을 재정의할 수 있으며, 코드가 이미 알고 있는 타입 정보에 사람에게 필요한 설명을 덧붙일 수 있습니다.

```typescript
export class PostResponseDto {
  @ApiProperty({ 
    example: 'uuid-123-456',
    description: '게시물의 고유 식별자',
    readOnly: true 
  })
  id: string;

  @ApiProperty({ 
    example: '나의 첫 블로그 포스트',
    maxLength: 100 
  })
  title: string;
}
```

이러한 작은 추가 사항들은 API를 이해하려는 개발자에게 큰 도움이 됩니다. 실제적인 예시를 제공하면 시행착오를 줄일 수 있고, 결과적으로 팀의 개발 속도도 높아집니다.

### Documenting Security Schemas

애플리케이션이 일부 경로에는 API 키를 사용하고 다른 경로에는 JWT를 사용하는 등 여러 유형의 인증을 사용하는 경우, 여러 보안 스키마를 정의할 수 있습니다.

fluo에서는 이런 보안 요구사항을 `OpenApiModule.forRoot(...)` 설정과 `@ApiBearerAuth()`, `@ApiSecurity()` 같은 데코레이터로 함께 표현합니다. 즉, 부트스트랩 단계에서 별도 문서 빌더를 조립하는 대신, 공개할 문서 표면과 보안 힌트를 같은 OpenAPI 모듈 경계 안에서 유지합니다. 이러한 상세한 정보는 문서가 단순한 경로 목록을 넘어, API를 안전하고 올바르게 사용하기 위한 실질적인 가이드가 되게 합니다.

### Integrating Swagger UI and Security

Swagger UI의 가장 강력한 기능 중 하나는 보호된 라우트를 직접 테스트할 수 있는 기능입니다. fluo에서는 `OpenApiModule.forRoot(...)`로 UI를 켜고, 보호된 라우트에 `@ApiBearerAuth()`를 붙여 이 요구사항을 문서 표면에 직접 남깁니다.

```typescript
OpenApiModule.forRoot({
  sources: [{ controllerToken: PostsController }],
  title: 'FluoBlog API',
  version: '1.0.0',
  ui: true,
});
```

이렇게 `ui: true`로 문서 UI를 켜고 보호 라우트에 `@ApiBearerAuth()`를 붙여 두면, Swagger UI는 해당 엔드포인트가 인증 헤더를 요구한다는 사실을 함께 보여 줍니다. 보안과 문서화 사이의 이런 통합은 fluo 개발자 경험의 핵심이며, 수동 테스트를 더 빠르고 안정적으로 만듭니다.

### Global vs. Local API Tags

컨트롤러 수준에서의 `@ApiTag('Posts')`가 일반적이지만, 하나의 컨트롤러가 여러 논리적 하위 도메인을 처리하는 경우 개별 메서드에 태그를 적용할 수도 있습니다.

초기에는 '하나의 컨트롤러-하나의 태그' 패턴을 유지하는 편이 좋습니다. 이렇게 하면 Swagger UI가 체계적으로 유지되고 애플리케이션의 모듈식 구조가 잘 반영됩니다. 더 큰 프로젝트로 성장하다 보면 단일 라우트가 여러 태그(예: "Posts"와 "Search" 모두)에 속해야 하는 상황이 발생할 수 있으며, fluo는 `@ApiTag('Posts', 'Search')`와 같이 배열 형태로 태그를 지정하는 것을 지원합니다.

### Advanced UI Customization

`ui: true`는 좋은 기본 경험을 제공하지만, 브랜드에 맞게 Swagger UI를 커스터마이징할 수 있습니다. `OpenApiModule`을 사용하면 사용자 정의 CSS를 전달하거나 자산(assets)의 경로를 다르게 지정할 수 있습니다. 이를 통해 개발자용 문서도 제품의 잘 다듬어진 일부처럼 느껴지게 할 수 있습니다. 대부분의 초기 프로젝트에는 기본값으로 충분하지만, fluo가 프로젝트 성장에 맞춰 확장될 수 있다는 점은 표준 중심 프레임워크를 선택하는 장기적인 이점 중 하나입니다.

## 10.5 Versioning and Deterministic Docs Output

FluoBlog 애플리케이션이 커지면 기존의 "v1"을 유지하면서 "v2" API를 출시해야 할 수도 있습니다. OpenAPI 패키지는 이를 우아하게 처리합니다.

버전이 붙은 라우트(예: `/v1/posts`)가 생성된 경로에 올바르게 반영됩니다. 또한 fluo는 `ui: true`일 때 Swagger UI 자산(CSS, JS)이 **결정론적(Deterministic)**으로 참조되도록 보장합니다.

### Why Determinism Is Useful

코드가 바뀌지 않았는데 애플리케이션을 재시작할 때마다 문서 JSON이 미세하게 달라진다면, 버전 관리 시스템에서 "유령 차이"가 발생하고 자동화 도구들이 오작동하게 됩니다.

결정론적 출력은 다음을 보장합니다. 이 안정성 덕분에 문서 변경이 실제 API 변경인지, 도구가 만든 잡음인지 더 쉽게 구분할 수 있습니다.
- 라우트의 순서가 예측 가능합니다.
- 자산 URL이 안정적입니다.
- 스키마 구조가 일관됩니다.

여기서의 교훈은 단순합니다. **문서도 하나의 "릴리스 산출물"입니다.** API 코드와 마찬가지로 신뢰성과 버전 관리 관점으로 다뤄야 합니다.

## 10.6 Finishing Part 1 with a Documented API Surface

이 파트의 마지막에서 FluoBlog는 입문 단계의 HTTP 서사를 완주했습니다. 라우팅이 API를 도달 가능하게 만들고, 검증이 입력을 더 안전하게 만들고, 직렬화가 성공 응답을 다듬고, 예외 처리가 실패 동작을 더 분명하게 만들었으며, guard와 interceptor가 파이프라인을 더 재사용 가능하고 현실적으로 만들었습니다. 이제 OpenAPI가 그 누적된 작업을 문서화합니다.

마지막 점검용 체크리스트를 사용해 보세요.

1. **가시성**: posts 라우트가 문서에서 분명하게 보이고 잘 묶여 있는가?
2. **DTO 명확성**: 요청 DTO가 이해 가능한 스키마 정보로 나타나는가?
3. **보안**: 보호 라우트에 적절한 보안 힌트가 표시되는가?
4. **소통**: operation summary와 response description이 독자에게 실제로 도움이 되는가?
5. **자율성**: 다른 개발자가 모든 구현 파일을 읽지 않고도 공개 post API를 이해할 수 있는가?

답이 예라면 Part 1은 성공한 것입니다. 이 시점의 FluoBlog는 단순히 라우트가 동작하는 앱이 아니라, 입력, 출력, 실패, 보호 규칙, 문서가 서로 맞물린 작은 HTTP 시스템입니다.

### The Bigger Beginner Lesson

문서 자동화는 생각을 피하려는 도구가 아닙니다. 중요한 생각을 실제 코드 가까이로 옮겨, Part 1 전체에서 쌓아 온 API 학습 흐름이 구현과 문서 양쪽에 함께 남도록 만드는 방식입니다. 라우트 형태, 검증, 보안, 문서가 서로를 강화할 때 API는 더 신뢰하기 쉬워지며, 바로 그것이 진짜 이점입니다.

### Documenting Multiple Versions

API가 발전함에 따라 여러 버전의 문서를 유지해야 할 수도 있습니다. fluo에서는 버전별 컨트롤러 집합이나 descriptor를 분리해 `OpenApiModule.forRoot(...)`의 입력을 명시적으로 나누는 방식으로 서로 다른 문서 표면을 유지합니다.

이 패턴을 따르면 시스템이 복잡해지더라도 사용자에게 깔끔하고 조직적인 문서화 경험을 제공할 수 있습니다.

## Summary

- `OpenApiModule`은 컨트롤러와 DTO 메타데이터를 표준 OpenAPI 3.0 스펙으로 변환합니다.
- `@ApiTag`, `@ApiOperation` 같은 문서화 데코레이터는 코드만으로는 전달할 수 없는 인간적인 맥락을 제공합니다.
- FluoBlog은 이제 기계가 읽는 `/openapi.json`과 인간이 읽는 `/docs` 인터랙티브 UI를 노출합니다.
- 메타데이터 재사용 덕분에 유효성 검사 규칙과 DTO 형태가 문서와 자동으로 동기화됩니다.
- 결정론적인 문서 출력은 API "계약"이 안정적이고 전문적으로 유지되도록 돕습니다.
- 이제 Part 1이 끝났습니다. 라우팅, 검증, 직렬화, 보호, 문서화가 완료된 HTTP API를 갖게 되었습니다.

## Next Part Preview

**Part 2**에서는 "본넷 내부"로 들어갑니다. 이제 FluoBlog은 정리된 외부 API를 갖추었으니, 내부 시스템을 프로덕션 수준으로 만들어야 합니다. 다양한 환경을 위한 복잡한 설정을 관리하는 방법과 Prisma를 사용하여 서비스를 실제 PostgreSQL 데이터베이스에 연결하는 방법을 배울 것입니다. 다음 파트에서는 백엔드의 더 깊은 영역을 다룹니다.
