# Keeping the List Fast as Posts Accumulate

<!-- book:volume=01-fluoblog;chapter=12 -->

[Previous: Making Post Publication a Single Operation](./ch11-publishing-transactions.md) - [Volume 1 Contents](./toc.md) - [Next: Modeling Users and Credentials](./ch13-accounts-and-credentials.md)

## The First Page Is Fast, but the Next Is Different

As FluoBlog gains more posts, readers want to see posts older than the first 20. The operator accepts a page number and applies `skip` and `take`. At first, it works well. But responses become slower deeper into the list, and if a new post is published before the reader clicks the next page, the last post from the previous page sometimes appears again.

Chapter 10's list query returned only the first 20 published posts. Excluding the content and limiting the count was a good start, but it did not establish a contract for reading subsequent pages. In this chapter, we design together a cursor that describes how far the reader has progressed, two fields that determine order, and an index that lets us navigate in that order. We do not begin by adding a cache server. Temporarily hiding the same expensive query and reducing how much data the query reads are different solutions.

Correctness is part of performance too. A query that exposes a draft or misses posts in 15 milliseconds is not a success. First decide which rows belong in the list, which columns to expose, how many rows to fetch at once, and what changes are allowed between pages. Then use actual PostgreSQL execution plans to check the chosen index and read costs.

## A List Is Not an API for Copying Entire Posts

The reader-facing list needs only `id`, `title`, `slug`, and `publishedAt`. Read the long `content` through the `/posts/:id` detail endpoint, and leave author identifiers and the publication operation's internal version out of public cards. Smaller responses also reduce serialization and network costs. But if you read every column from the database and then remove fields in JavaScript, the earlier cost has already been paid.

The following is a **query excerpt for comparison**, showing a page number added to the existing `PostsRepository.listPublished()`. It assumes that `prisma` is the registered `PrismaService<PrismaClient>` and that `page` is a validated positive integer. It is not the final implementation of the list we are building.

```ts
const rows = await prisma.current().post.findMany({
  where: { status: 'published' },
  orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
  skip: (page - 1) * 20,
  take: 20,
  select: { id: true, title: true, slug: true, publishedAt: true },
});
```

A large `skip` does not eliminate the database's cost of skipping earlier rows. Even with an index matching the sort order, the database may have to pass over the preceding index entries. A page number also points to row positions. If a newer post is inserted at the front after the first page is read, existing rows shift by one position, and `skip=20` in the second request becomes a different boundary.

Numbered pages are not always a bad choice. In a small operational list, a "go to page 37" feature is simple and useful. Showing the total count is also a natural requirement. But in a public posts feed, new posts are added at the front and readers continue through the next batch. Here, **continuing after the last sort key seen**, rather than from a position, matches how people use the product.

## Posts with the Same Timestamp Still Need an Order

Fix the ordering at `publishedAt DESC, id DESC`. Sorting only by publication time leaves the order of posts published in the same millisecond undefined. If the next page reads only rows earlier than the last timestamp, it skips remaining posts with that same timestamp. We therefore add the unique ID as a second criterion.

For a cursor `(t, i)`, the next row is one with a publication time earlier than `t`, or the same time and an ID smaller than `i`. PostgreSQL can express this lexicographic comparison as `("publishedAt", "id") < (t, i)`. Remember that the next-page comparison uses `<` because we are reading in descending order. Changing to ascending order while leaving the comparison unchanged reverses the paging direction.

This is where Chapter 10's choice of `Timestamptz(3)` for the timestamp column matters. If the database stores microseconds but the cursor contains only milliseconds, the same sort key cannot be reconstructed. This model's precision matches JavaScript `Date`, and the cursor contains a normalized UTC ISO string. Following Chapter 11's policy, `publishedAt` does not change after first publication. If a sort key changes on every edit, it is difficult to stop rows from moving between pages.

A cursor is a query condition, not access permission. Even if someone supplies an arbitrary past timestamp, the `status='published'` condition must not change. We do not sign cursors in this chapter because all public posts share the same query scope. If author-only lists or subscription-specific scopes are introduced, the server must enforce filters, and the policy for coupling cursor versions with filters must be defined as well. Do not present a cursor's complicated encoding as a security feature.

## Turning the Sort Order into an Index

Add the following line inside the `Post` model in `prisma/schema.prisma`. This is an **index addition** that does not remove existing fields or Chapter 11's `publication` relation.

```prisma
@@index([status, publishedAt(sort: Desc), id(sort: Desc)], map: "Post_feed_idx")
```

```bash
pnpm exec prisma migrate dev --name add_post_feed_index
pnpm exec prisma generate
```

