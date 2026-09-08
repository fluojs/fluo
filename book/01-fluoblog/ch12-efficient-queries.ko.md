# 글이 많아져도 목록이 느려지지 않게 하기

<!-- book:volume=01-fluoblog;chapter=12 -->

[이전: 글 발행을 하나의 작업으로 보장하기](./ch11-publishing-transactions.ko.md) · [1권 목차](./toc.ko.md) · [다음: 사용자와 자격 증명 모델링하기](./ch13-accounts-and-credentials.ko.md)

## 첫 페이지는 빠른데 다음 페이지는 다르다

FluoBlog의 글이 늘어나자 독자가 첫 20개보다 오래된 글도 보고 싶다고 한다. 운영자는 페이지 번호를 받아 `skip`과 `take`를 적용했다. 처음에는 잘 동작했다. 그러나 뒤쪽 페이지를 열수록 응답이 느려졌고, 독자가 다음 페이지를 누르는 사이 새 글이 발행되면 이전 페이지의 마지막 글이 다시 나타나기도 했다.

10장의 목록 조회는 발행된 글의 첫 20개만 반환했다. 본문을 빼고 개수를 제한한 것은 좋은 출발이지만, 그것만으로 연속 조회 계약이 생기지는 않는다. 이번 장에서는 어디까지 읽었는지 표현하는 커서, 순서를 결정하는 두 필드, 그 순서로 이동할 수 있는 인덱스를 함께 설계한다. 캐시 서버를 먼저 추가하지 않는다. 같은 비싼 조회를 잠시 숨기는 것과 조회가 읽는 데이터의 양을 줄이는 것은 다른 해결책이다.

정확성도 성능의 일부다. 15밀리초 만에 초안을 공개하거나 글을 누락하는 쿼리는 성공이 아니다. 목록에 포함될 행, 노출할 열, 한 번에 가져올 개수, 페이지 사이에서 허용하는 변화를 먼저 정한다. 그 뒤 실제 PostgreSQL 실행 계획으로 선택한 인덱스와 읽기 비용을 확인한다.

## 목록은 게시글 전체를 복사하는 API가 아니다

독자 목록에는 `id`, `title`, `slug`, `publishedAt`만 필요하다. 긴 `content`는 `/posts/:id` 상세 조회에서 읽고 작성자 식별자나 발행 작업의 내부 버전은 공개 카드에 넣지 않는다. 작은 응답은 직렬화와 네트워크 비용도 줄인다. 하지만 DB에서 모든 열을 읽어 온 뒤 자바스크립트에서 지우면 앞부분 비용은 이미 지불한 셈이다.

다음은 기존 `PostsRepository.listPublished()`에 페이지 번호를 덧붙였을 때의 **비교용 조회 부분**이다. `prisma`는 등록된 `PrismaService<PrismaClient>`이고 `page`는 검증된 양의 정수라고 가정한다. 완성할 목록의 최종 구현은 아니다.

```ts
const rows = await prisma.current().post.findMany({
  where: { status: 'published' },
  orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
  skip: (page - 1) * 20,
  take: 20,
  select: { id: true, title: true, slug: true, publishedAt: true },
});
```

큰 `skip`은 DB가 앞의 행들을 건너뛰는 비용을 없애 주지 않는다. 정렬 순서에 맞는 인덱스가 있어도 앞의 인덱스 항목을 지나가야 할 수 있다. 또한 페이지 번호는 행의 위치를 가리킨다. 첫 페이지를 읽은 뒤 더 최신인 글이 앞에 들어오면 기존 행들의 위치가 한 칸씩 밀리므로 두 번째 요청의 `skip=20`은 다른 경계가 된다.

번호 기반 페이지가 언제나 나쁜 것은 아니다. 작은 운영용 목록에서 “37페이지로 이동”하는 기능은 단순하고 유용하다. 전체 개수를 보여 주는 요구도 자연스럽다. 하지만 공개 게시글 피드는 새 글이 앞에 추가되고 독자는 다음 묶음을 계속 읽는다. 이 경우에는 위치보다 **마지막으로 본 정렬 키 뒤에서 이어 읽기**가 제품의 사용 방식에 맞는다.

