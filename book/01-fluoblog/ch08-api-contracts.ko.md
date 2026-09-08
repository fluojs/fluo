# 사용자가 이해할 수 있는 API 계약 만들기

<!-- book:volume=01-fluoblog;chapter=08 -->

[이전: 저장한 데이터와 공개할 데이터 구분하기](./ch07-response-models.ko.md) · [1권 목차](./toc.ko.md) · [다음: 환경이 달라도 같은 코드 실행하기](./ch09-configuration.ko.md)

## 성공했는데 화면은 실패라고 말한다

FluoBlog의 작성 화면을 만드는 동료가 발행 버튼을 연결한다. 서버는 글을 제대로 발행했지만 화면은 실패 안내를 띄운다. 동료는 모든 `POST`가 `201`을 반환한다고 생각했고, 서버는 기존 글의 상태 전이이므로 `200`을 반환했다. 또 다른 날에는 버전 충돌을 입력 오류로 취급해 제목 칸을 빨갛게 표시했다. 제목을 아무리 고쳐도 충돌은 해결되지 않았다.

앞의 세 장에서 서버는 비교적 분명한 선택을 했다. 초안은 저장할 수 있지만 발행 조건은 따로 있고, 입력은 필요한 필드만 받으며, 공개 응답에는 저장 모델 전체를 싣지 않는다. 그러나 그 선택이 코드 속에만 있으면 클라이언트 개발자는 추측해야 한다. 이번 장에서는 요청·성공·실패의 형태와 사용자가 취할 다음 행동을 하나의 API 계약으로 연결한다.

계약은 Swagger UI 화면의 다른 이름이 아니다. 경로와 필드의 기계 읽기 가능한 설명, 실제 HTTP 동작, 오류가 생겼을 때의 사용자 경험이 일치해야 한다. `@fluojs/openapi`는 명시적으로 전달한 핸들러 descriptor와 메타데이터에서 OpenAPI 3.1.0 문서를 생성한다. 업무 규칙을 대신 실행하거나 컨트롤러의 반환 타입을 모두 추론해 주는 기능은 아니다.

이 장의 앱은 여전히 같은 `fluo-blog`이며 메모리 저장소를 사용한다. 문서를 붙인다고 재시작 후 저장이나 작성자 인증이 생기지는 않는다. 문서의 대상은 지금 실제로 구현한 다섯 동작이다. 이후 계정과 상점 기능을 같은 애플리케이션에 추가할 때도 이 계약을 기반으로 확장한다.

## 상태 코드에는 다음 행동이 담긴다

우선 현재 계약을 한 표에 모은다. 입력 필드의 정확한 출처와 검증은 6장의 DTO, 응답 필드의 정확한 선택은 7장의 mapper가 소유한다.

| 요청 | 정상 결과 | 대표적인 거부 | 클라이언트의 다음 행동 |
| --- | --- | --- | --- |
| `GET /posts` | `200`, 발행 글 요약 배열 | 예상하지 못한 내부 실패는 `500` | 배열을 목록으로 표시한다 |
| `GET /posts/:id` | `200`, 발행 글 상세 | 잘못된 ID는 `400`, 없는 글·초안은 `404` | 주소를 확인하거나 찾을 수 없음 화면을 표시한다 |
| `POST /posts` | `201`, 초안 작성 결과 | 누락·타입·추가 필드는 `400` | ID와 버전을 편집 상태에 저장한다 |
| `PUT /posts/:id` | `200`, 갱신된 작성 결과 | 잘못된 값은 `400`, 오래된 버전·발행 상태는 `409` | 충돌이면 서버 상태와 편집 내용을 비교한다 |
| `POST /posts/:id/publish` | `200`, 발행 작성 결과 | 빈 본문은 `400`, 버전·slug·상태 충돌은 `409` | 오류 코드별로 재조회 또는 slug 변경을 안내한다 |

`404`로 초안과 없는 글을 같은 형태로 처리하는 것은 공개 읽기의 선택이다. 독자에게 비공개 글이 존재하는지 알려 줄 이유가 없다. 작성자는 명령 결과에 받은 ID를 갖고 편집 흐름을 이어 간다. 인증된 편집 조회가 아직 없는 것을 공개 경로의 `404` 정책을 완화하는 방식으로 해결하지 않는다.