The equality condition, `status`, comes first, followed by the sort keys. This index is intended to find public rows in the defined order and read only a small batch. Do not try to solve every read by including `content` in the index. A large index increases not only storage space but also the write cost of saving drafts and publishing, as well as pressure on the cache.

On a large production table, you must also examine how the index is created and its locking impact. The commands above are a development database procedure. A development migration finishing quickly does not mean that production will have the same locking cost. Designs using a partial index for only published rows or including some display columns are possible, but start by observing this one index that can be managed in the schema.

Expressing the timestamp and ID comparisons with `OR` in a Prisma condition object is logically correct too. However, depending on PostgreSQL's chosen plan, the condition may be applied as a filter rather than the index starting position, discarding many entries. The final implementation in this chapter uses an explicit row-value comparison. We are not assembling SQL strings based on guessed performance; we are expressing a fixed sort order and filter through Prisma's parameterized SQL.

## A Complete List Query Service

The following is the complete `src/posts/post-feed.ts` file. The input's `limit` and `cursor` are unverified values from the HTTP query. Do not treat arrays or number objects as strings. After validating the inputs, access the database only once. `InvalidPageQuery` extends `BadRequestException`, allowing the existing HTTP writer to map it to 400. `invalid_limit` and `invalid_cursor` are internal diagnostic codes.

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

Reading `limit + 1` rows tells us whether another page exists without counting the entire result set. Return only the first `limit` rows. Build the cursor from **the last row actually returned**, not the extra row fetched. Using the extra row would cause it to be skipped on the next page.

The cursor's `v` is a version that allows the encoding contract to change in the future. Decoding checks not just Base64 syntax but also the JSON structure, database integer range, and canonical date format. Treating an invalid cursor as a first-page request would make users see the same posts repeatedly without knowing there was an error, so fail explicitly. Even if the original row is deleted, the cursor contains all the boundary values needed to continue reading.

The type argument to `$queryRaw<FeedRow[]>` does not validate SQL results at runtime. In this example, the fixed SELECT and the application-managed schema provide the basis for the type. The SQL condition excludes rows that might lack a date, and the database's publication-shape constraint remains in place. If the query columns change, change this type and the response conversion together. Do not use a desired type to hide errors when the database types are unknown.

Values are passed as parameters at the interpolation positions in `Prisma.sql`. User input is not concatenated into SQL strings, and `ORDER BY` column names do not come from external input either. Using SQL instead of a model delegate does not abandon Fluo's transaction context. Actual execution still goes through the injected `PrismaService.current()`.

## Connecting to the Existing Module and List Contract

No new database or new global registration is needed. Continue using the `PrismaService` provided by Chapter 10's `BlogDatabaseModule`, and retain Chapter 11's publication service. The following shows the composition in `src/posts/posts.module.ts`.

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

The following **complete `src/posts/post-page.ts` file** connects query binding to an explicit response schema.

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

Replace the **entire `src/posts/posts.controller.ts` file** with the following. Only the list changes to the new page response; Chapter 11's publication arguments and asynchronous error mapping are retained. In the HTTP scripts from Chapters 7-8, change the code reading the list array to read `body.items`. Update Chapter 8's documentation test to check `items` and `nextCursor` in the list's 200 response schema.

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

The response contract changes from a single array to `{ items, nextCursor }`. The client stops offering more results when `nextCursor` is `null`; when it has a value, the client URL-query-encodes it and sends it with the next request. State the maximum count of 100 and the 400 response for invalid cursors in the API documentation. The API does not provide an exact total count or navigation to an arbitrary page. If those requirements are added, treat the cost of `count` and changes between reads as separate contracts too.

## Verifying Boundaries with a Small Dataset First

The following is the complete `test/post-feed.integration.test.ts` file. Apply the migrations from Chapters 10-12 to an empty PostgreSQL database dedicated to this test, and point `DATABASE_URL_TEST` to it. Do not insert the earlier chapter's seed. If other posts already exist, fail without deleting them. The records created by this test are fixtures inserted directly as published posts; Chapter 11's tests verify the product's publication operation itself.

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

Every original post has the same timestamp, so the boundary is wrong without the secondary ID ordering. Deleting the first page's cursor row also exposes implementations that must find that row again to continue. A new latest post is added before the second page, but it must not slip into the batch already being read toward the past. These three conditions are created through explicit data and execution order, not by increasing a wait.

This verification does not make all pages one database snapshot. A post deleted between pages may disappear from a subsequent result, and a new post inserted with a past timestamp may appear on a later page. Introducing a policy that changes public status has effects as well. We are providing practical sequential reading of a feed with fixed sort keys, not holding a transaction open to preserve a snapshot throughout a user's long browsing session.