## 같은 시각의 글도 순서가 있어야 한다

정렬은 `publishedAt DESC, id DESC`로 고정한다. 발행 시각만 정렬하면 같은 밀리초에 발행된 글의 순서는 정해지지 않는다. 마지막 시각보다 작은 행만 다음 페이지로 읽을 경우 같은 시각에 남은 글을 건너뛴다. 따라서 유일한 ID를 두 번째 기준으로 넣는다.

커서가 `(t, i)`라면 다음 행은 발행 시각이 `t`보다 과거이거나, 시각은 같고 ID가 `i`보다 작은 행이다. PostgreSQL에서는 이 사전식 비교를 `("publishedAt", "id") < (t, i)`로 표현할 수 있다. 내림차순으로 읽기 때문에 다음 페이지의 비교 연산이 `<`라는 점을 기억하자. 정렬을 오름차순으로 바꾸면서 비교만 그대로 두면 페이지 방향이 뒤집힌다.

10장에서 시각 열을 `Timestamptz(3)`로 정한 이유가 여기서 드러난다. DB에 마이크로초를 보관하면서 커서에 밀리초만 담으면 같은 정렬 키를 되살릴 수 없다. 이 모델의 정밀도는 자바스크립트 `Date`와 맞으며 커서에는 정규화한 UTC ISO 문자열을 넣는다. 11장의 정책에 따라 첫 발행 후 `publishedAt`은 바꾸지 않는다. 정렬 키가 편집할 때마다 바뀌면 페이지를 건너다니는 행을 막기 어렵다.

커서는 조회 조건이지 접근 권한이 아니다. 누군가 임의의 과거 시각을 넣어도 `status='published'` 조건은 바뀌지 않아야 한다. 이 장에서는 공개 게시글 전체가 같은 조회 범위라 서명을 붙이지 않는다. 작성자 전용 목록이나 구독 권한별 범위가 생기면 필터를 서버가 강제하고, 커서 버전과 필터의 결합 정책도 함께 정한다. 커서가 복잡하게 인코딩되어 있다는 사실을 보안 기능으로 설명하지 않는다.

## 정렬 순서를 인덱스로 만들기

`prisma/schema.prisma`의 `Post` 모델 안에 다음 한 줄을 추가한다. 기존 필드나 11장의 `publication` 관계를 제거하지 않는 **인덱스 추가 부분**이다.

```prisma
@@index([status, publishedAt(sort: Desc), id(sort: Desc)], map: "Post_feed_idx")
```

```bash
pnpm exec prisma migrate dev --name add_post_feed_index
pnpm exec prisma generate
```

동등 조건인 `status`가 앞에 오고 뒤에 정렬 키가 온다. 이 인덱스의 목적은 공개 상태의 행을 정해진 순서로 찾아 작은 묶음만 읽는 것이다. `content`까지 인덱스에 넣어 모든 읽기를 해결하려고 하지 않는다. 큰 인덱스는 저장 공간뿐 아니라 초안 저장과 발행 때의 쓰기 비용, 캐시 압박을 늘린다.

실서비스의 큰 테이블에서는 인덱스 생성 방식과 잠금 영향도 검토해야 한다. 위 명령은 개발 DB의 절차다. 개발 마이그레이션이 빠르게 끝났다는 이유로 운영 환경에서도 같은 잠금 비용이라고 일반화하지 않는다. 부분 인덱스로 발행된 행만 포함하거나 일부 표시 열을 포함하는 설계도 가능하지만, 우선은 스키마에서 관리할 수 있는 이 인덱스 하나로 관측한다.

Prisma의 조건 객체로 시각 비교와 ID 비교를 `OR`로 표현해도 논리적으로는 맞는다. 다만 PostgreSQL이 선택한 계획에 따라 이 조건이 인덱스의 시작 위치가 아니라 필터로 처리되어 많은 항목을 버릴 수 있다. 본문 최종 구현에서는 명시적인 행 값 비교를 사용한다. 성능을 추측해 문자열 SQL을 조립하는 것이 아니라, 고정된 정렬·필터를 Prisma의 매개변수화된 SQL로 표현한다.