전 장의 `POST_NOT_PUBLISHABLE`을 `400`으로 고른 것은 제출한 내용으로 지금 발행 명령을 수행할 수 없다는 뜻이다. 오래된 버전은 내용 자체보다 서버 상태와의 충돌이므로 `409`다. 둘을 모두 “저장 실패”라는 한 메시지로 뭉개면 사용자는 무엇을 고칠지 알 수 없다. 반대로 모든 예외를 지나치게 세분화해 내부 구현 이름을 API 코드로 내보내도 좋지 않다. 클라이언트가 다르게 행동해야 하는 차이를 안정적인 코드로 남긴다.

HTTP 기본 예외 응답은 `{ error: { code, message, status } }`에 선택적인 `details`, `meta`, `requestId`가 더해지는 형태다. 아래는 **오래된 발행 요청에 대한 예시 JSON**이며, 실행 로그를 캡처한 결과가 아니다.

```json
{
  "error": {
    "code": "POST_VERSION_CONFLICT",
    "message": "Another change was saved first.",
    "status": 409
  }
}
```

사용자에게 보여 줄 한국어 문구는 화면에서 코드에 대응시킬 수 있다. `message` 문장 전체를 비교하여 분기하지 않는다. 바인딩·검증 실패에서는 `details`의 `field`, `source`, `code`로 제목 입력이나 버전 입력을 구분한다. `requestId`는 기본적으로 항상 생기는 필드가 아니므로 여기서는 필수로 약속하지 않는다. 이후 관측 장에서 상관관계 미들웨어를 붙인 뒤 그 의미를 확장한다.

미인증 `401`과 권한 없음 `403`도 서로 다른 계약이다. 다만 현재 작성 컨트롤러에는 인증 가드가 없으므로 문서에 보안 자물쇠를 표시하는 것만으로 두 동작을 구현했다고 말하지 않는다. 지금의 API는 로컬 운영자 실습이며, 뒤의 장에서 토큰 검증과 소유자 확인을 실제로 연결한다.

## 응답은 명시적인 스키마가 필요하다

OpenAPI builder는 요청 DTO의 바인딩·검증 메타데이터를 읽는다. 하지만 핸들러 반환값이나 TypeScript의 반환 타입을 검사하여 응답 본문을 추론하지 않는다. `@ApiResponse(200, { description: '...' })`만 쓰면 설명과 상태는 생겨도 본문 schema는 없다. `@Expose()`가 붙은 직렬화 DTO도 문서화할 응답을 명시하는 작업을 없애 주지는 않는다.

이 앱에서는 직렬화 DTO와 문서 스키마를 역할에 맞게 분리한다. 출력 클래스는 필터와 mapper가 사용하고, OpenAPI에는 wire JSON의 정확한 필드·타입·필수 여부를 선언한다. `type: ResponseDto`로 component를 만들 수도 있지만, 런타임 타입 표기나 직렬화 데코레이터만으로 모든 문서 제약을 추론한다고 가정하지 않는다. 작은 공개 응답을 명시적 schema로 쓰면 실제 JSON과 대조하기 쉽다.

다음은 **`src/posts/post-api.schemas.ts` 전체**다. 전 장에서 작성 결과의 `publishedAt`은 초안이면 `null`, 발행이면 문자열이라고 정했다. 단순히 모든 결과에 `string | null`을 허용하는 대신 두 상태를 `oneOf`로 구분하여 관계까지 표현한다.

```ts
import type { OpenApiSchemaObject } from '@fluojs/openapi';

const idSchema: OpenApiSchemaObject = {
  type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER,
};
const summaryProperties: Record<string, OpenApiSchemaObject> = {
  id: idSchema,
  title: { type: 'string', minLength: 1, maxLength: 120 },
  slug: { type: 'string', maxLength: 80, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
  publishedAt: { type: 'string', format: 'date-time' },
};

export const postSummarySchema: OpenApiSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'slug', 'publishedAt'],
  properties: summaryProperties,
};

export const publicPostSchema: OpenApiSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'slug', 'publishedAt', 'content'],
  properties: {
    ...summaryProperties,
    content: { type: 'string', minLength: 1, maxLength: 50_000 },
  },
};

const receiptProperties: Record<string, OpenApiSchemaObject> = {
  id: idSchema,
  version: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
};

export const postWriteReceiptSchema: OpenApiSchemaObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'status', 'version', 'publishedAt'],
      properties: {
        ...receiptProperties,
        status: { type: 'string', const: 'draft' },
        publishedAt: { type: 'null' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'status', 'version', 'publishedAt'],
      properties: {
        ...receiptProperties,
        status: { type: 'string', const: 'published' },
        publishedAt: { type: 'string', format: 'date-time' },
      },
    },
  ],
};

export const postIdParameterSchema: OpenApiSchemaObject = {
  type: 'string', pattern: '^[1-9][0-9]*$',
  description: 'Decimal post ID within the JavaScript safe integer range.',
};

export const errorResponseSchema: OpenApiSchemaObject = {
  $ref: '#/components/schemas/ErrorResponse',
};
```

