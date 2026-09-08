# 누가 이 글을 수정할 수 있는가

<!-- book:volume=01-fluoblog;chapter=15 -->

[이전: 로그인 상태를 검증하기](./ch14-authentication.ko.md) · [1권 목차](./toc.ko.md) · [다음: 정상 사용자와 서비스 보호하기](./ch16-abuse-protection.ko.md)

## 로그인에 성공한 독자가 다른 사람의 글을 고쳤다

FluoBlog의 두 번째 기고자가 자기 초안을 저장한 뒤 주소의 숫자를 바꿨다. 편집 화면이 다른 글을 보여 주지는 않았지만, 개발자 도구에서 `PUT /posts/1` 요청을 직접 보내자 첫 운영자의 글이 바뀌었다. 서버는 토큰이 유효하다는 사실만 확인하고 요청의 게시글 ID로 업데이트했다. 화면에서 수정 버튼을 숨긴 것도, 로그인 검사를 추가한 것도 이 실패를 막지 못했다.

인증은 요청의 주체를 확인한다. 인가는 그 주체가 특정 자원에 특정 작업을 해도 되는지 판단한다. 앞 장의 `BlogJwtStrategy`가 확인한 `principal.subject`는 신뢰할 수 있는 사용자 ID지만 모든 글의 소유권을 뜻하지 않는다. 이 장에서는 `posts:write`라는 기능 권한과 `Post.authorId`라는 리소스 관계를 함께 확인한다. 그리고 검사 당시에는 수정할 수 있었더라도 저장 직전에 상태가 바뀌는 경우를 다룬다.

출발 데이터는 앞 장과 같다. `User.id`와 JWT의 `sub`는 문자열 사용자 ID이고, `Post.id`는 양의 정수다. 게시글은 `authorId`, `title`, `content`, `slug`, `status`, `version`, `publishedAt`를 가진다. 5장에서 정한 규칙을 유지해 작성자는 자기 초안의 제목·본문·slug를 전체 교체할 수 있다. 발행된 본문은 불변이며 작성자도 이 편집 경로로 바꾸지 못한다. 발행 상태와 `publishedAt`은 이 경로의 수정 대상이 아니다. 초안의 빈 값과 중복 제안 slug는 계속 허용한다.

이 규칙은 모든 출판 제품의 정답은 아니다. 발행 후 오탈자 수정이 필요해지면 새 초안을 만드는 개정 흐름이나 발행 이력을 보존하는 별도 작업을 설계할 수 있다. 그것은 기존 발행 계약과 테스트를 명시적으로 바꾸는 제품 변경이며, 이 인가 장에서 조용히 도입하지 않는다. 지금은 사람의 권한과 현재 상태에서 허용되는 작업을 각각 확인한다.

## 역할 이름만으로는 소유권을 표현할 수 없다

처음에는 `author` 역할이 있으면 수정하도록 생각하기 쉽다. 그러나 작성자는 다른 작성자의 글도 읽으며, 독자는 자기 첫 글을 쓰는 순간 작성자가 될 수 있다. 역할 이름으로 사람을 분류하는 것과 한 게시글의 소유자를 확인하는 것은 다르다. FluoBlog는 활성 계정에 `posts:write` scope를 발급하되 자기 `authorId`와 일치하는 글만 수정하게 한다. 관리자라는 문자열을 요청에 넣었다고 우회할 수 있는 분기는 만들지 않는다.

`@fluojs/passport`의 `@RequireScopes`는 전달한 scope가 모두 있는지 검사한다. 문자열 `posts:*`를 넣으면 자동으로 `posts:write`를 포함하는 계층 권한이 되는 것이 아니다. 클래스와 메서드의 scope 요구는 합쳐지므로 클래스에 `posts:write`를 걸고 어떤 메서드에서 빈 목록으로 지우는 설계를 해서는 안 된다. 공개 조회와 보호된 쓰기가 함께 있는 큰 컨트롤러에는 메서드 단위 선언이 더 읽기 쉽다.

또한 `@UseOptionalAuth`를 편집 경로에 쓰지 않는다. 이 데코레이터는 게스트도 허용하는 경로를 위한 선택이며, scope가 요구되는 경로에는 여전히 principal이 필요하다. 보호할 메서드에는 `@UseAuth('blog-jwt')`와 필요한 scope를 명시한다. `@UseAuth`가 이미 `AuthGuard`를 붙이므로 같은 가드를 이름만 바꿔 여러 번 덧붙일 이유는 없다.

다음은 **완전한 파일 `src/posts/post-edit-policy.ts`**이다. 정책은 HTTP 요청이나 Prisma 클라이언트를 몰라도 판단할 수 있다. 이 작은 함수는 범용 정책 엔진을 만들기 위한 시작점이 아니라, 라우트에서의 빠른 확인과 저장 경계에서의 확인을 같은 규칙으로 유지하기 위한 코드다.

```ts
export type PostActor = {
  id: string;
  scopes: readonly string[];
};

export type PostOwnership = {
  authorId: string;
};

export function canEditPost(actor: PostActor, post: PostOwnership): boolean {
  return actor.scopes.includes('posts:write') && actor.id === post.authorId;
}
```