An empty database must return `items=[]` and `nextCursor=null`. With exactly two posts and `limit=2`, there must be no next cursor; with three posts, there must be one. A cursor with the wrong version, an impossible date, a negative ID, or an excessively long token must also fail before a database query. You can verify these additional boundaries by changing the fixture count and inputs in the test above. We do not report this database integration test as having been run during writing.

## Comparing Reads with Actual Execution Plans

Measure cost after the pages are correct. The following SQL is a complete fixture that inserts 100,000 published posts and matching publication records into a **different local database for performance experiments**, separate from the small test above. Repeated strings compress well, so do not interpret this as reproducing the disk size of production data. Run it once; running it again with the same slugs fails.

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

The following comparison script runs in PostgreSQL's `psql`. `\gset` is a command that stores results in `psql` variables, not application SQL. The `OFFSET 89999` used to obtain the comparison cursor is only measurement preparation. If the actual cursor API runs that query on every request, it has not eliminated the offset cost.

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

Do not observe only a single elapsed-time number. Examine the rows read by lower nodes in the offset query, whether the cursor comparison appears in `Index Cond`, the number of discarded rows, any separate sort, and shared buffer accesses. On small tables, a sequential scan may be cheaper, so the absence of an index scan alone does not establish failure. Plans change as data distribution and statistics change.

Repeat both queries under the same conditions, recording the first run separately from later runs. Do not pick only the second query with a warmed cache and claim it is several times faster. Also understand that `EXPLAIN ANALYZE` actually executes the query. This script measures SELECT statements, but applying the same habit to write queries changes real data.

This chapter includes no unmeasured millisecond figures or fabricated passing logs. The expected structural result is that traversing all the preceding rows of a deep offset is replaced by seeking to an index boundary with the cursor. If the actual plan still shows large-scale filtering, first check the status condition, index column order, placement of type conversions, and statistics. Whether the final response time meets your requirements must be judged using your database and data.

## Keeping Query Count from Growing with List Length

The current list uses one SQL statement. If you later want to add publication versions to operational cards and call `postPublication.findUnique()` for each card, one list request will perform the initial query plus one extra query per card. This is the N+1 problem. Running them in parallel does not remove the query count or connection contention.

The following is a **complete helper function** that reads publication versions in one query for up to 100 IDs already fetched. It is an application fragment you can use when adding an operational screen; it does not add internal versions to the current public `PostFeed` response. It can live in `src/posts/publication-versions.ts`.

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

This function has an internal contract of receiving IDs from one bounded page. Do not turn it into an endpoint that accepts an arbitrarily large external array unchanged. An `IN` query does not guarantee the original card order, so put the results in a Map and join them in the existing card order. If an operational report must show one snapshot even across changes between the two reads, consider a separate read transaction. Do not automatically impose that cost on simple public-feed cards.

Adding more related data does not always make one enormous JOIN the best choice. Consider relation cardinality, duplicate rows, and the size of selected columns together. What matters is a design that reads a bounded dataset matching the screen's needs and can explain how the number of queries changes as the page size grows.

## The Next Requirement Is About People, Not Rows

The list now has a cap and a boundary for continuing to read, along with an index and verification procedure that support that boundary. Before adding a larger server or cache, we can explain what we read and why. We have not guaranteed the same latency at every data scale, but we have removed the structure that repeatedly skips over the beginning of the posts list.

Starting in the next chapter, we remove the assumption that the operator is the only author. We connect the already-stored `authorId` to accounts and model readers and authors of the same blog. Keep this chapter's selected columns and response boundaries so raw passwords and tokens cannot enter the public list. Even when this blog later opens a merchandise shop, we will extend this foundation rather than recreate post and account identifiers.

## Supporting Implementations and Contracts

- [Prisma registration, transaction-aware queries, and manual boundary contracts](../../packages/prisma/README.md)
- [Public exports](../../packages/prisma/src/index.ts) and [compatible client range](../../packages/prisma/package.json)
- [`current()` and raw query method forwarding implementation](../../packages/prisma/src/service.ts)
- [Injectable service and client types](../../packages/prisma/src/types.ts)
- [Tests for forwarding top-level client methods to the current context](../../packages/prisma/src/transaction-decorator.red.test.ts)
- [Tests for using the same registration in sibling feature modules](../../packages/prisma/src/module-global-visibility.test.ts)
- [Evidence for connecting repository and service calls](../../packages/prisma/src/vertical-slice.test.ts)

[Previous: Making Post Publication a Single Operation](./ch11-publishing-transactions.md) - [Volume 1 Contents](./toc.md) - [Next: Modeling Users and Credentials](./ch13-accounts-and-credentials.md)