## 완전한 목록 조회 서비스

다음은 `src/posts/post-feed.ts`의 완전한 파일이다. 입력의 `limit`과 `cursor`는 HTTP 쿼리에서 가져온 미확인 값이다. 배열이나 숫자 객체를 문자열처럼 취급하지 않는다. 정상 입력을 확인한 뒤 한 번만 DB에 접근한다. `InvalidPageQuery`는 `BadRequestException`을 상속해 기존 HTTP writer가 400으로 변환한다. `invalid_limit`과 `invalid_cursor`는 내부 진단용 코드다.

```ts
import { Buffer } from 'node:buffer';
import { BadRequestException } from '@fluojs/http';
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { Prisma, type PrismaClient } from '@prisma/client';

type FeedRow = {
  id: number;
  title: string;
  slug: string;
  publishedAt: Date;
};

export type PostCard = Omit<FeedRow, 'publishedAt'> & { publishedAt: string };
export type PostPage = { items: PostCard[]; nextCursor: string | null };
export type PageQuery = { limit?: unknown; cursor?: unknown };
type Cursor = { publishedAt: Date; id: number };

export class InvalidPageQuery extends BadRequestException {
  constructor(readonly code: 'invalid_limit' | 'invalid_cursor') {
    super(code);
    this.name = 'InvalidPageQuery';
  }
}

function readLimit(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new InvalidPageQuery('invalid_limit');
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new InvalidPageQuery('invalid_limit');
  }
  return limit;
}

function readCursor(value: unknown): Cursor | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 256
    || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidPageQuery('invalid_cursor');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) {
    throw new InvalidPageQuery('invalid_cursor');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new InvalidPageQuery('invalid_cursor');
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)
    || !('v' in decoded) || decoded.v !== 1
    || !('id' in decoded) || typeof decoded.id !== 'number'
    || !Number.isSafeInteger(decoded.id) || decoded.id < 1 || decoded.id > 2147483647
    || !('publishedAt' in decoded) || typeof decoded.publishedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(decoded.publishedAt)
    || decoded.publishedAt.startsWith('0000-')) {
    throw new InvalidPageQuery('invalid_cursor');
  }
  const at = new Date(decoded.publishedAt);
  if (!Number.isFinite(at.getTime()) || at.toISOString() !== decoded.publishedAt) {
    throw new InvalidPageQuery('invalid_cursor');
  }
  return { publishedAt: at, id: decoded.id };
}

@Inject(PrismaService)
export class PostFeed {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async list(query: PageQuery = {}): Promise<PostPage> {
    const limit = readLimit(query.limit);
    const cursor = readCursor(query.cursor);
    const boundary = cursor
      ? Prisma.sql`AND ("publishedAt", "id") <
          (${cursor.publishedAt}::timestamptz, ${cursor.id}::integer)`
      : Prisma.empty;
    const rows = await this.prisma.current().$queryRaw<FeedRow[]>(Prisma.sql`
      SELECT "id", "title", "slug", "publishedAt"
      FROM "Post"
      WHERE "status" = 'published'::"PostStatus"
        AND "publishedAt" IS NOT NULL
        ${boundary}
      ORDER BY "publishedAt" DESC, "id" DESC
      LIMIT ${limit + 1}
    `);
    const items = rows.slice(0, limit).map((row): PostCard => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      publishedAt: row.publishedAt.toISOString(),
    }));
    const last = items.at(-1);
    const nextCursor = rows.length > limit && last
      ? Buffer.from(JSON.stringify({
        v: 1,
        publishedAt: last.publishedAt,
        id: last.id,
      })).toString('base64url')
      : null;
    return { items, nextCursor };
  }
}
```

`limit + 1`개를 읽는 것은 전체 개수를 세지 않고 다음 페이지의 존재를 판별하기 위해서다. 반환에는 처음 `limit`개만 포함한다. 커서는 추가로 읽은 마지막 행이 아니라 **실제로 반환한 마지막 행**에서 만든다. 추가 행으로 만들면 그 행을 다음 페이지에서 건너뛰게 된다.