`canEditPost`는 scope와 소유권이라는 인가 조건만 판단한다. `true`가 발행본 수정까지 허용한다는 뜻은 아니며 서비스가 초안 상태와 버전을 추가로 확인한다. `PostActor`는 외부 body에서 역직렬화하는 DTO가 아니다. HTTP에서는 인증된 principal로 만들고, 향후 내부 작업에서 사용한다면 그 작업을 시작한 신원을 검증한 뒤 생성한다. TypeScript 타입은 데이터의 신뢰성을 증명하지 않는다. 컨트롤러가 body의 `actor`를 그대로 넘기면 이 함수가 완벽해도 인가는 무너진다. 아래 HTTP 코드에서 주체를 추출하는 위치를 함께 봐야 한다.

## 입력에서 권위 있는 값을 제외하기

서버가 이미 아는 `authorId`를 클라이언트에게 다시 받지 않는다. 사용자가 바꿀 수 있는 것은 초안의 제목·본문·slug뿐이다. 동시에 두 편집 탭이 마지막 저장을 덮어쓰지 않도록 화면에서 읽었던 `version`을 `expectedVersion`으로 받는다. 이 값도 권위 있는 현재 버전이 아니라 “나는 이 버전을 보고 편집했다”는 조건이다. 실제 값과 비교해서 맞을 때만 저장한다.

다음은 **완전한 파일 `src/posts/post-edit-input.ts`**이다. DTO 바인딩과 값 검사를 분리했으며 다른 패키지의 검증 데코레이터가 등록되어 있다고 암묵적으로 가정하지 않는다. 경로 매개변수는 숫자로 형변환하기 전에 형식을 검사한다. `parseInt('1junk')`가 `1`이 되는 느슨한 변환이나 JSON의 문자열 숫자를 무조건 수락하지 않는다.

```ts
import { BadRequestException, FromBody, FromPath } from '@fluojs/http';

export class EditPostDto {
  @FromPath('id') id: unknown = '';
  @FromBody() title: unknown = '';
  @FromBody() content: unknown = '';
  @FromBody() slug: unknown = '';
  @FromBody() expectedVersion: unknown = 0;
}

export type EditPostCommand = {
  postId: number; title: string; content: string; slug: string; expectedVersion: number;
};

export function parseEditPost(input: EditPostDto): EditPostCommand {
  if (typeof input.id !== 'string' || !/^[1-9][0-9]*$/.test(input.id)) {
    throw new BadRequestException('Invalid post id.');
  }
  const postId = Number(input.id);
  if (!Number.isSafeInteger(postId) || postId > 2_147_483_647) {
    throw new BadRequestException('Invalid post id.');
  }
  if (typeof input.title !== 'string' || input.title.length > 120
    || typeof input.content !== 'string' || input.content.length > 50_000
    || typeof input.slug !== 'string' || input.slug.length > 80) {
    throw new BadRequestException('Invalid draft text.');
  }
  if (typeof input.expectedVersion !== 'number'
    || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 1 || input.expectedVersion >= 2_147_483_647) {
    throw new BadRequestException('Invalid expected version.');
  }
  return {
    postId, title: input.title, content: input.content, slug: input.slug,
    expectedVersion: input.expectedVersion,
  };
}
```

제목 120, 본문 50,000, slug 80의 상한은 5~6장과 같은 UTF-16 코드 단위(`length`) 기준이다. 빈 문자열도 유효한 초안이다. JSON 파서가 본문 전체를 이미 읽은 후에 적용되는 검사이므로 네트워크 수준의 최대 요청 크기를 대신하지 않는다. 그 경계는 다음 장에서 분리해서 다룬다. `expectedVersion`의 상한은 여기서 사용하는 Prisma `Int`의 PostgreSQL 정수 범위와 다음 증가 연산을 고려했다. 현실적으로 드물어 보여도 타입 범위를 넘겨 데이터베이스 오류가 되는 입력은 HTTP 경계에서 거절할 수 있다.

컨트롤러가 요청 body를 객체 펼침으로 Prisma의 `data`에 넣지 않는 점도 중요하다. 사용자가 `authorId`, `status`, `version`, `publishedAt`를 추가해서 보내더라도 반환하는 `EditPostCommand`에는 없다. 필드를 허용 목록으로 구성하면 모델에 민감한 열이 새로 추가되어도 그 열을 외부 수정 API가 자동으로 노출하지 않는다. 알려지지 않은 필드를 거절하는 공통 정책을 쓰더라도 이 저장 입력의 명시적 구성이 마지막 방어선이다.

## 확인과 저장 사이에도 조건이 유지되어야 한다

가드에서 글을 조회해 작성자를 비교하고 컨트롤러에서 `update({ where: { id } })`를 실행하는 구현은 충분하지 않다. 두 실행 사이에 다른 편집 요청이 버전을 올릴 수 있다. 향후 작성자 이전 기능이 추가되면 소유자가 바뀔 수도 있다. 이른 검사는 친절한 오류를 만들지만 저장의 전제까지 보장하지는 못한다.

