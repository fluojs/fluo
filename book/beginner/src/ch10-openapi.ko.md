<!-- packages: @fluojs/http, @fluojs/openapi -->
<!-- project-state: FluoBlog v1.7 -->

# Chapter 10. OpenAPI Automation

## Learning Objectives
- 생성된 API 문서가 왜 코드와 가까이 있어야 하는지 이해합니다.
- FluoBlog에 `OpenApiModule`을 등록하고 생성된 문서를 노출합니다.
- `@ApiTag()`, `@ApiOperation()`, `@ApiResponse()` 같은 문서화 데코레이터를 사용합니다.
- DTO와 HTTP 메타데이터가 어떻게 OpenAPI 스키마 정보가 되는지 배웁니다.
- 보호된 라우트와 버전 경로가 생성 문서에 어떤 영향을 주는지 이해합니다.
- 문서화된 HTTP API 기반과 함께 Part 1을 마무리합니다.

## Prerequisites
- 5장부터 9장까지 완료했습니다.
- FluoBlog 라우트, DTO, 예외, guard에 익숙합니다.
- Swagger UI 또는 기계가 읽을 수 있는 API 스펙에 대한 기본적인 이해가 있습니다.
- 모듈 설정 예제를 읽는 데 익숙합니다.

## 10.1 Why API Documentation Should Not Drift from the Code

수동 API 문서는 보통 좋은 의도로 시작합니다.

팀이 위키 페이지를 만듭니다.

API가 바뀝니다.

문서는 뒤처집니다.

곧 아무도 그 문서를 완전히 신뢰하지 못하게 됩니다.

바로 이런 drift를 줄이기 위해 데코레이터 기반 OpenAPI 통합이 존재합니다.

라우트 선언은 이미 코드에 있습니다.

DTO도 이미 코드에 있습니다.

응답과 보안 힌트도 같은 곳에 둘 수 있습니다.

문서가 구현과 가까이 머물면 최신 상태를 유지하기가 훨씬 쉬워집니다.

### What OpenAPI Gives You

OpenAPI는 단지 보기 좋은 문서 페이지가 아닙니다.

기계가 읽을 수 있는 API 설명입니다.

그 설명은 다음과 같은 데 도움을 줍니다.

- Swagger UI를 통한 인터랙티브 문서,
- 클라이언트 생성,
- 테스트 도구,
- 계약 검토,
- 새 개발자 온보딩.

초보자 프로젝트에서는 다소 고급스럽게 들릴 수 있습니다.

하지만 초보자 관점의 진짜 교훈은 더 단순합니다.

좋은 API 문서는 제품의 일부이지 사후 산출물이 아닙니다.

## 10.2 Registering OpenApiModule

OpenAPI 패키지의 중심은 `OpenApiModule`입니다.

문서 빌더가 어떤 핸들러를 포함해야 하는지 알 수 있도록 애플리케이션에 이 모듈을 등록합니다.

```typescript
import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';
import { PostsController } from './posts/posts.controller';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [
    PostsModule,
    OpenApiModule.forRoot({
      sources: [{ controllerToken: PostsController }],
      title: 'FluoBlog API',
      version: '1.0.0',
      ui: true,
    }),
  ],
})
export class AppModule {}
```

`OpenApiModule.forRoot()` 메서드는 주요 진입점입니다. 이 메서드는 `title`, `version`, 그리고 가장 중요한 `sources`를 포함한 설정 객체를 받습니다.

fluo에서 `sources`는 OpenAPI 빌더가 검사해야 할 컨트롤러를 정의합니다. 예제에서 보듯 `controllerToken`을 직접 전달할 수 있습니다.

`ui: true`를 주면 애플리케이션이 Swagger UI를 제공할 수 있습니다.

생성된 JSON 문서도 함께 노출됩니다.

패키지 문서에 따르면 흔한 경로는 다음과 같습니다.

- 문서 JSON은 `/openapi.json`,
- Swagger UI는 `/docs`입니다.

이 동작은 `packages/openapi/src/openapi-module.test.ts`에서 확인할 수 있습니다. 모듈이 부트스트랩되고 `/openapi.json` 엔드포인트에 요청을 보내 문서 구조가 올바른지 검증하는 테스트 코드가 마련되어 있습니다.