path parameter를 문자열 스키마로 명시한 것은 실수로 숫자 변환을 뺀 것이 아니다. 실제 URL 표기는 문자열이고, 앱의 변환기는 지수 표기·앞자리 0·부호·공백을 거부한다. DTO 검증으로 추론한 integer만 문서에 쓰면 `02`도 같은 정수라고 생각할 수 있다. 공개 parameter 설명을 원래 문자열의 문법으로 정하고 안전한 정수 상한은 설명과 실제 변환기 테스트로 확인한다. 정규식만으로 모든 숫자 범위를 읽기 쉽게 표현하려고 하지 않는다.

스키마도 구현의 모든 조건을 표현하지는 않는다. `content.minLength: 1`은 공백만 있는 본문을 완전히 거부하지 못하고, JSON Schema의 문자열 길이 의미와 JavaScript UTF-16 코드 단위 계산은 보조 문자에서 차이가 날 수 있다. 제목·본문 상한의 서버 기준은 5장의 도메인 계약이며, 일반적인 문자열 schema는 클라이언트 안내와 대략적인 제약을 제공한다. 실제 발행 가능성은 도메인 함수와 HTTP 테스트가 최종 판단한다. 문서만 통과했다고 모든 업무 규칙을 통과했다는 뜻은 아니다.

## 다섯 라우트에 문서 메타데이터를 붙인다

다음은 **`src/posts/posts.controller.ts`의 최종 교체 파일 전체**다. 동작은 7장과 같고, 각 핸들러에 요청·응답 설명을 추가한다. 설명 문자열도 향후 번역에서 코드 블록을 그대로 보존할 수 있도록 영어로 둔다. 장의 해설은 한국어로 유지한다.

```ts
import { Inject } from '@fluojs/core';
import {
  Controller, Get, HttpCode, Post, Put, RequestDto, UseInterceptors,
} from '@fluojs/http';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTag } from '@fluojs/openapi';
import { SerializerInterceptor } from '@fluojs/serialization';
import {
  errorResponseSchema, postIdParameterSchema, postSummarySchema,
  postWriteReceiptSchema, publicPostSchema,
} from './post-api.schemas.js';
import { runPostCommand } from './post-http-error.js';
import { CreatePostDto, GetPostDto, PublishPostDto, ReplacePostDto } from './post-request.dto.js';
import { toPostSummary, toPostWriteReceipt, toPublicPost } from './post-response.dto.js';
import { PostsService } from './posts.service.js';

@ApiTag('Posts')
@Controller('/posts')
@Inject(PostsService)
@UseInterceptors(SerializerInterceptor)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @ApiOperation({ summary: 'List published posts' })
  @ApiResponse(200, {
    description: 'Published post summaries.',
    schema: { type: 'array', items: postSummarySchema },
  })
  list() {
    return this.posts.listPublished().map(toPostSummary);
  }

  @Get('/:id')
  @RequestDto(GetPostDto)
  @ApiOperation({ summary: 'Read one published post' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiResponse(200, { description: 'Published post.', schema: publicPostSchema })
  @ApiResponse(404, { description: 'Missing or unpublished post.', schema: errorResponseSchema })
  get(input: GetPostDto) {
    return runPostCommand(() => toPublicPost(this.posts.getPublished(input.id)));
  }

  @Post()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  @ApiOperation({ summary: 'Create a draft for the local operator' })
  @ApiBody({ description: 'All three strings are required; empty draft text is allowed.' })
  @ApiResponse(201, { description: 'Draft created.', schema: postWriteReceiptSchema })
  create(input: CreatePostDto) {
    return runPostCommand(() => toPostWriteReceipt(this.posts.create('author-1', {
      title: input.title, content: input.content, slug: input.slug,
    })));
  }

  @Put('/:id')
  @HttpCode(200)
  @RequestDto(ReplacePostDto)
  @ApiOperation({ summary: 'Replace all editable draft text' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiBody({ description: 'Send all text fields and the version last observed.' })
  @ApiResponse(200, { description: 'Draft updated.', schema: postWriteReceiptSchema })
  @ApiResponse(409, { description: 'Version or state conflict.', schema: errorResponseSchema })
  replace(input: ReplacePostDto) {
    return runPostCommand(() => toPostWriteReceipt(
      this.posts.revise(input.id, input.expectedVersion, {
        title: input.title, content: input.content, slug: input.slug,
      }),
    ));
  }

  @Post('/:id/publish')
  @HttpCode(200)
  @RequestDto(PublishPostDto)
  @ApiOperation({ summary: 'Publish an existing draft' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiBody({ description: 'Publishing checks nonblank text and a unique valid slug.' })
  @ApiResponse(200, { description: 'Post published.', schema: postWriteReceiptSchema })
  @ApiResponse(409, {
    description: 'Version, state, or slug conflict. Read the error code before retrying.',
    schema: errorResponseSchema,
  })
  publish(input: PublishPostDto) {
    return runPostCommand(() => toPostWriteReceipt(
      this.posts.publish(input.id, input.expectedVersion),
    ));
  }
}
```