커서의 `v`는 향후 인코딩 계약을 바꿀 수 있도록 둔 버전이다. 디코딩은 Base64 문법뿐 아니라 JSON 구조, DB 정수 범위, 날짜의 정규 형식까지 확인한다. 잘못된 커서를 “첫 페이지 요청”으로 해석하면 이용자는 같은 글을 반복해서 보면서도 오류를 알 수 없으므로 명백히 실패시킨다. 원래의 행이 삭제되어도 커서 안에 경계 값이 모두 있으므로 계속 조회할 수 있다.

`$queryRaw<FeedRow[]>`의 타입 인수는 SQL 결과를 실행 시 검증해 주지 않는다. 이 예제에서는 고정된 SELECT와 애플리케이션이 관리하는 스키마가 타입 근거다. 날짜가 없을 수 있는 행은 SQL 조건에서 제외하고 DB의 발행 모양 제약도 유지한다. 쿼리 열을 수정하면 이 타입과 응답 변환도 같이 바꾸어야 한다. DB 타입을 모르는데 원하는 타입을 붙여 오류를 감추는 방법으로 사용하지 않는다.

값은 `Prisma.sql`의 치환 위치에 매개변수로 전달한다. 사용자 입력을 SQL 문자열에 연결하지 않으며 `ORDER BY`의 열 이름도 외부 입력에서 가져오지 않는다. 모델 delegate 대신 SQL을 썼다고 Fluo 트랜잭션 컨텍스트를 버린 것도 아니다. 실제 실행은 여전히 주입받은 `PrismaService.current()`를 통한다.

## 기존 모듈과 목록 계약에 연결하기

새 DB나 새로운 전역 등록은 필요하지 않다. 10장의 `BlogDatabaseModule`이 제공하는 `PrismaService`를 그대로 쓰고, 11장의 발행 서비스도 유지한다. 아래는 `src/posts/posts.module.ts`의 합성 부분이다.

```ts
import { Module } from '@fluojs/core';
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
  controllers: [PostsController],
  providers: [
    PostsService, PostsRepository, PostLinks, PostIdConverter, SerializerInterceptor,
    PostPublicationsRepository, PublishingService, PostFeed,
  ],
  exports: [PostsService, PostsRepository, PublishingService, PostFeed],
})
export class PostsModule {}
```

다음 **`src/posts/post-page.ts` 전체**가 쿼리 바인딩과 명시적인 응답 스키마를 연결한다.

```ts
import { FromQuery, Optional } from '@fluojs/http';
import type { OpenApiSchemaObject } from '@fluojs/openapi';
import { postSummarySchema } from './post-api.schemas.js';

export class ListPostsDto {
  @FromQuery('limit') @Optional() limit: unknown = undefined;
  @FromQuery('cursor') @Optional() cursor: unknown = undefined;
}

export const postPageSchema: OpenApiSchemaObject = {
  type: 'object', additionalProperties: false,
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: postSummarySchema },
    nextCursor: { type: ['string', 'null'] },
  },
};
```

**`src/posts/posts.controller.ts` 전체**를 아래로 교체한다. 목록만 새 페이지 응답으로 바꾸며 11장의 발행 인수와 비동기 오류 매핑도 유지한다. 7~8장의 HTTP 스크립트에서 목록 배열을 읽는 부분은 `body.items`로 바꾸고, 8장의 문서 테스트는 목록 200 스키마의 `items`와 `nextCursor`를 검사한다.