### A Detail Worth Remembering

`OpenApiModule`은 단순히 `@Module({ controllers: [...] })`만 보고 핸들러를 자동 추론하지는 않습니다.

반드시 `sources` 또는 미리 만든 `descriptors`를 제공해야 합니다.

이 명시성은 fluo의 다른 설계와도 잘 맞습니다.

중요한 것은 눈에 보이는 계약 없이 마법처럼 발견되어서는 안 됩니다.

## 10.3 Adding Documentation Decorators to FluoBlog

모듈 등록이 끝나면 라우트 수준 메타데이터로 생성 문서를 더 풍부하게 만들 수 있습니다.

```typescript
import {
  ApiOperation,
  ApiResponse,
  ApiTag,
  ApiBearerAuth,
} from '@fluojs/openapi';
import { Controller, Get, Post } from '@fluojs/http';

@ApiTag('Posts')
@Controller('/posts')
export class PostsController {
  @ApiOperation({ summary: 'List published posts' })
  @ApiResponse(200, { description: 'Posts returned successfully.' })
  @Get('/')
  findAll() {
    return this.postsService.findAllPublic();
  }

  @ApiOperation({ summary: 'Create a new post' })
  @ApiResponse(201, { description: 'Post created successfully.' })
  @ApiBearerAuth()
  @Post('/')
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }
}
```

이 데코레이터들이 HTTP 데코레이터를 대신하는 것은 아닙니다.

동일한 라우트를 문서화 관점에서 설명해 주는 계층입니다.

이 이중 계층은 매우 유용합니다.

한 계층은 동작을 정의합니다.

다른 계층은 그 동작을 도구와 독자에게 설명합니다.

### Why Tags and Summaries Matter

초보자는 이런 작은 설명을 과소평가하기 쉽습니다.

하지만 생성 문서를 훨씬 더 빠르게 훑어볼 수 있게 해 줍니다.

태그는 관련 엔드포인트를 묶어 줍니다.

operation summary는 라우트의 목적을 빠르게 알려 줍니다.

response description은 happy path 계약을 설명해 줍니다.

작은 문서 힌트만으로도 첫인상이 크게 달라집니다.

## 10.4 DTO Schemas, Responses, and Security Hints

fluo 코드에서 OpenAPI를 생성하는 가장 강력한 이유 중 하나는 재사용입니다.

validation 패키지는 이미 앱에 요청 DTO를 알려 주었습니다.

HTTP 계층은 이미 라우트와 메서드를 알고 있습니다.

OpenAPI 계층은 그 메타데이터를 재사용해 components와 operations를 만들 수 있습니다.

즉 수동 동기화 작업이 줄어듭니다.

### What FluoBlog Can Now Describe

이제 FluoBlog는 다음을 설명할 수 있습니다.

- DTO를 통한 request body 구조,
- 라우트 메타데이터를 통한 path 및 query parameter 형태,
- `@ApiResponse()`를 통한 응답 기대값,
- `@ApiBearerAuth()` 또는 `@ApiSecurity()`를 통한 보호 라우트의 보안 요구사항.

DTO에서 `@IsString()`이나 `@IsNumber()` 같은 `@fluojs/validation` 데코레이터를 사용하면 `OpenApiModule`이 이를 자동으로 OpenAPI 스키마 속성으로 변환합니다. 이는 내부적으로 스키마 빌더가 처리합니다 (`packages/openapi/src/schema-builder.test.ts` 참고).

이 조합이 강력한 이유는 앞선 장의 작업이 그대로 문서 입력이 되기 때문입니다.

지금까지의 흐름은 의도적으로 누적되도록 설계되었습니다.

### Protected Routes in the Docs

9장에서 쓰기 라우트는 guard를 갖게 되었습니다.

문서도 그 보호 상태를 반영해야 합니다.

guard 구현과 docs 데코레이터가 서로 다른 계층에 있더라도 문서는 요구사항을 분명하게 전달할 수 있습니다.