`@ApiBody()`에 설명만 추가했으므로 요청 schema는 기존 DTO에서 파생한 것을 유지한다. 별도의 본문 schema로 덮어쓰지 않아 필드의 출처와 기본 검증 메타데이터를 재사용한다. ID parameter는 앞에서 설명한 문자열 표기 계약을 전달하려고 같은 이름의 추론 결과를 명시적으로 대체했다.

`@ApiResponse()`는 문서 메타데이터다. 실제 성공 상태를 바꾸는 것은 HTTP의 `@HttpCode()`다. 둘을 혼동하면 문서에는 발행 `200`을 써 놓고 런타임은 POST 기본 `201`을 보낼 수 있다. 생성에는 `201`, 수정·발행에는 `200`을 두 곳 모두 명시했다. 상세와 목록은 기본 `200`이며 응답 schema를 별도로 넣었다.

발행의 `409`를 직접 등록한 이유도 있다. 기본 오류 주입 정책은 `400`, `401`, `403`, `404`, `500`을 제공하지만 `409`는 현재 업무 계약에서 추가해야 한다. `ErrorResponse` component에 대한 참조는 다음 모듈의 기본 오류 주입 정책을 전제로 한다. 이 정책을 `omit`으로 바꾼다면 공용 오류 schema도 직접 제공해야 하며, 참조만 남기는 변경은 문서를 깨뜨린다.

## 문서 대상도 명시적으로 등록한다

다음은 **`src/app.ts`의 교체 파일 전체**다. `PostsModule`은 7장의 등록을 사용하므로 `PostsService`, `PostIdConverter`, `SerializerInterceptor`, `POST_CLOCK`이 그대로 연결된다. `PostsController`의 실제 요청 처리 인스턴스는 그 기능 모듈이 소유한다.

```ts
import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';
import { PostsController } from './posts/posts.controller.js';
import { PostsModule } from './posts/posts.module.js';

@Module({
  imports: [
    PostsModule,
    OpenApiModule.forRoot({
      title: 'FluoBlog API',
      version: '1.0.0',
      sources: [{ controllerToken: PostsController }],
      documentPath: '/openapi.json',
      uiPath: '/docs',
      ui: true,
      defaultErrorResponsesPolicy: 'inject',
    }),
  ],
})
export class AppModule {}
```

컨트롤러를 `@Module({ controllers: [...] })`에 등록했다고 OpenAPI가 자동으로 모든 컨트롤러를 찾아 문서화하지 않는다. `sources` 또는 미리 만든 `descriptors`를 제공해야 한다. 이 명시성은 내부 운영 API와 독자 API를 나눠 문서화할 때 유용하다. 대신 새 컨트롤러를 추가하고 문서 대상에서 빠뜨리는 실수는 테스트로 잡아야 한다.

위 코드에서 `PostsController`를 루트의 `controllers`에도 다시 넣지 않는다. `sources`는 문서에 포함할 메타데이터의 출처이지 같은 라우트를 다시 등록하라는 명령이 아니다. 두 가지 등록을 혼동하면 경로 충돌이나 서비스 인스턴스 분리에 관한 문제를 만들 수 있다.