다음은 **완전한 파일 `src/posts/post-editing.service.ts`**이다. 13장의 전역 Prisma 등록과 생성된 `Post` 모델을 사용한다. 첫 조회는 오류를 분류하고, 실제 쓰기는 ID·작성자·버전·상태 조건이 모두 맞는 행에만 적용한다. `updateMany`의 개수를 확인하는 것은 편의 기능이 아니라 이 작업의 성공 판정이다. 성공한 쓰기가 저장한 `reviseDraft` 결과를 반환하고 컨트롤러가 기존 작성 결과 DTO로 변환한다.

```ts
import { Inject } from '@fluojs/core';
import { ForbiddenException } from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { canEditPost, type PostActor } from './post-edit-policy.js';
import type { EditPostCommand } from './post-edit-input.js';
import { PostDomainError, reviseDraft } from './post.js';
import { toPostSnapshot } from './post-row.js';

@Inject(PrismaService)
export class PostEditingService {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async edit(actor: PostActor, command: EditPostCommand) {
    return this.prisma.transaction(async () => {
      const db = this.prisma.current();
      const row = await db.post.findUnique({ where: { id: command.postId } });
      if (!row) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
      if (!canEditPost(actor, row)) {
        throw new ForbiddenException('Only the author may edit this post.');
      }
      const next = reviseDraft(toPostSnapshot(row), command.expectedVersion, {
        title: command.title, content: command.content, slug: command.slug,
      });
      const changed = await db.post.updateMany({
        where: {
          id: command.postId, authorId: actor.id,
          version: command.expectedVersion, status: 'draft',
        },
        data: { title: next.title, content: next.content, slug: next.slug, version: { increment: 1 } },
      });
      if (changed.count !== 1) {
        throw new PostDomainError('POST_VERSION_CONFLICT', 'The post changed while it was being saved.');
      }
      return next;
    });
  }
}
```

이 애플리케이션 서비스는 HTTP 예외와 의도적으로 연결되어 있다. 기존 글 저장 API에 맞는 작은 변경을 우선한 선택이다. `canEditPost` 자체는 HTTP를 모르므로 정책 테스트는 독립적이다. 같은 저장 명령이 큐나 다른 프로토콜에서도 쓰이게 되면 서비스 오류를 도메인 결과로 바꾸고 각 어댑터에서 매핑할 수 있다. 아직 없는 모든 호출자를 위해 Repository와 오류 변환 계층을 미리 늘리지는 않는다.

트랜잭션만 감쌌다고 오래된 편집이 자동으로 실패하지는 않는다. 기본적인 동시성에서 두 트랜잭션이 같은 버전을 읽을 수 있기 때문이다. 둘 다 `version = 4`를 조건으로 쓰면 먼저 성공한 요청이 버전을 5로 올리고, 뒤따르는 쓰기는 조건에 맞는 행을 찾지 못한다. 이 두 번째 요청을 성공처럼 처리하지 않아야 한다. 발행 요청이 먼저 커밋된 경우에도 `status: 'draft'` 조건이 이후의 편집을 막는다. 읽었던 `post.status`를 그대로 쓰면 발행본을 읽은 요청까지 허용하므로 저장 조건에는 허용하는 상태 자체를 명시한다. 응답의 최종 `version`은 다음 편집의 전제가 된다.

충돌 시 서버가 최신 버전을 읽어 자동 재시도하면 사용자가 보지 못한 내용을 덮어쓸 수 있다. 네트워크나 직렬화 충돌의 재시도와 편집 충돌의 재시도는 같은 문제가 아니다. 이 경로는 409를 돌려주고 편집 화면이 자기 초안을 보존한 채 최신 내용과 비교하게 한다. 별도의 멱등성 키도 아직 없다. 응답만 유실된 첫 저장이 이미 커밋되었다면 같은 `expectedVersion` 재전송은 409가 된다. 이는 두 번 저장했다는 뜻이 아니라 먼저 최신 상태를 확인하라는 뜻이다.

## 보호된 라우트에서 검증된 주체를 전달하기

다음은 **완전한 파일 `src/posts/post-editing.controller.ts`**이다. 기존 `PUT /posts/:id`를 이 컨트롤러로 옮긴다. 아래 공개 컨트롤러 전체 교체와 함께 적용하여 이전 무인증 PUT을 제거한다. 응답은 기존 `id`, `status`, `version`, `publishedAt`이며 `runPostCommand`가 비동기 도메인 실패를 매핑한다.