```ts
import { Inject } from '@fluojs/core';
import {
  Controller, Get, HttpCode, Post, Put, RequestDto, UseInterceptors,
} from '@fluojs/http';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTag } from '@fluojs/openapi';
import { SerializerInterceptor } from '@fluojs/serialization';
import {
  errorResponseSchema, postIdParameterSchema,
  postWriteReceiptSchema, publicPostSchema,
} from './post-api.schemas.js';
import { runPostCommand } from './post-http-error.js';
import { CreatePostDto, GetPostDto, PublishPostDto, ReplacePostDto } from './post-request.dto.js';
import { toPostWriteReceipt, toPublicPost } from './post-response.dto.js';
import { PostsService } from './posts.service.js';
import { PostFeed } from './post-feed.js';
import { ListPostsDto, postPageSchema } from './post-page.js';

@ApiTag('Posts')
@Controller('/posts')
@Inject(PostsService, PostFeed)
@UseInterceptors(SerializerInterceptor)
export class PostsController {
  constructor(private readonly posts: PostsService, private readonly feed: PostFeed) {}

  @Get()
  @RequestDto(ListPostsDto)
  @ApiOperation({ summary: 'List published posts' })
  @ApiResponse(200, {
    description: 'Published post summaries.',
    schema: postPageSchema,
  })
  list(input: ListPostsDto) {
    return this.feed.list({ limit: input.limit, cursor: input.cursor });
  }

  @Get('/:id')
  @RequestDto(GetPostDto)
  @ApiOperation({ summary: 'Read one published post' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiResponse(200, { description: 'Published post.', schema: publicPostSchema })
  @ApiResponse(404, { description: 'Missing or unpublished post.', schema: errorResponseSchema })
  get(input: GetPostDto) {
    return runPostCommand(async () => toPublicPost(await this.posts.getPublished(input.id)));
  }

  @Post()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  @ApiOperation({ summary: 'Create a draft for the local operator' })
  @ApiBody({ description: 'All three strings are required; empty draft text is allowed.' })
  @ApiResponse(201, { description: 'Draft created.', schema: postWriteReceiptSchema })
  create(input: CreatePostDto) {
    return runPostCommand(async () => toPostWriteReceipt(await this.posts.create('author-1', {
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
    return runPostCommand(async () => toPostWriteReceipt(
      await this.posts.revise(input.id, input.expectedVersion, {
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
    return runPostCommand(async () => toPostWriteReceipt(
      await this.posts.publish(input.id, input.expectedVersion, 'author-1'),
    ));
  }
}
```

응답 계약은 배열 하나에서 `{ items, nextCursor }`로 바뀐다. 클라이언트는 `nextCursor`가 `null`이면 더 보기 동작을 멈추고, 값이 있으면 URL 쿼리 인코딩을 거쳐 다음 요청에 보낸다. API 문서에 최대 개수 100과 잘못된 커서의 400 응답을 명시한다. 정확한 전체 개수나 임의 페이지로 이동하는 기능은 제공하지 않는다. 그 요구를 추가한다면 `count`의 비용과 조회 사이 변화도 별도 계약으로 다룬다.

## 작은 데이터로 경계부터 검증하기

다음은 `test/post-feed.integration.test.ts`의 완전한 파일이다. 이 테스트만을 위한 빈 PostgreSQL DB에 10~12장의 마이그레이션을 적용하고 `DATABASE_URL_TEST`로 지정한다. 앞 장의 seed는 넣지 않는다. 이미 다른 게시글이 있으면 삭제하지 않고 실패시킨다. 테스트가 만드는 기록은 직접 발행된 fixture이며, 제품의 발행 동작 자체는 11장의 테스트가 검증한다.