`/openapi.json`은 기계가 읽을 문서이고 `/docs`는 선택적인 Swagger UI다. `ui: false`로 바꾸어도 UI 경로는 예약되므로 다른 컨트롤러가 `/docs`를 재사용할 수 있다고 생각하면 안 된다. 문서 경로·UI 경로 또는 앱 라우트가 정규화 후 겹치면 부트스트랩이 `RouteConflictError`로 실패한다. 여러 문서를 만들 때는 JSON 경로와 UI 경로를 모두 다르게 정한다.

등록 옵션은 등록 시점에 스냅샷된다. 시작 후 원본 `sources` 배열에 컨트롤러를 추가하거나 title 문자열을 바꾸어 문서가 실시간 갱신될 것이라 기대하지 않는다. 다음 장에서 환경 설정을 연결할 때 비동기 DI 설정이 필요하다면 `forRootAsync()`를 고려할 수 있다. 그 경우에도 `documentPath`와 `uiPath`는 factory 안이 아니라 바깥 등록 옵션이다. 지금은 고정 설정으로 충분하다.

Swagger UI가 열린다는 사실은 인증 구현의 증거가 아니다. `ApiBearerAuth`와 `ApiSecurity` 역시 요구사항의 문서화이며 가드가 아니다. 기본 오류 정책으로 `401`·`403` 응답이 표시될 수 있어도 모든 현재 route에 인증이 켜져 있다는 뜻은 아니다. 구현하지 않은 보안 동작을 문서 장식으로 암시하지 않는 것이 계약의 정직성이다.

## 서버를 띄우지 않고 문서의 구조를 시험한다

다음은 **`src/posts/post-api.test.ts` 전체**다. 핸들러 mapping에서 descriptor를 만들고 공개 builder를 호출한다. DI 인스턴스나 네트워크 포트가 없어도 문서 생성과 직렬화 결과를 대조할 수 있는 실험이다. 표준 데코레이터 테스트 설정과 메타데이터 사전 설치는 앞 장의 환경을 사용한다.

```ts
import { createHandlerMapping } from '@fluojs/http';
import { buildOpenApiDocument } from '@fluojs/openapi';
import { serialize } from '@fluojs/serialization';
import { describe, expect, it } from 'vitest';
import { createDraft, publishPost } from './post.js';
import { toPublicPost } from './post-response.dto.js';
import { PostsController } from './posts.controller.js';

function buildDocument() {
  return buildOpenApiDocument({
    descriptors: createHandlerMapping([{ controllerToken: PostsController }]).descriptors,
    title: 'FluoBlog API',
    version: '1.0.0',
    defaultErrorResponsesPolicy: 'inject',
  });
}

describe('Post API contract', () => {
  it('includes all five operations and the explicit publish status', () => {
    const document = buildDocument();
    const operations = Object.values(document.paths).flatMap((item) =>
      ['get', 'post', 'put'].filter((method) => Object.hasOwn(item, method)),
    );
    expect(operations).toHaveLength(5);
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/posts']?.post?.responses['201']).toBeDefined();
    const publish = document.paths['/posts/{id}/publish']?.post;
    expect(publish?.responses['200']).toBeDefined();
    expect(publish?.responses['201']).toBeUndefined();
    expect(publish?.responses['409']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ErrorResponse',
    });
    expect(document.components?.schemas?.ErrorResponse).toBeDefined();
  });

  it('documents the HTTP body allowlist instead of the stored model', () => {
    const schema = buildDocument().components?.schemas?.CreatePostDto;
    expect(schema?.additionalProperties).toBe(false);
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['content', 'slug', 'title']);
    expect([...(schema?.required ?? [])].sort()).toEqual(['content', 'slug', 'title']);
  });

  it('matches public response keys to the actual serializer output', () => {
    const draft = createDraft(2, 'author-1', {
      title: 'Contract test', content: 'A stable public shape.', slug: 'contract-test',
    });
    const post = publishPost(draft, 1, new Date('2026-06-01T09:00:00.000Z'));
    const payload = serialize(toPublicPost(post));
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('Public post serialization must return an object.');
    }
    const schema = buildDocument().paths['/posts/{id}']?.get
      ?.responses['200']?.content?.['application/json']?.schema;
    expect(schema?.additionalProperties).toBe(false);
    expect(Object.keys(payload).sort()).toEqual(Object.keys(schema?.properties ?? {}).sort());
    expect(Object.keys(payload).sort()).toEqual([...(schema?.required ?? [])].sort());
  });
});
```