```ts
import { Inject } from '@fluojs/core';
import {
  Controller, HttpCode, Put, RequestDto, UnauthorizedException,
  UseInterceptors, type RequestContext,
} from '@fluojs/http';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiSecurity } from '@fluojs/openapi';
import { RequireScopes, UseAuth } from '@fluojs/passport';
import { SerializerInterceptor } from '@fluojs/serialization';
import { EditPostDto, parseEditPost } from './post-edit-input.js';
import { PostEditingService } from './post-editing.service.js';
import { runPostCommand } from './post-http-error.js';
import { toPostWriteReceipt } from './post-response.dto.js';
import { errorResponseSchema, postIdParameterSchema, postWriteReceiptSchema } from './post-api.schemas.js';

@Controller('/posts')
@Inject(PostEditingService)
@UseInterceptors(SerializerInterceptor)
export class PostEditingController {
  constructor(private readonly editing: PostEditingService) {}

  @Put('/:id')
  @HttpCode(200)
  @UseAuth('blog-jwt')
  @RequireScopes('posts:write')
  @ApiSecurity('bearer')
  @RequestDto(EditPostDto)
  @ApiOperation({ summary: 'Replace all editable text in an owned draft' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiBody({ schema: {
    type: 'object', additionalProperties: false,
    required: ['title', 'content', 'slug', 'expectedVersion'],
    properties: {
      title: { type: 'string', maxLength: 120 },
      content: { type: 'string', maxLength: 50_000 },
      slug: { type: 'string', maxLength: 80 },
      expectedVersion: { type: 'integer', minimum: 1, maximum: 2_147_483_646 },
    },
  } })
  @ApiResponse(200, { schema: postWriteReceiptSchema })
  @ApiResponse(409, { schema: errorResponseSchema })
  edit(input: EditPostDto, context: RequestContext) {
    const principal = context.principal;
    if (!principal) throw new UnauthorizedException();
    return runPostCommand(async () => toPostWriteReceipt(await this.editing.edit(
      { id: principal.subject, scopes: principal.scopes ?? [] }, parseEditPost(input),
    )));
  }
}
```

가드가 있는데도 서비스에서 scope를 다시 확인하는 이유는 다음 호출자가 가드를 빠뜨릴 수 있기 때문이다. HTTP 경로에서는 Passport가 일찍 거절해 불필요한 저장소 작업을 줄이고, 서비스는 자기 쓰기 계약을 보존한다. 반대로 모든 요청에서 현재 사용자를 싱글턴 서비스의 `this.currentUser` 같은 필드에 저장하면 동시에 실행되는 요청 사이에 사용자가 섞일 수 있다. 주체는 요청 인자로 전달하며 전역 상태로 보관하지 않는다.

## 남아 있는 생성·발행 경로까지 보호하기

`src/posts/posts.controller.ts`는 다음 **공개 GET 전용 전체 파일**로 교체한다. 8~12장의 익명 `create`, `replace`, `publish` 메서드는 모두 이 파일에서 제거한다. 같은 경로의 이전 컨트롤러를 별도 이름으로 등록하지 않는다. 편집은 기존 `PUT /posts/:id` 전체 교체 계약을 유지하고, 별도 `PATCH` 경로는 만들지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { Controller, Get, RequestDto, UseInterceptors } from '@fluojs/http';
import { ApiOperation, ApiParam, ApiResponse } from '@fluojs/openapi';
import { SerializerInterceptor } from '@fluojs/serialization';
import { PostsService } from './posts.service.js';
import { PostFeed } from './post-feed.js';
import { GetPostDto } from './post-request.dto.js';
import { ListPostsDto, postPageSchema } from './post-page.js';
import { runPostCommand } from './post-http-error.js';
import { toPublicPost } from './post-response.dto.js';
import { errorResponseSchema, postIdParameterSchema, publicPostSchema } from './post-api.schemas.js';

@Controller('/posts')
@Inject(PostsService, PostFeed)
@UseInterceptors(SerializerInterceptor)
export class PostsController {
  constructor(private readonly posts: PostsService, private readonly feed: PostFeed) {}

  @Get()
  @RequestDto(ListPostsDto)
  @ApiOperation({ summary: 'List published posts' })
  @ApiResponse(200, { schema: postPageSchema })
  list(input: ListPostsDto) {
    return this.feed.list({ limit: input.limit, cursor: input.cursor });
  }

  @Get('/:id')
  @RequestDto(GetPostDto)
  @ApiOperation({ summary: 'Read one published post' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiResponse(200, { schema: publicPostSchema })
  @ApiResponse(404, { schema: errorResponseSchema })
  get(input: GetPostDto) {
    return runPostCommand(async () => toPublicPost(await this.posts.getPublished(input.id)));
  }
}
```

**`src/posts/post-writing.service.ts` 전체**다. 생성 작성자는 인증된 계정 ID이며 발행은 11장의 작성자 비교·조건부 갱신·발행 기록 트랜잭션을 통과한다. scope도 서비스 입구에서 확인해 가드 없는 내부 호출이 인가를 생략하지 못하게 한다.

```ts
import { Inject } from '@fluojs/core';
import { ForbiddenException } from '@fluojs/http';
import type { DraftText } from './post.js';
import type { PostActor } from './post-edit-policy.js';
import { PostsService } from './posts.service.js';

@Inject(PostsService)
export class PostWritingService {
  constructor(private readonly posts: PostsService) {}

  async create(actor: PostActor, text: DraftText) {
    if (!actor.scopes.includes('posts:write')) throw new ForbiddenException();
    return this.posts.create(actor.id, text);
  }

  async publish(actor: PostActor, postId: number, expectedVersion: number) {
    if (!actor.scopes.includes('posts:write')) throw new ForbiddenException();
    return this.posts.publish(postId, expectedVersion, actor.id);
  }
}
```

**`src/posts/post-writing.controller.ts` 전체**다. `author-1`이나 body의 `authorId`를 쓰지 않고 검증된 principal만 전달한다. 생성과 발행 모두 가드를 가진다.

```ts
import { Inject } from '@fluojs/core';
import {
  Controller, HttpCode, Post, RequestDto, UnauthorizedException,
  UseInterceptors, type RequestContext,
} from '@fluojs/http';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity } from '@fluojs/openapi';
import { RequireScopes, UseAuth } from '@fluojs/passport';
import { SerializerInterceptor } from '@fluojs/serialization';
import { CreatePostDto, PublishPostDto } from './post-request.dto.js';
import { runPostCommand } from './post-http-error.js';
import { toPostWriteReceipt } from './post-response.dto.js';
import { PostWritingService } from './post-writing.service.js';
import { errorResponseSchema, postIdParameterSchema, postWriteReceiptSchema } from './post-api.schemas.js';

@Controller('/posts')
@Inject(PostWritingService)
@UseInterceptors(SerializerInterceptor)
export class PostWritingController {
  constructor(private readonly writing: PostWritingService) {}