```ts
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { PostFeed } from '../src/posts/post-feed.js';

it('pages through tied timestamps without depending on the cursor row', async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required');
  const client = new PrismaClient({ datasources: { db: { url } } });
  const prisma = new PrismaService(client, { strictTransactions: true });
  const ids: number[] = [];
  const at = new Date('2026-01-01T00:00:00.000Z');
  const prefix = `feed-${randomUUID()}`;
  try {
    await prisma.onModuleInit();
    if (await client.post.count() !== 0) {
      throw new Error('Use an empty database dedicated to the feed test');
    }
    async function published(suffix: string, publishedAt: Date) {
      const row = await client.post.create({
        data: {
          authorId: 'author-1',
          title: `Post ${suffix}`,
          content: 'Private storage field, not a list field.',
          slug: `${prefix}-${suffix}`,
          status: 'published',
          version: 2,
          publishedAt,
          publication: { create: { actorId: 'author-1', version: 2, publishedAt } },
        },
      });
      ids.push(row.id);
      return row;
    }
    const originals = [];
    for (let n = 0; n < 5; n += 1) originals.push(await published(String(n), at));
    const draft = await client.post.create({
      data: { authorId: 'author-1', title: 'Draft', content: '', slug: `${prefix}-draft` },
    });
    ids.push(draft.id);

    const feed = new PostFeed(prisma);
    const first = await feed.list({ limit: '2' });
    const expected = originals.map((row) => row.id).reverse();
    expect(first.items.map((row) => row.id)).toEqual(expected.slice(0, 2));
    expect(first.items[0]).not.toHaveProperty('content');
    const cursor = first.nextCursor;
    if (!cursor) throw new Error('Expected a next cursor');

    const pivot = first.items.at(-1);
    if (!pivot) throw new Error('Expected a cursor row');
    await client.postPublication.deleteMany({ where: { postId: pivot.id } });
    await client.post.delete({ where: { id: pivot.id } });
    await published('newer', new Date('2026-01-02T00:00:00.000Z'));

    const second = await feed.list({ limit: '2', cursor });
    expect(second.items.map((row) => row.id)).toEqual(expected.slice(2, 4));
    if (!second.nextCursor) throw new Error('Expected the final page cursor');
    const third = await feed.list({ limit: '2', cursor: second.nextCursor });
    expect(third.items.map((row) => row.id)).toEqual(expected.slice(4));
    expect(third.nextCursor).toBeNull();

    await expect(feed.list({ cursor: 'not-json' }))
      .rejects.toMatchObject({ code: 'invalid_cursor' });
    await expect(feed.list({ limit: '101' }))
      .rejects.toMatchObject({ code: 'invalid_limit' });
    await expect(feed.list({ limit: ['2', '3'] }))
      .rejects.toMatchObject({ code: 'invalid_limit' });
  } finally {
    try {
      if (ids.length > 0) {
        await client.postPublication.deleteMany({ where: { postId: { in: ids } } });
        await client.post.deleteMany({ where: { id: { in: ids } } });
      }
    } finally {
      await prisma.onApplicationShutdown();
    }
  }
});
```

```bash
pnpm exec vitest run test/post-feed.integration.test.ts
```

모든 원래 글에 같은 시각을 지정했으므로 ID 보조 정렬이 없으면 경계가 잘못된다. 첫 페이지의 커서 행을 삭제했으므로 그 행을 다시 찾아야만 이어갈 수 있는 구현도 드러난다. 두 번째 페이지 전에 최신 글을 추가했지만, 이미 읽기 시작한 과거 방향의 묶음에 그 글이 끼어들지는 않아야 한다. 이 세 조건은 기다리는 시간을 늘려 만드는 상황이 아니라 명시적인 데이터와 실행 순서로 만든다.

이 검증이 모든 페이지를 하나의 DB 스냅샷으로 만든다는 뜻은 아니다. 페이지 사이에서 삭제된 글은 다음 결과에서 사라질 수 있고, 과거 시각으로 새로 넣은 글은 나중 페이지에 나타날 수 있다. 공개 상태를 바꾸는 정책을 도입하면 그 영향도 있다. 긴 사용자 탐색 동안 트랜잭션을 열어 스냅샷을 붙잡지 않고, 정렬 키가 고정된 피드의 실용적인 연속 조회를 제공하는 것이다.

빈 DB에서는 `items=[]`, `nextCursor=null`이어야 한다. 정확히 두 개 있는 DB에서 `limit=2`로 읽으면 다음 커서가 없어야 하고, 세 개라면 있어야 한다. 잘못된 버전의 커서, 존재할 수 없는 날짜, 음수 ID, 지나치게 긴 토큰도 DB 조회 전에 실패해야 한다. 이 추가 경계들은 위 테스트의 fixture 수와 입력을 바꾸어 확인할 수 있다. 집필 과정에서 이 DB 통합 테스트를 실행한 것으로 보고하지 않는다.

## 실제 실행 계획으로 읽은 양을 비교하기

정확한 페이지가 나온 다음에 비용을 측정한다. 다음 SQL은 위 작은 테스트와 **다른 로컬 성능 실험용 DB**에 10만 개의 발행 글과 일치하는 발행 기록을 넣는 전체 fixture다. 반복 문자열은 압축이 잘되므로 운영 데이터의 디스크 크기를 재현한다고 해석하지 않는다. 한 번만 실행하며 같은 slug로 다시 실행하면 실패한다.