`@ApiBearerAuth()`를 추가하면 Swagger UI에 이 엔드포인트가 `Authorization` 헤더를 필요로 한다는 것을 알릴 수 있습니다. 덕분에 브라우저에서 직접 보호된 엔드포인트를 테스트해 볼 수 있습니다.

이 역시 보안과 문서화가 함께 설계되어야 하는 이유를 보여 줍니다.

## 10.5 Versioning and Deterministic Docs Output

OpenAPI 패키지 문서는 두 가지 중요한 점을 강조합니다.

첫째, 버전이 붙은 라우트는 생성된 경로에 올바르게 반영될 수 있습니다.

둘째, `ui: true`일 때 Swagger UI 자산은 결정론적으로 참조됩니다.

이 디테일은 문서도 릴리스 동작의 일부라는 점에서 중요합니다.

### Why Determinism Is Useful

같은 애플리케이션 버전인데 우연한 자산 업데이트 때문에 문서 동작이 달라진다면 팀은 금방 신뢰를 잃습니다.

결정론적인 자산 참조는 그런 위험을 줄여 줍니다.

초보자 관점의 핵심은 단순합니다.

문서도 전달 표면의 일부입니다.

API 자체와 같은 신뢰성 관점으로 다뤄야 합니다.

### Looking Ahead for FluoBlog

FluoBlog는 아직 작은 애플리케이션입니다.

하지만 이제 이후 확장을 위한 올바른 기반을 갖추게 되었습니다.

더 많은 모듈, 인증 흐름, 영속성 계층이 추가되더라도 문서화 시스템은 이미 아키텍처 안에서 분명한 자리를 차지하고 있습니다.

## 10.6 Finishing Part 1 with a Documented API Surface

이 파트의 마지막에서 FluoBlog는 초보자 친화적인 HTTP 서사를 완주했습니다.

라우팅이 API를 도달 가능하게 만들었습니다.

검증이 입력을 더 안전하게 만들었습니다.

직렬화가 성공 응답을 다듬었습니다.

예외 처리가 실패 동작을 더 분명하게 만들었습니다.

guard와 interceptor가 파이프라인을 더 재사용 가능하고 현실적으로 만들었습니다.

이제 OpenAPI가 그 누적된 작업을 문서화합니다.

마지막 점검용 체크리스트를 사용해 보세요.

1. posts 라우트가 문서에서 분명하게 보이고 잘 묶여 있는가?
2. 요청 DTO가 이해 가능한 스키마 정보로 나타나는가?
3. 보호 라우트에 적절한 보안 힌트가 표시되는가?
4. operation summary와 response description이 독자에게 실제로 도움이 되는가?
5. 다른 개발자가 모든 구현 파일을 읽지 않고도 공개 post API를 이해할 수 있는가?

답이 예라면 Part 1은 성공한 것입니다.

### The Bigger Beginner Lesson

문서 자동화는 생각을 피하려는 도구가 아닙니다.

중요한 생각을 실제 코드 가까이로 옮기려는 방식입니다.

라우트 형태, 검증, 보안, 문서가 서로를 강화할 때 API는 더 신뢰하기 쉬워집니다.

바로 그것이 진짜 이점입니다.

## Summary
- `OpenApiModule`은 컨트롤러와 DTO 메타데이터를 생성된 API 문서로 바꿉니다.
- 문서화 데코레이터는 유용한 summary, response description, tag, security hint를 추가합니다.
- 이제 FluoBlog는 진화하는 posts API를 위해 `/openapi.json`과 Swagger UI를 노출할 수 있습니다.
- 앞선 장의 작업이 생성 문서에 직접 반영되므로 drift가 줄어듭니다.
- 문서도 릴리스 표면의 일부이므로 결정론적 동작이 중요합니다.
- 이제 Part 1은 라우팅되고, 검증되고, 직렬화되고, 보호되고, 문서화된 HTTP API 기반과 함께 끝납니다.

## Next Part Preview
Part 2는 HTTP 표면에서 애플리케이션 설정과 데이터 접근으로 이동합니다. FluoBlog는 이미 분명한 API 껍데기를 갖추었으므로, 다음 단계는 설정 관리와 데이터베이스 통합을 통해 내부를 더 프로덕션 친화적으로 만드는 것입니다.