독자 앱에서 실행할 명령은 `pnpm exec vitest run src/posts/post-api.test.ts`다. 이 원고에서 실행한 통과 기록은 아니다. 기대 결과는 세 테스트의 성공이다. 첫 테스트에서 발행의 HTTP 상태 메타데이터와 문서 등록을 함께 점검하고, 두 번째는 서버 소유 필드가 요청 문서에 들어오지 않았는지 확인한다. 세 번째는 직렬화기가 실제로 만든 키와 문서 키를 비교한다.

이 테스트는 완전한 JSON Schema validator가 아니다. 문자열의 형식, 모든 조합 제약, 모든 상태별 응답을 전부 검증했다고 말하지 않는다. 공개 필드 추가·삭제와 메타데이터 누락이라는 구체적인 회귀를 빠르게 드러낸다. 문서 문장을 바꿔도 테스트는 깨지지 않는다. `operationId`도 이 앱에서 생성 클라이언트의 고정 식별자로 사용하기 전에는 문장처럼 무작정 스냅샷하지 않는다.

OpenAPI의 `info.version`을 `1.0.0`에서 바꿔도 HTTP 경로에 `/v2`가 생기지 않는다. 경로 버전과 문서 버전은 다른 설정이다. 현재 경로를 유지한 채 오류 code를 삭제하거나 필수 요청 필드를 추가하는 것은 문서 숫자만 올린다고 호환 변경이 되지 않는다. 클라이언트의 어떤 동작이 깨지는지부터 검토해야 한다.

## 실제 응답과 제공 중인 문서를 맞춰 본다

단위 builder 테스트가 통과해도 앱의 `sources` 등록이 빠져 있으면 실제 `/openapi.json`에는 라우트가 없을 수 있다. 다음은 **`scripts/api-contract-check.mjs` 전체**다. 새로 시작한 로컬 메모리 앱에서 한 번 실행하여 제공 중인 문서와 요청을 비교한다.

```js
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:3000';
async function request(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

const served = await request('GET', '/openapi.json');
assert.equal(served.status, 200);
assert.equal(served.body.openapi, '3.1.0');
const paths = served.body.paths;
assert.ok(paths['/posts'].post.responses['201']);
assert.ok(paths['/posts/{id}/publish'].post.responses['409']);

const created = await request('POST', '/posts', {
  title: 'Wire contract', content: 'Compare docs with responses.', slug: 'wire-contract',
});
assert.equal(created.status, 201);
const id = created.body.id;
const published = await request('POST', `/posts/${id}/publish`, { expectedVersion: 1 });
assert.equal(published.status, 200);
assert.ok(paths['/posts/{id}/publish'].post.responses[String(published.status)]);
const repeated = await request('POST', `/posts/${id}/publish`, { expectedVersion: 1 });
assert.equal(repeated.status, 409);
assert.equal(repeated.body.error.status, repeated.status);
assert.equal(repeated.body.error.code, 'POST_VERSION_CONFLICT');

const detail = await request('GET', `/posts/${id}`);
assert.equal(detail.status, 200);
const schema = paths['/posts/{id}'].get.responses['200'].content['application/json'].schema;
assert.equal(schema.additionalProperties, false);
assert.deepEqual(Object.keys(detail.body).sort(), Object.keys(schema.properties).sort());
assert.deepEqual(Object.keys(detail.body).sort(), [...schema.required].sort());
console.log('Served API contract checks passed.');
```

실행 명령은 `node scripts/api-contract-check.mjs`이며 기대 결과는 마지막 메시지다. 이 역시 원고 작성 중 실행한 HTTP 검증 결과로 제시하는 것이 아니다. 고정된 메모리 fixture를 사용하는 확인 스크립트이므로 이미 같은 slug를 발행한 앱에 반복 실행하면 충돌한다. 테스트 데이터를 무작위 값으로 바꾸어 실패를 숨기지 않고 새 앱에서 실행한다.

실패를 읽는 순서도 계약의 일부다. 문서에 path가 없으면 `sources`를 먼저 확인한다. `201`과 `200`이 다르면 `HttpCode`와 `ApiResponse`를 비교한다. 필드가 다르면 출력 mapper·직렬화 인터셉터·명시적 schema를 비교한다. 실제 응답은 맞는데 Swagger UI만 오래된 모습을 보이면 제공 중인 JSON을 먼저 확인한다. 화면의 외형보다 기계가 받은 문서가 기준이다.