```sql
BEGIN;
WITH inserted AS (
  INSERT INTO "Post"
    ("authorId", "title", "content", "slug", "status", "version", "publishedAt")
  SELECT
    'author-1',
    'Query lab ' || n,
    repeat('Example body. ', 400),
    'query-lab-' || n,
    'published'::"PostStatus",
    2,
    timestamptz '2026-01-01 00:00:00+00' + n * interval '1 millisecond'
  FROM generate_series(1, 100000) AS n
  RETURNING "id", "authorId", "version", "publishedAt"
)
INSERT INTO "PostPublication" ("postId", "actorId", "version", "publishedAt")
SELECT "id", "authorId", "version", "publishedAt" FROM inserted;
COMMIT;

ANALYZE "Post";
```

다음은 PostgreSQL의 `psql`에서 실행할 비교 스크립트다. `\gset`은 결과를 `psql` 변수에 저장하는 명령이며 애플리케이션 SQL이 아니다. 비교할 커서를 얻기 위한 `OFFSET 89999`는 측정 준비에만 사용한다. 실제 커서 API가 매 요청마다 이 쿼리를 실행한다면 오프셋의 비용을 없앤 것이 아니다.

```psql
\set ON_ERROR_STOP on

SELECT "publishedAt" AS boundary_time, "id" AS boundary_id
FROM "Post"
WHERE "status" = 'published'
ORDER BY "publishedAt" DESC, "id" DESC
OFFSET 89999 LIMIT 1
\gset

EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "title", "slug", "publishedAt"
FROM "Post"
WHERE "status" = 'published'
ORDER BY "publishedAt" DESC, "id" DESC
OFFSET 90000 LIMIT 21;

EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "title", "slug", "publishedAt"
FROM "Post"
WHERE "status" = 'published'
  AND "publishedAt" IS NOT NULL
  AND ("publishedAt", "id") <
    (:'boundary_time'::timestamptz, :boundary_id::integer)
ORDER BY "publishedAt" DESC, "id" DESC
LIMIT 21;
```

관측할 것은 최종 시간 한 숫자만이 아니다. 오프셋 쿼리 아래쪽 노드가 읽는 행 수, 커서 비교가 `Index Cond`에 들어갔는지, 버린 행 수, 별도 정렬 유무, 공유 버퍼 접근을 함께 본다. 작은 테이블에서는 순차 스캔이 더 싼 계획일 수 있으므로 인덱스 스캔이 없다는 사실만으로 실패라고 단정하지 않는다. 데이터 분포와 통계가 바뀌면 계획도 달라진다.

두 쿼리를 같은 조건에서 반복하되 첫 실행과 이후 실행을 구분해 기록한다. 워밍된 캐시의 두 번째 쿼리만 골라 “몇 배 빨라졌다”고 쓰지 않는다. `EXPLAIN ANALYZE` 자체가 쿼리를 실행한다는 점도 이해해야 한다. 이 스크립트의 측정 대상은 SELECT지만, 쓰기 쿼리에 같은 습관을 적용하면 실제 데이터가 바뀐다.

이 장에는 실행하지 않은 밀리초 수치나 통과 로그를 넣지 않는다. 기대하는 구조적 결과는 깊은 오프셋의 앞부분 순회가 커서의 인덱스 경계 탐색으로 바뀌는 것이다. 실제 계획에서 여전히 대량 필터링이 보이면 상태 조건, 인덱스 열 순서, 타입 변환 위치와 통계를 먼저 확인한다. 마지막 응답 시간이 요구 수준에 맞는지는 독자의 DB와 데이터로 판단해야 한다.

## 쿼리 수가 목록 길이에 따라 늘어나지 않게 하기

현재 목록은 한 SQL로 끝난다. 나중에 운영용 카드에 발행 버전을 붙이고 싶다고 각 카드마다 `postPublication.findUnique()`를 호출하면, 목록 한 번에 최초 조회 하나와 카드 수만큼의 추가 조회가 발생한다. 이른바 N+1 문제다. 병렬로 실행해도 쿼리 개수와 연결 경쟁은 남는다.