  @Post()
  @HttpCode(201)
  @UseAuth('blog-jwt')
  @RequireScopes('posts:write')
  @ApiSecurity('bearer')
  @RequestDto(CreatePostDto)
  @ApiOperation({ summary: 'Create a draft for the authenticated account' })
  @ApiResponse(201, { schema: postWriteReceiptSchema })
  create(input: CreatePostDto, context: RequestContext) {
    const principal = context.principal;
    if (!principal) throw new UnauthorizedException();
    return runPostCommand(async () => toPostWriteReceipt(await this.writing.create(
      { id: principal.subject, scopes: principal.scopes ?? [] },
      { title: input.title, content: input.content, slug: input.slug },
    )));
  }

  @Post('/:id/publish')
  @HttpCode(200)
  @UseAuth('blog-jwt')
  @RequireScopes('posts:write')
  @ApiSecurity('bearer')
  @RequestDto(PublishPostDto)
  @ApiOperation({ summary: 'Publish an owned draft' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiResponse(200, { schema: postWriteReceiptSchema })
  @ApiResponse(409, { schema: errorResponseSchema })
  publish(input: PublishPostDto, context: RequestContext) {
    const principal = context.principal;
    if (!principal) throw new UnauthorizedException();
    return runPostCommand(async () => toPostWriteReceipt(await this.writing.publish(
      { id: principal.subject, scopes: principal.scopes ?? [] }, input.id, input.expectedVersion,
    )));
  }
}
```

**`src/posts/posts.module.ts` 전체**는 모든 저장소·변환기·직렬화기와 인증된 쓰기 제공자를 등록한다.

```ts
import { Module } from '@fluojs/core';
import { AuthModule } from '../auth/auth.module.js';
import { PostEditingController } from './post-editing.controller.js';
import { PostEditingService } from './post-editing.service.js';
import { PostWritingController } from './post-writing.controller.js';
import { PostWritingService } from './post-writing.service.js';
import { SerializerInterceptor } from '@fluojs/serialization';
import { PostIdConverter } from './post-id.converter.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';
import { PostsRepository } from './posts.repository.js';
import { PostLinks } from './post-links.js';
import { PostPublicationsRepository } from './post-publications.repository.js';
import { PublishingService } from './publishing.service.js';
import { PostFeed } from './post-feed.js';

@Module({
  imports: [AuthModule],
  controllers: [PostsController, PostEditingController, PostWritingController],
  providers: [
    PostsService, PostsRepository, PostLinks, PostIdConverter, SerializerInterceptor,
    PostPublicationsRepository, PublishingService, PostFeed,
    PostEditingService, PostWritingService,
  ],
  exports: [PostsService, PostsRepository, PublishingService, PostFeed],
})
export class PostsModule {}
```

14장에서 `PassportModule`은 `AuthGuard`를 전역으로 export하고 `AuthModule`은 `BlogJwtStrategy`를 export했다. 따라서 이 그래프는 실제 토큰 해석 경로까지 연결한다. 클래스 이름을 import한 것과 모듈의 provider 가시성을 확보한 것은 다르다. `PostsModule`이 `AuthModule`을 import하지 않으면 전략 이름은 등록되어 있어도 라우트의 컨테이너에서 전략을 찾지 못할 수 있다. 이런 설정 오류를 권한 부족 403으로 숨기지 않는다.

**`src/app.ts` 전체**도 문서 대상에 분리한 컨트롤러를 모두 포함한다. `BlogDatabaseModule`은 여전히 단일 전역 등록이다.

```ts
import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';
import { AppSettingsModule } from './config/app-settings.module.js';
import { BlogDatabaseModule } from './database/blog-database.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthController } from './auth/auth.controller.js';
import { PostEditingController } from './posts/post-editing.controller.js';
import { PostWritingController } from './posts/post-writing.controller.js';
import { PostsController } from './posts/posts.controller.js';
import { PostsModule } from './posts/posts.module.js';

@Module({
  imports: [
    AppSettingsModule, BlogDatabaseModule, AccountsModule, AuthModule, PostsModule,
    OpenApiModule.forRoot({
      title: 'FluoBlog API', version: '1.0.0',
      sources: [
        { controllerToken: PostsController }, { controllerToken: PostEditingController },
        { controllerToken: PostWritingController }, { controllerToken: AuthController },
      ],
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      documentPath: '/openapi.json', uiPath: '/docs', ui: true,
      defaultErrorResponsesPolicy: 'inject',
    }),
  ],
})
export class AppModule {}
```

## 실패 응답으로 무엇을 알려 줄 것인가

이 장의 경로에서 미인증은 401, scope 부족과 다른 작성자의 글은 403, 존재하지 않는 글은 404, 오래된 버전이나 발행본 편집은 409, 잘못된 입력은 400이다. Fluo의 `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, `BadRequestException`은 각각 이 상태를 명시적으로 갖는다. 가드에서 단순히 `false`를 반환하면 HTTP 가드 체인은 403을 던진다. 자격 증명이 없을 때 401을 의도한다면 Passport 인증 경로 또는 명시적 예외를 써야 한다.

타인 글에 403을 주고 없는 글에 404를 주면 존재 여부는 구별할 수 있다. 이 블로그는 공개 글 ID가 노출되는 제품이므로 편집 API에서도 이 구분을 선택했다. 그러나 비공개 초안의 존재까지 숨겨야 하는 제품이라면 권한 없는 조회와 없는 리소스를 같은 404로 처리하고 모든 관련 경로에서 정책을 맞춰야 한다. 응답 코드 하나만 바꾸면서 검색·오류 메시지·처리 시간에서는 존재 여부가 드러나는 상태를 완전한 은닉이라고 설명하지 않는다.

계정 정지의 정확한 시점도 구별해야 한다. `BlogJwtStrategy`의 현재 계정 조회가 성공한 뒤 정지가 커밋되면 진행 중인 저장이 완료될 수 있다. 이 장의 정책은 인증 판단 이후 이미 승인된 실행을 소급 취소하지 않는다. 법적 잠금처럼 정지 커밋 뒤 어떤 쓰기도 완료되면 안 되는 요구라면, 계정 정지와 게시글 쓰기가 같은 잠금 규칙을 따르도록 트랜잭션 경계를 확장해야 한다. 단순히 계정을 한 번 더 조회하는 것은 또 다른 확인·사용 간격을 만들 뿐이다.

## 작성자·권한·버전의 조합을 검증하기

아래는 **완전한 파일 `src/posts/post-edit-policy.test.ts`**이다. 역할이나 화면 표시가 아니라 이 정책이 결정하는 실제 입력 조합을 검사한다. 특히 scope가 있는 다른 사람과 scope가 없는 작성자를 따로 검사해야 조건 하나를 삭제한 회귀를 발견할 수 있다.

```ts
import { describe, expect, it } from 'vitest';
import { canEditPost } from './post-edit-policy.js';

describe('post edit authorization', () => {
  it('requires both ownership and the exact write scope', () => {
    const post = { authorId: 'author-a' };
    expect(canEditPost(
      { id: 'author-a', scopes: ['posts:write'] }, post,
    )).toBe(true);
    expect(canEditPost(
      { id: 'author-b', scopes: ['posts:write'] }, post,
    )).toBe(false);
    expect(canEditPost(
      { id: 'author-a', scopes: [] }, post,
    )).toBe(false);
    expect(canEditPost(
      { id: 'author-a', scopes: ['posts:*'] }, post,
    )).toBe(false);
  });
});
```

```bash
pnpm exec vitest run src/posts/post-edit-policy.test.ts
```

정책 함수 테스트만으로 라우트 보호를 증명할 수는 없다. Node.js 24 앱과 개발 PostgreSQL에서 두 사용자 A와 B, A의 초안 한 개를 만든다. A와 B 모두 정상 토큰을 갖게 한 뒤 B의 토큰으로 A의 글을 수정한다. 기대 결과는 403이고, 제목·본문·버전이 모두 이전 값이어야 한다. body에 A의 `authorId`와 `roles: ['admin']`을 추가하면 6장의 허용 목록 바인더가 알 수 없는 필드를 400으로 거부하며, 이 경우에도 데이터는 바뀌지 않는다. A의 토큰과 올바른 버전으로는 200이며 정확히 버전 하나가 증가한다.

경합 실험은 같은 `expectedVersion`을 가진 A의 요청 두 개를 `Promise.all`로 시작하고 둘 다 완료된 뒤 결과를 확인한다. PostgreSQL 기본 READ COMMITTED 경로에서 기대 결과는 200 하나와 409 하나, 최종 버전의 증가량 1이다. 먼저 끝나는 요청이 어느 제목을 저장할지는 정하지 않는다. 두 후보 중 하나가 그대로 저장되고 다른 요청이 덮어쓰지 않았는지가 관찰 대상이다. 테스트용 시간 지연으로 순서를 맞추지 않는다. 더 높은 격리 수준을 별도로 사용한다면 직렬화 실패의 매핑도 추가로 검증해야 한다.

저장 응답에 포함되지 않는 효과도 확인한다. 초안은 계속 `draft`이고 `publishedAt`은 원래 값이어야 한다. A가 소유한 발행 글에 현재 버전으로 편집 요청을 보내도 409여야 하며 제목·본문·버전·`slug`·`publishedAt`가 모두 그대로여야 한다. 초안 발행이 커밋된 뒤 편집이 쓰기를 시도하는 경합에서도 같은 불변식을 확인한다. 없는 ID는 404, 누락된 토큰은 401, 문자열 `expectedVersion`은 400이다. 여러 조건이 동시에 잘못되었을 때 모든 오류를 한 응답에 나열한다고 기대하지 않는다. 인증·바인딩·정책·저장 중 먼저 거절하는 경계가 결과를 결정한다.

## 기존 쓰기 경로의 우회를 실제 HTTP로 확인하기

8장의 `src/posts/post-api.test.ts`도 다음 **전체 파일**로 교체한다. `PostsController` 하나만 descriptor로 만들면 지금은 공개 GET 두 개만 보인다. 실제로 등록한 세 컨트롤러를 같은 목록으로 문서화하고, 기존 입력 허용 목록·출력 키·다섯 동작 검증에 인증 메타데이터를 더한다.

```ts
import { createHandlerMapping } from '@fluojs/http';
import { buildOpenApiDocument } from '@fluojs/openapi';
import { serialize } from '@fluojs/serialization';
import { describe, expect, it } from 'vitest';
import { createDraft, publishPost } from './post.js';
import { toPublicPost } from './post-response.dto.js';
import { PostsController } from './posts.controller.js';
import { PostEditingController } from './post-editing.controller.js';
import { PostWritingController } from './post-writing.controller.js';
import { getAuthRequirement } from '@fluojs/passport';

function buildDocument() {
  return buildOpenApiDocument({
    descriptors: createHandlerMapping([
      { controllerToken: PostsController }, { controllerToken: PostEditingController },
      { controllerToken: PostWritingController },
    ]).descriptors,
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    title: 'FluoBlog API',
    version: '1.0.0',
    defaultErrorResponsesPolicy: 'inject',
  });
}

describe('Post API contract', () => {
  it('protects every retained write route while leaving GET public', () => {
    for (const [controller, method] of [
      [PostEditingController, 'edit'],
      [PostWritingController, 'create'],
      [PostWritingController, 'publish'],
    ] as const) {
      expect(getAuthRequirement(controller, method)).toMatchObject({
        strategy: 'blog-jwt', scopes: ['posts:write'],
      });
    }
    expect(getAuthRequirement(PostsController, 'list')).toBeUndefined();
    expect(getAuthRequirement(PostsController, 'get')).toBeUndefined();
    const document = buildDocument();
    expect(document.paths['/posts/{id}']?.patch).toBeUndefined();
    expect(document.paths['/posts/{id}']?.put?.security).toEqual([{ bearer: [] }]);
    expect(document.paths['/posts']?.post?.security).toEqual([{ bearer: [] }]);
    expect(document.paths['/posts/{id}/publish']?.post?.security).toEqual([{ bearer: [] }]);
    expect(document.paths['/posts']?.get?.responses['200']?.content?.['application/json']?.schema
      ?.properties?.nextCursor).toEqual({ type: ['string', 'null'] });
  });

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

```bash
pnpm exec vitest run src/posts/post-api.test.ts
```

다음은 **`scripts/post-authorization-check.mjs` 전체**다. 10~15장 마이그레이션을 적용한 전용 테스트 DB와 실행 중인 로컬 앱에서 `node scripts/post-authorization-check.mjs`로 실행한다. 16장의 한도 적용 전 실험이며 생성한 계정·글은 이 전용 DB에 남는다. 운영 DB에서는 실행하지 않는다. 앞 장의 익명 HTTP 스크립트 대신 이 인증된 경로 검증을 사용한다.

```js
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = 'http://127.0.0.1:3000';
async function request(method, path, body, token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}
async function account(label) {
  const input = {
    email: label + '-' + randomUUID() + '@example.test',
    password: 'test-only-long-password', displayName: label,
  };
  assert.equal((await request('POST', '/auth/register', input)).status, 201);
  const login = await request('POST', '/auth/login', inputWithoutName(input));
  assert.equal(login.status, 200);
  return login.body;
}
function inputWithoutName(input) {
  return { email: input.email, password: input.password };
}
const a = await account('writer-a');
const b = await account('writer-b');
const empty = { title: '', content: '', slug: '' };
const created = await request('POST', '/posts', empty, a.accessToken);
assert.equal(created.status, 201);
assert.equal(created.body.version, 1);
assert.equal((await request('POST', '/posts', empty, a.accessToken)).status, 201);
const id = created.body.id;
assert.equal((await request('GET', '/posts/' + id)).status, 404);
assert.equal((await request('GET', '/posts')).status, 200);
for (const [method, path, body] of [
  ['POST', '/posts', empty],
  ['PUT', '/posts/' + id, { ...empty, expectedVersion: 1 }],
  ['POST', '/posts/' + id + '/publish', { expectedVersion: 1 }],
]) {
  assert.equal((await request(method, path, body)).status, 401);
}
assert.equal((await request('PUT', '/posts/' + id, { ...empty, expectedVersion: 1 }, b.accessToken)).status, 403);
assert.equal((await request('POST', '/posts/' + id + '/publish', { expectedVersion: 1 }, b.accessToken)).status, 403);
assert.equal((await request('PUT', '/posts/' + id, {
  ...empty, title: '\u{1F600}'.repeat(61), expectedVersion: 1,
}, a.accessToken)).status, 400);
assert.equal((await request('PUT', '/posts/' + id, { ...empty, expectedVersion: 0 }, a.accessToken)).status, 400);
const slug = 'owned-' + randomUUID();
const text = { title: 'Owned draft', content: 'Publish only after editing.', slug };
const saved = await request('PUT', '/posts/' + id, { ...text, expectedVersion: 1 }, a.accessToken);
assert.equal(saved.status, 200);
assert.equal(saved.body.version, 2);
assert.equal((await request('PUT', '/posts/' + id, { ...text, expectedVersion: 1 }, a.accessToken)).status, 409);
const published = await request('POST', '/posts/' + id + '/publish', { expectedVersion: 2 }, a.accessToken);
assert.equal(published.status, 200);
assert.equal(published.body.version, 3);
assert.equal(typeof published.body.publishedAt, 'string');
assert.deepEqual(Object.keys(published.body).sort(), ['id', 'publishedAt', 'status', 'version']);
assert.equal((await request('PUT', '/posts/' + id, { ...empty, expectedVersion: 3 }, a.accessToken)).status, 409);
assert.equal((await request('POST', '/posts/' + id + '/publish', { expectedVersion: 2 }, a.accessToken)).status, 409);
const duplicate = await request('POST', '/posts', text, a.accessToken);
assert.equal(duplicate.status, 201);
const conflict = await request('POST', '/posts/' + duplicate.body.id + '/publish', { expectedVersion: 1 }, a.accessToken);
assert.equal(conflict.status, 409);
assert.equal(conflict.body.error.code, 'POST_SLUG_CONFLICT');
const direct = await request('POST', '/posts', { ...text, slug: 'direct-' + randomUUID() }, a.accessToken);
const firstPublication = await request('POST', '/posts/' + direct.body.id + '/publish', { expectedVersion: 1 }, a.accessToken);
assert.equal(firstPublication.status, 200);
assert.equal(firstPublication.body.version, 2);
const detail = await request('GET', '/posts/' + id);
assert.equal(detail.status, 200);
assert.equal(detail.body.title, text.title);
assert.equal(detail.body.publishedAt, published.body.publishedAt);
const document = await request('GET', '/openapi.json');
for (const [path, method] of [['/posts', 'post'], ['/posts/{id}', 'put'], ['/posts/{id}/publish', 'post']]) {
  assert.deepEqual(document.body.paths[path][method].security, [{ bearer: [] }]);
}
assert.equal(document.body.paths['/posts/{id}'].patch, undefined);
const unusedPatch = await request('PATCH', '/posts/' + id, { ...text, expectedVersion: 3 }, a.accessToken);
assert.ok([404, 405].includes(unusedPatch.status));
console.log('Authenticated post continuity checks passed.');
```

추가로 `posts:write`가 없는 유효한 테스트 토큰으로 생성·PUT·발행을 각각 요청하면 403이어야 한다. 테스트 DB에서 새 글의 `authorId`가 로그인 응답 `user.id`와 같은지, 실패한 중복 발행 글이 `draft/version=1/publishedAt=null`이며 기록이 없는지 확인한다. 생성 직후의 빈 초안 두 개는 서로 다른 ID를 갖는다. 이 HTTP 스크립트와 실제 PostgreSQL 실험은 원고에 제시한 재현 절차이며 여기서 실행한 기록이 아니다.

이 원고 작성에서는 제시한 테스트와 PostgreSQL 경합 실험을 실행하지 않았다. 실제 패키지의 scope·가드·예외 소스를 근거로 구현을 구성했으며, 독자 앱의 마이그레이션과 라우트 통합은 별도의 재현 범위다. 검증할 때는 성공 상태 코드만 보지 말고 실패 뒤 데이터가 바뀌지 않았다는 결과까지 확인해야 한다.

FluoBlog는 이제 “로그인했는가” 다음에 “이 사람이 이 글을 수정할 수 있는가”를 판단한다. 하지만 권한이 없는 요청을 안전하게 거절하는 것과 수천 번의 요청을 감당하는 것은 다르다. 다음 장에서는 비밀번호 추측과 저장 버튼 연타가 정상 독자의 사용 경험을 망치지 않도록 요청 비용과 제한의 위치를 설계한다.

## 근거와 더 읽을 소스

- [HTTP 라우트·가드·예외 계약](../../packages/http/README.ko.md)
- [HTTP 공개 export](../../packages/http/src/index.portable.ts), [가드 체인의 거절 동작](../../packages/http/src/guards.ts)
- [상태 코드가 명시된 HTTP 예외](../../packages/http/src/exceptions.ts)
- [Passport 인증·scope 계약](../../packages/passport/README.ko.md)
- [인증 데코레이터의 가드 부착](../../packages/passport/src/decorators.ts), [scope 병합 구현](../../packages/passport/src/scope.ts)
- [scope 부족과 인증 실패 테스트](../../packages/passport/src/guard.test.ts)
- [Prisma 트랜잭션 경계 계약](../../packages/prisma/README.ko.md)

[이전 장](./ch14-authentication.ko.md) · [1권 목차](./toc.ko.md) · [다음 장](./ch16-abuse-protection.ko.md)