API 사용자는 타임아웃을 실패 확정으로 해석해서는 안 된다. 발행 후 연결이 끊긴 경우 서버는 이미 상태를 바꾸었을 수 있다. 전 장의 구현은 같은 성공 응답을 저장해 재생하는 멱등성 저장소가 없으므로, 같은 버전 재시도에 `409`가 올 수 있다는 사용 규칙을 문서에 남긴다. `409`를 자동 반복하면 해결되지 않는 요청을 계속 보낼 뿐이다. 최신 상태 확인이나 사용자 판단으로 이어져야 한다.

## 계약은 바꾸지 않는 선언이 아니라 변경을 드러내는 도구다

공개 응답에 선택 필드를 하나 더하는 변경도 엄격한 decoder를 쓰는 클라이언트에는 영향이 있을 수 있다. 이번 스키마는 `additionalProperties: false`로 현재 필드 집합을 명시했으므로 서버 필드를 늘릴 때 테스트와 문서가 함께 움직인다. 요청에서는 새 필수 필드를 추가하는 변화가 더 직접적이다. 이전 화면은 그 필드를 보내지 못하므로 기존 요청이 `400`으로 바뀐다.

반대로 내부 `authorId`의 저장 방식이나 서비스 클래스 이름을 바꾸는 것은 공개 필드가 유지되는 한 API 변화가 아닐 수 있다. 다만 기본 `operationId`는 controller tag·handler 이름·method·path에서 결정되므로 메서드 이름 변경이 생성 클라이언트 이름에 영향을 줄 가능성은 남는다. 생성 클라이언트를 도입하는 시점에는 실제 문서 차이를 검토하고, 필요한 경우 `documentTransform`으로 안정된 식별자를 명시하는 정책을 세운다.

아직 모든 API를 URI 버전별로 복제할 필요는 없다. 사용자와 클라이언트 수, 호환 지원 기간, 배포 순서가 그 비용을 정한다. 작은 로컬 제품에서는 계약 테스트와 한 번의 합의된 변경이 더 낫고, 이미 배포된 독립 클라이언트가 많다면 구버전을 유지하는 시간이 필요하다. 버전 데코레이터부터 붙이는 대신 누가 어느 계약에 의존하는지 기록한다.

여기까지 FluoBlog는 글의 상태, 요청의 출처, 공개 필드, 성공과 실패의 문서를 같은 이야기로 설명할 수 있게 되었다. 다음 장에서는 이 앱을 다른 환경에서 실행한다. 포트와 연결 정보를 코드에 고정한 채 로컬에서 성공한 사실만으로 배포할 수는 없다. 설정 값을 검증하여 시작 경계에 전달한 뒤, 이어지는 장에서 메모리 게시글을 PostgreSQL로 옮기며 저장의 약속을 확장하자.

## 근거와 이어 읽기

- [`@fluojs/openapi` README](../../packages/openapi/README.ko.md), [공개 export](../../packages/openapi/src/index.ts): 명시적 sources, 응답 문서 경계, 기본 오류 정책, 경로 예약의 계약이다.
- [OpenAPI 데코레이터](../../packages/openapi/src/decorators.ts), [스키마 builder](../../packages/openapi/src/schema-builder.ts), [builder 테스트](../../packages/openapi/src/schema-builder.test.ts): 요청 추론과 명시적 schema, 기본 응답, `operationId` 생성의 근거다.
- [OpenAPI 모듈](../../packages/openapi/src/openapi-module.ts), [문서 경로 테스트](../../packages/openapi/src/openapi-module-routes.test.ts): 옵션 스냅샷과 모듈 등록, 실제 문서 경로와 충돌의 근거다.
- [`@fluojs/http` README](../../packages/http/README.ko.md), [예외와 오류 envelope](../../packages/http/src/exceptions.ts), [오류 응답 writer](../../packages/http/src/dispatch/dispatch-error-representation.ts): HTTP 상태와 공개 오류 형태의 기준이다.
- [확정 목차 manifest](../series.json): 다음 환경 설정·영속성 장과 같은 제품을 계속 확장하는 순서다.

[이전: 저장한 데이터와 공개할 데이터 구분하기](./ch07-response-models.ko.md) · [1권 목차](./toc.ko.md) · [다음: 환경이 달라도 같은 코드 실행하기](./ch09-configuration.ko.md)