아래는 이미 가져온 최대 100개 ID에 대해 발행 버전을 한 번에 읽는 **완전한 보조 함수**다. 운영 화면을 추가할 때 사용할 수 있는 애플리케이션 조각이며, 지금의 공개 `PostFeed` 응답에 내부 버전을 추가하지 않는다. `src/posts/publication-versions.ts`에 둘 수 있다.

```ts
import type { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

export async function publicationVersions(
  prisma: PrismaService<PrismaClient>,
  postIds: readonly number[],
): Promise<Map<number, number>> {
  if (postIds.length === 0) return new Map();
  const rows = await prisma.current().postPublication.findMany({
    where: { postId: { in: [...postIds] } },
    select: { postId: true, version: true },
  });
  return new Map(rows.map((row) => [row.postId, row.version]));
}
```

이 함수는 제한된 한 페이지의 ID를 받는 내부 계약이다. 임의의 큰 외부 배열을 그대로 받는 엔드포인트로 만들지 않는다. `IN` 조회가 원래 카드 순서를 보장하지 않으므로 결과를 Map으로 만들고 기존 카드 순서에 맞춰 결합한다. 두 조회 사이의 변경까지 하나의 스냅샷으로 보여 줘야 하는 운영 보고서라면 별도의 읽기 트랜잭션을 검토한다. 공개 피드의 단순 카드에 그런 비용을 자동으로 부과하지 않는다.

더 많은 관계 데이터를 넣는다고 항상 한 번의 거대한 JOIN이 최선인 것도 아니다. 관계의 개수와 중복 행, 선택 열의 크기를 함께 봐야 한다. 중요한 것은 화면 요구에 맞는 제한된 데이터 집합을 읽고, 페이지 크기가 커질 때 쿼리 수가 어떻게 바뀌는지 설명할 수 있는 설계다.

## 다음 요구는 행의 수보다 사람의 수다

목록에는 이제 상한과 이어 읽기 경계가 있고, 그 경계를 뒷받침하는 인덱스와 확인 절차가 있다. 더 큰 서버나 캐시를 도입하기 전에 무엇을 읽고 왜 읽는지 설명할 수 있게 되었다. 모든 데이터 규모에서 같은 지연 시간을 보장한 것은 아니지만, 글의 앞부분을 매번 다시 건너뛰는 구조는 제거했다.

다음 장부터는 작성자가 운영자 한 명이라는 가정을 걷어 낸다. 이미 저장한 `authorId`를 계정에 연결하고, 같은 블로그의 독자와 작성자를 모델링한다. 이때도 공개 목록에 비밀번호나 토큰 원문이 섞이지 않도록 이번 장의 선택 열과 응답 경계를 유지한다. 나중에 이 블로그가 굿즈 상점을 열더라도 게시글과 계정의 식별자를 다시 만드는 대신 이 기반을 확장한다.

## 근거가 되는 구현과 계약

- [Prisma 등록, 트랜잭션 인식 조회, 수동 경계 계약](../../packages/prisma/README.ko.md)
- [공개 export](../../packages/prisma/src/index.ts)와 [호환 클라이언트 범위](../../packages/prisma/package.json)
- [`current()`와 원시 조회 메서드 전달 구현](../../packages/prisma/src/service.ts)
- [주입 가능한 서비스·클라이언트 타입](../../packages/prisma/src/types.ts)
- [현재 컨텍스트로 최상위 클라이언트 메서드를 전달하는 테스트](../../packages/prisma/src/transaction-decorator.red.test.ts)
- [같은 등록을 형제 기능 모듈에서 사용하는 테스트](../../packages/prisma/src/module-global-visibility.test.ts)
- [저장소와 서비스 호출의 연결 근거](../../packages/prisma/src/vertical-slice.test.ts)

[이전: 글 발행을 하나의 작업으로 보장하기](./ch11-publishing-transactions.ko.md) · [1권 목차](./toc.ko.md) · [다음: 사용자와 자격 증명 모델링하기](./ch13-accounts-and-credentials.ko.md)
