# Moving Posts from Memory to the Database

<!-- book:volume=01-fluoblog;chapter=10 -->

[Previous: Running the Same Code in Different Environments](./ch09-configuration.md) - [Volume 1 Contents](./toc.md) - [Next: Making Post Publication a Single Operation](./ch11-publishing-transactions.md)

## The Save Button Succeeded, but the Post Disappeared

The operator writes a long draft in FluoBlog and saves it. The response reports success, and a subsequent read in the same process shows the content. The moment the server is restarted after a configuration change, the post disappears. The `Map` holding the posts lived in the process's memory. Running two processes at once makes things even stranger: a post saved to the first server does not appear in the second server's list.

Serializing to a file can solve part of the restart problem, but leaves you to handle competing writes, partial records, ID allocation, and query conditions yourself. What we need at this stage is not another data structure in place of an array. We need data that outlives the application and storage rules shared by multiple requests. This book uses PostgreSQL for storage and Prisma for schemas and queries. We do not introduce another ORM alongside it.

We use `AppSettings.databaseUrl` from the previous chapter to create the connection. The feature module remains `PostsModule`, and the source path is your `fluo-blog/src/posts/`. The models and migrations defined here belong to the application. Registering `@fluojs/prisma` does not create a posts table. The package's role is to connect the supplied Prisma Client's connection lifecycle and transaction context to Fluo.

## First Decide What to Preserve

Moving to persistence does not require changing what a post means. We store `id`, `authorId`, `title`, `content`, `slug`, `status`, `version`, and `publishedAt`. The `id` is an internal identifier, and `slug` is a proposed value for the public address at publication. Drafts allow empty and duplicate slugs; uniqueness is required only among published posts. The public HTTP route is still `/posts/:id`. A unique constraint on the slug does not automatically add a new route.

A draft has `status=draft` and no `publishedAt`. A published post has `status=published` and a publication time. `version` is an integer for detecting conflicting saves. It does not represent wall-clock time or an estimate of how much editing has taken place. Following Chapter 5, a new draft starts at `version=1`, and its first successful edit or publication makes it `version=2`. For now, editing a draft increments it once; in the next chapter, publication will participate in the same version rules.

A post's `id` is a positive integer, but `User.id` and the `authorId` that references it are strings. There is no reason to force the two identifiers into the same representation. Because accounts do not exist yet, the application supplies the operator identifier `'author-1'` in local writing experiments. This does not mean trusting an `authorId` sent by a client. Chapter 13 connects accounts to the existing string ID space, after which the author will be determined from the authenticated principal. Do not expose the writing calls at this stage externally as an unauthenticated operational API.

The schema does not replace every domain rule. Separate rules the storage layer should guarantee, such as the title's storage limit and uniqueness of published slugs, from rules the service must decide, such as whether a draft is ready to publish. Conversely, uniqueness must not be checked only in the service. Two requests can both read that a slug does not exist and then both create it, so the database's unique constraint must be the final authority.

## Pinning the Prisma Version Alongside the Schema

The generator and constructor examples in this chapter target **Prisma 6.19.0**. Install the `prisma` CLI and `@prisma/client` at the same version. This does not mean that Fluo supports only Prisma 6. The package's current peer range is `@prisma/client >=5.0.0`; the exercise pins a version to avoid mixing this example with generator or connection adapter settings that differ in other Prisma major versions. The runtime remains Node.js 24 with pnpm 10.

```bash
pnpm add @fluojs/prisma @prisma/client@6.19.0
pnpm add -D prisma@6.19.0
```

The following is the entire `prisma/schema.prisma` at this point. PostgreSQL timestamp precision is set to milliseconds so that we do not store microseconds that JavaScript `Date` cannot represent and then lose the boundary in later cursor queries. We store timestamps with time zones, leaving display formatting to the response layer.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PostStatus {
  draft
  published
}

model Post {
  id          Int        @id @default(autoincrement())
  authorId    String
  title       String     @db.VarChar(120)
  content     String     @db.Text
  slug        String     @db.VarChar(80)
  status      PostStatus @default(draft)
  version     Int        @default(1)
  publishedAt DateTime?  @db.Timestamptz(3)
}
```

You must first have a local-only PostgreSQL server and an empty practice database ready to connect to. We do not install a server or change production infrastructure here. The following commands are development steps for you to run after preparing that database, not quoted results of commands already executed.

```bash
pnpm exec prisma validate
pnpm exec prisma migrate dev --name create_posts --create-only
```

Append the following SQL to `prisma/migrations/<generated_directory>/migration.sql`, created by the second command. This block is a **migration addition** that does not replace the generated table definition. Use the actual directory name printed by the CLI.

```sql
ALTER TABLE "Post"
  ADD CONSTRAINT "Post_author_nonempty" CHECK (length("authorId") > 0),
  ADD CONSTRAINT "Post_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "Post_publication_shape" CHECK (
    ("status" = 'draft' AND "publishedAt" IS NULL)
    OR
    ("status" = 'published' AND "publishedAt" IS NOT NULL AND "version" >= 2)
  );

CREATE UNIQUE INDEX "Post_published_slug_key" ON "Post" ("slug")
WHERE "status" = 'published';
```

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

The partial unique index permits empty slugs and duplicate proposals in drafts, preventing conflicts only at publication. Do not add `@unique` back to the Prisma 6.19.0 schema; this index is managed through the SQL migration. Consequently, the slug cannot be used as a `findUnique` key. ID lookup stays the same, and if a public slug lookup is needed, use `findFirst({ where: { slug, status: 'published' } })`. PostgreSQL `varchar(n)` counts characters, so the UTF-16 code unit limits from Chapter 5 must still be checked in the domain and DTOs.

The generated client provides schema types, but does not express the meaning of custom `CHECK` constraints in those types. Review SQL migrations as part of the source as well. Changing only the schema file and regenerating the client does not change the database; changing only the database leaves the generated types out of date. Keep the distinct purposes of these two steps clear.

Prisma CLI environment loading and Fluo's `ConfigModule` loading are also separate. The CLI obtains this chapter's `DATABASE_URL` from its own environment or `.env`. Fluo's `runtimeOverrides` or merged `.env.local` result is not passed to the CLI. Before a development migration, verify that the CLI and the app point to the same practice database without exposing secrets. Deployment should have a separate procedure for applying reviewed migrations; do not run `migrate dev` every time the app starts.

## Giving the Connection a Single Owner

Creating `new PrismaClient()` on each request makes the number of connection pools grow with the number of requests. Blindly sharing a global variable outside a module, on the other hand, can let tests that bootstrap independent apps in one process close each other's connections. Let each application container own one client of its own.

The following is the complete `src/database/blog-database.module.ts` file. `AppSettings` from the previous chapter is an actual class token exported globally by `AppSettingsModule`. The factory passed to `forRootAsync` does not have to be an `async` function. We choose this registration path to receive configuration through DI and then create a client per container.

```ts
import { PrismaModule } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';
import { AppSettings } from '../config/app-settings.js';

export const BlogDatabaseModule = PrismaModule.forRootAsync({
  global: true,
  inject: [AppSettings],
  useFactory: (settings: unknown) => {
    if (!(settings instanceof AppSettings)) throw new Error('Expected AppSettings from DI.');
    return {
    client: new PrismaClient({
      datasources: { db: { url: settings.databaseUrl } },
    }),
      strictTransactions: true,
    };
  },
});
```

`global` is an outer registration option, not part of the factory's return value. Module visibility must be decided before the factory runs. An unnamed registration is not global by default, but we explicitly set `global: true` here because this is the application's single database. If multiple databases become necessary, use named registrations and `getPrismaServiceToken(name)`. Making a named registration global is rejected by the current contract.

We also explicitly set `strictTransactions: true`. A substitute client without transaction support must not silently turn a transaction into direct execution that merely looks transactional. This option does not strengthen database isolation levels or storage rules; it makes the boundary fail when transaction capability is absent.

Add `BlogDatabaseModule` to the existing `AppModule.imports` in `src/app.ts`. The composition is shown below. This does not mean removing existing HTTP-related options or providers.

```ts
import { Module } from '@fluojs/core';
import { AppSettingsModule } from './config/app-settings.module.js';
import { BlogDatabaseModule } from './database/blog-database.module.js';
import { PostsModule } from './posts/posts.module.js';

@Module({
  imports: [AppSettingsModule, BlogDatabaseModule, PostsModule],
})
export class AppModule {}
```

The `PrismaService` provided by `PrismaModule` calls `$connect()` during initialization and handles `$disconnect()` when the application shuts down. Do not disconnect on every request in services or controllers. Even a structurally valid connection string can fail on the initial connection; in that case, expose the initialization failure rather than accepting requests as though post storage were available. Forced process termination is not the same as normal execution of shutdown hooks, so we revisit the full shutdown guarantees in the later lifecycle chapter.

## Creating Only the Storage Operations Posts Need

The following is the complete `src/posts/posts.repository.ts` file. Instead of building a generic `Repository<T>`, we name the operations the product currently needs. `DraftInput` is not raw HTTP input: it is internal input whose string types and lengths were checked at the request boundary in the previous chapters. Slug format and nonempty title and content are checked at publication. `authorId` is filled from a trusted author context.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { normalizeText, type PublishedPost } from './post.js';

export type DraftInput = { authorId: string; title: string; content: string; slug: string };
export type DraftEdit = Pick<DraftInput, 'title' | 'content' | 'slug'>;

@Inject(PrismaService)
export class PostsRepository {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  createDraft(input: DraftInput) {
    return this.prisma.current().post.create({
      data: {
        ...normalizeText(input), authorId: input.authorId,
        status: 'draft', version: 1, publishedAt: null,
      },
    });
  }

  async findById(id: number) {
    return this.prisma.current().post.findUnique({ where: { id } });
  }

  findPublishedById(id: number) {
    return this.prisma.current().post.findFirst({ where: { id, status: 'published' } });
  }

  listPublished() {
    return this.prisma.current().post.findMany({
      where: { status: 'published' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 20,
      select: { id: true, title: true, slug: true, publishedAt: true },
    });
  }

  async editDraft(id: number, expectedVersion: number, input: DraftEdit) {
    const result = await this.prisma.current().post.updateMany({
      where: { id, status: 'draft', version: expectedVersion },
      data: { ...normalizeText(input), version: { increment: 1 } },
    });
    return result.count === 1;
  }

  async publishDraft(post: PublishedPost, expectedVersion: number) {
    const result = await this.prisma.current().post.updateMany({
      where: { id: post.id, status: 'draft', version: expectedVersion },
      data: {
        status: 'published', version: { increment: 1 },
        publishedAt: new Date(post.publishedAt),
      },
    });
    return result.count === 1;
  }
}
```

Using `current()` on every call is not decoration for the next chapter. This function returns the client for the current transaction boundary when inside one, and the root client otherwise. Saving `const client = prisma.current()` in the constructor can capture the root client present at construction and bypass later transactions. Avoid caching model delegates in class fields as well as the client itself.

`findById` is an internal read for editing, while `findPublishedById` is a public read. Putting the public visibility condition into the storage operation itself leaves less room for error than fetching everything on a public route and filtering drafts only just before the response. Both return `null` when nothing is found. The existing API boundary converts this to HTTP 404; Prisma does not automatically generate the application's 404 response.

`editDraft` does not read first and then perform an unconditional `update`. It includes the ID, status, and version in a single update condition. If two requests edit the same version, only one changes the row and the other receives `false`. A single SQL update is itself atomic, so this does not require a separate interactive transaction. However, `false` alone cannot tell you whether the post is missing, already published, or has been edited by another request. If a detailed user message is needed, the service may perform another read, but it must not remove the conditions on the final write.

A repository may return internal rows, but an HTTP response is not a database row. Continue applying the response models from the previous chapter and convert `Date` to ISO strings at the boundary. Distinguish values needed by editing routes, such as `authorId`, `version`, and status, from those needed by the public list. The list does not select the content and fetches at most 20 rows. If you introduce a cap into a contract that previously returned all posts, update the API documentation and clients together. This chapter provides only the first page; Chapter 12 completes the contract for reading subsequent pages.

## Replacing the Synchronous Controller as Well

If you change only the constructor to use the repository, the synchronous calls from Chapter 8 will call `map` on a Promise. Replace the following files in the same step. In `src/posts/post.ts` from Chapter 5, expose the normalization function as `export function normalizeText(input: DraftText): DraftText` so the repository can use it, and add `current.version >= 2_147_483_647` as another OR condition in the integer range check in `requireDraft`. Keep the remaining creation, editing, and publication rules. In `src/posts/post-request.dto.ts` from Chapter 6, change the ID's `@Max(Number.MAX_SAFE_INTEGER)` to `@Max(2_147_483_647)`, and change the upper limit for both `expectedVersion` fields to `@Max(2_147_483_646)` so the next increment is possible. Keep `@Min(1)` and the UTF-16 string length checks.

The **complete `src/posts/post-row.ts` file** restores Prisma's Date values to the ISO string snapshots from Chapter 5.

```ts
import type { Post as PostRow } from '@prisma/client';
import type { PostSnapshot } from './post.js';

export function toPostSnapshot(row: PostRow): PostSnapshot {
  const base = {
    id: row.id, authorId: row.authorId, title: row.title,
    content: row.content, slug: row.slug, version: row.version,
  };
  if (row.status === 'draft' && row.publishedAt === null) {
    return Object.freeze({ ...base, status: 'draft', publishedAt: null });
  }
  if (row.status === 'published' && row.publishedAt !== null) {
    return Object.freeze({
      ...base, status: 'published', publishedAt: row.publishedAt.toISOString(),
    });
  }
  throw new Error('Stored post violates the publication shape.');
}
```

This is the **complete `src/posts/posts.service.ts` file**. It returns the exact candidate snapshot whose conditional update succeeded, rather than rereading a row that a later write has already changed and returning it as its own result. Publication in this chapter updates just one row. Chapter 11 moves it into a single transaction together with the record.

```ts
import { Inject } from '@fluojs/core';
import { Prisma } from '@prisma/client';
import {
  PostDomainError, publishPost, reviseDraft,
  type DraftText, type PostSnapshot, type PublishedPost,
} from './post.js';
import { PostsRepository } from './posts.repository.js';
import { toPostSnapshot } from './post-row.js';

export const POST_CLOCK = Symbol('POST_CLOCK');
export type PostClock = { now(): Date };

@Inject(PostsRepository, POST_CLOCK)
export class PostsService {
  constructor(private readonly posts: PostsRepository, private readonly clock: PostClock) {}

  async create(authorId: string, input: DraftText): Promise<PostSnapshot> {
    return toPostSnapshot(await this.posts.createDraft({ ...input, authorId }));
  }

  async get(id: number): Promise<PostSnapshot> {
    const row = await this.posts.findById(id);
    if (!row) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
    return toPostSnapshot(row);
  }

  async getPublished(id: number): Promise<PublishedPost> {
    const row = await this.posts.findPublishedById(id);
    if (!row) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
    const post = toPostSnapshot(row);
    if (post.status !== 'published') throw new Error('Expected a published post.');
    return post;
  }

  async listPublished() {
    return (await this.posts.listPublished()).map((row) => {
      if (row.publishedAt === null) throw new Error('Published post has no timestamp.');
      return { ...row, publishedAt: row.publishedAt.toISOString() };
    });
  }

  async revise(id: number, expectedVersion: number, input: DraftText): Promise<PostSnapshot> {
    const next = reviseDraft(await this.get(id), expectedVersion, input);
    if (!await this.posts.editDraft(id, expectedVersion, next)) {
      throw new PostDomainError('POST_VERSION_CONFLICT', 'Another change was saved first.');
    }
    return next;
  }

  async publish(id: number, expectedVersion: number): Promise<PublishedPost> {
    const next = publishPost(await this.get(id), expectedVersion, this.clock.now());
    try {
      if (!await this.posts.publishDraft(next, expectedVersion)) {
        throw new PostDomainError('POST_VERSION_CONFLICT', 'Another change was saved first.');
      }
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PostDomainError('POST_SLUG_CONFLICT', 'The public slug is already in use.');
      }
      throw error;
    }
    return next;
  }
}
```

This is the **complete `src/posts/post-http-error.ts` file**. It converts both synchronous exceptions and asynchronous rejections to the same HTTP codes.

```ts
import { HttpException } from '@fluojs/http';
import { PostDomainError, type PostErrorCode } from './post.js';

const statusByCode = {
  POST_NOT_FOUND: 404,
  POST_INVALID_TEXT: 400,
  POST_VERSION_CONFLICT: 409,
  POST_NOT_DRAFT: 409,
  POST_NOT_PUBLISHABLE: 400,
  POST_SLUG_CONFLICT: 409,
} satisfies Record<PostErrorCode, number>;

export async function runPostCommand<T>(action: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error: unknown) {
    if (error instanceof PostDomainError) {
      throw new HttpException(statusByCode[error.code], error.message, {
        code: error.code,
      });
    }
    throw error;
  }
}
```

This is the **complete `src/posts/post-response.dto.ts` file**. It retains the output fields and class allowlist, while the summary mapper requires only the four fields in the actual SELECT. Date conversion has already been completed at the stored-row boundary.

```ts
import { Expose } from '@fluojs/serialization';
import type { PostSnapshot, PublishedPost } from './post.js';

@Expose({ excludeExtraneous: true })
export class PostSummaryDto {
  @Expose()
  id = 0;

  @Expose()
  title = '';

  @Expose()
  slug = '';

  @Expose()
  publishedAt = '';
}

export class PublicPostDto extends PostSummaryDto {
  @Expose()
  content = '';
}

@Expose({ excludeExtraneous: true })
export class PostWriteReceiptDto {
  @Expose()
  id = 0;

  @Expose()
  status: 'draft' | 'published' = 'draft';

  @Expose()
  version = 0;

  @Expose()
  publishedAt: string | null = null;
}

export function toPostSummary(post: Pick<PublishedPost, 'id' | 'title' | 'slug' | 'publishedAt'>): PostSummaryDto {
  return Object.assign(new PostSummaryDto(), {
    id: post.id,
    title: post.title,
    slug: post.slug,
    publishedAt: post.publishedAt,
  });
}

export function toPublicPost(post: PublishedPost): PublicPostDto {
  return Object.assign(new PublicPostDto(), {
    id: post.id,
    title: post.title,
    slug: post.slug,
    publishedAt: post.publishedAt,
    content: post.content,
  });
}

export function toPostWriteReceipt(post: Pick<PostSnapshot, 'id' | 'status' | 'version' | 'publishedAt'>): PostWriteReceiptDto {
  return Object.assign(new PostWriteReceiptDto(), {
    id: post.id,
    status: post.status,
    version: post.version,
    publishedAt: post.publishedAt,
  });
}
```

The **complete `src/posts/posts.controller.ts` file** preserves Chapter 8's metadata while awaiting every asynchronous result. The three write routes before accounts are introduced remain local operator exercises; all are replaced with authenticated routes in Chapter 15.

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
  async list() {
    return (await this.posts.listPublished()).map(toPostSummary);
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
      await this.posts.publish(input.id, input.expectedVersion),
    ));
  }
}
```

In `src/posts/post-api.schemas.ts` from Chapter 8, also set the `maximum` for IDs and response versions to `2_147_483_647`. Keep the URL syntax, but state the PostgreSQL Int range in the parameter description. The normal JSON fields and the 400, 404, and 409 error codes do not change.

The following is the **complete `src/posts/posts.module.ts` file**. Do not omit the converter, serializer, or clock registrations.

```ts
import { Module } from '@fluojs/core';
import { SerializerInterceptor } from '@fluojs/serialization';
import { PostIdConverter } from './post-id.converter.js';
import { PostsController } from './posts.controller.js';
import { POST_CLOCK, PostsService, type PostClock } from './posts.service.js';
import { PostsRepository } from './posts.repository.js';
import { PostLinks } from './post-links.js';

@Module({
  controllers: [PostsController],
  providers: [
    PostsService, PostsRepository, PostLinks, PostIdConverter, SerializerInterceptor,
    { provide: POST_CLOCK, useValue: { now: () => new Date() } satisfies PostClock },
  ],
  exports: [PostsService, PostsRepository],
})
export class PostsModule {}
```

## The First Seed Is Not a Real Data Migration

Let us carry over the original HTTP exercise's `id=1`, `title=Hello, Fluo!`, and `content=My first post.` without losing them. The following seed SQL is inserted once into a new practice database. Run it in a PostgreSQL client; do not use it as a production data migration script. Because this is the same post already published in Chapter 5, preserve `status=published`, `version=2`, and the existing publication time, then verify it through a public read.

```sql
BEGIN;

INSERT INTO "Post"
  ("id", "authorId", "title", "content", "slug", "status", "version", "publishedAt")
VALUES
  (1, 'author-1', 'Hello, Fluo!', 'My first post.', 'hello-fluo', 'published', 2,
   timestamptz '2026-01-01 00:00:00+00');

SELECT setval(
  pg_get_serial_sequence('"Post"', 'id'),
  (SELECT MAX("id") FROM "Post"),
  true
);

COMMIT;
```

Because we inserted an explicit ID, we also adjusted the auto-increment sequence. Otherwise, the next generated ID might attempt `id=1` again. This seed deliberately fails on a unique constraint if run twice. A clear failure is better than a seed overwriting a post the operator has edited. For a bulk migration, pause writes, export the source, verify counts, IDs, duplicate slugs, and missing content, and then cut over. Do not hide the distinct responsibilities of a development seed and a real data migration behind a single `upsert`.

Remember that migration is possible only while the in-memory state can still be read. Introducing a database cannot restore drafts lost when a process was already terminated. Persistence provides preservation going forward; backup and restoration are separate operational capabilities. There is still a gap between storing data in a database and being able to recover from any failure.

## Proving That Data Survives a New Connection

The tests in `src/posts/post.test.ts` from Chapter 5 that directly constructed the in-memory `PostsService` cannot run unchanged after replacing the repository. The following **complete replacement file** tests pure domain transitions. The repository integration test immediately below covers two connection lifetimes and rejection of stale saves; Chapter 11's real database integration tests take over duplicate-slug publication and repeated requests. Keep Chapter 7's response mapper tests as they are.

```ts
import { describe, expect, it } from 'vitest';
import { createDraft, publishPost, reviseDraft } from './post.js';

const at = new Date('2026-06-01T09:00:00.000Z');
const text = { title: 'First review', content: 'We tested a restart.', slug: 'first-review' };

describe('Post transitions', () => {
  it('keeps an empty draft at version 1 after publication is rejected', () => {
    const draft = createDraft(2, 'author-1', { title: '', content: '', slug: '' });
    expect(() => publishPost(draft, 1, at)).toThrow(
      expect.objectContaining({ code: 'POST_NOT_PUBLISHABLE' }),
    );
    expect(draft).toMatchObject({ status: 'draft', version: 1, publishedAt: null });
  });

  it('revises a draft once and rejects its stale version', () => {
    const draft = createDraft(2, 'author-1', text);
    const edited = reviseDraft(draft, 1, { ...text, title: 'Saved first' });
    expect(edited).toMatchObject({ title: 'Saved first', version: 2 });
    expect(() => reviseDraft(edited, 1, text)).toThrow(
      expect.objectContaining({ code: 'POST_VERSION_CONFLICT' }),
    );
    expect(draft.version).toBe(1);
  });

  it('does not change the publication time or version on repetition or editing', () => {
    const published = publishPost(createDraft(2, 'author-1', text), 1, at);
    expect(published).toMatchObject({ status: 'published', version: 2, publishedAt: at.toISOString() });
    expect(() => publishPost(published, 1, at)).toThrow(
      expect.objectContaining({ code: 'POST_VERSION_CONFLICT' }),
    );
    expect(() => publishPost(published, 2, at)).toThrow(
      expect.objectContaining({ code: 'POST_NOT_DRAFT' }),
    );
    expect(() => reviseDraft(published, 2, text)).toThrow(
      expect.objectContaining({ code: 'POST_NOT_DRAFT' }),
    );
    expect(published.version).toBe(2);
  });
});
```

```bash
pnpm exec vitest run src/posts/post.test.ts src/posts/post-response.test.ts
```

The following is the complete `test/post-storage.integration.test.ts` file. The schema above must be applied to a real PostgreSQL database, and `DATABASE_URL_TEST` must point to a practice database separate from production. If it is missing, fail the test rather than skipping it. Use the Vitest configuration from the earlier chapters that transforms standard decorators.

```ts
import { randomUUID } from 'node:crypto';
import { PrismaModule } from '@fluojs/prisma';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { PostsRepository } from '../src/posts/posts.repository.js';

async function openStore(url: string) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  class TestModule {}
  defineModule(TestModule, {
    imports: [PrismaModule.forRoot({ client, strictTransactions: true })],
    providers: [PostsRepository],
    exports: [PostsRepository],
  });
  const app = await bootstrapApplication({ rootModule: TestModule });
  const store = await app.container.resolve(PostsRepository);
  return { app, store };
}

it('persists a draft across two application lifetimes', async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required');

  const slug = `storage-${randomUUID()}`;
  const cleanup = new PrismaClient({ datasources: { db: { url } } });
  try {
    const first = await openStore(url);
    let id: number;
    try {
      const post = await first.store.createDraft({
        authorId: 'author-1',
        title: 'A durable draft',
        content: 'This text must survive a restart.',
        slug,
      });
      id = post.id;
      expect(post.version).toBe(1);
      expect(await first.store.findPublishedById(id)).toBeNull();

      await expect(first.store.createDraft({
        authorId: 'author-1', title: 'Duplicate draft', content: '', slug,
      })).resolves.toMatchObject({ status: 'draft', version: 1, slug });

      expect(await first.store.editDraft(id, 1, {
        title: 'Edited draft', content: 'Saved once.', slug,
      })).toBe(true);
      expect(await first.store.editDraft(id, 1, {
        title: 'Stale edit', content: 'Must not overwrite.', slug,
      })).toBe(false);
    } finally {
      await first.app.close();
    }

    const second = await openStore(url);
    try {
      expect(await second.store.findById(id)).toMatchObject({
        title: 'Edited draft',
        content: 'Saved once.',
        status: 'draft',
        version: 2,
        publishedAt: null,
      });
      expect(await second.store.findPublishedById(id)).toBeNull();
    } finally {
      await second.app.close();
    }
  } finally {
    try {
      await cleanup.post.deleteMany({ where: { slug } });
    } finally {
      await cleanup.$disconnect();
    }
  }
});
```

```bash
pnpm exec vitest run test/post-storage.integration.test.ts
```

The key to this experiment is reading the same row through a new application container and a new Prisma Client. A test that reads the same repository instance twice could also pass with an in-memory implementation. If a database imitation's `$transaction` merely invokes the callback, it cannot prove persistence or rollback either. This is why the package's module contract tests and this database integration test verify different boundaries.

The expected result is that the edited content and `version=2` remain in the new container, while the draft stays invisible to public reads. Duplicate draft slugs are allowed, and an edit with a stale version is rejected with `false`. On publication, the service converts the unique constraint's `P2002` into `POST_SLUG_CONFLICT`. To verify an actual process restart, create a draft, shut down normally, restart, and read the same ID through the editing path. Code that reinserts the seed on every read can fool this experiment, so do not run the seed on the second startup.

This PostgreSQL integration experiment was not run during the writing of this chapter. The current repository's Prisma registration and lifecycle sources and tests were examined, and the code above is a reproduction procedure for your application. When recording verification results, distinguish actual execution results and include the database version, Prisma version, and migration state.

## What Remains After Persistence

Not every feature needs a repository interface. The current `PostsRepository` is a small class grouping post operations and depends directly on Fluo and Prisma. If you actually need interchangeable implementations, you can add a token and a port then. Do not claim that an interface name alone resolves DI, or wrap a repository with no planned replacement in a generic layer.

A restart no longer deletes a draft. But if an error occurs while writing a publication record after changing a post to published, the half-finished operation will now persist longer. As the in-memory problem disappears, a new consistency problem comes into view. In the next chapter, we combine changing the post's state and creating its publication record into one service operation, and verify that the rules hold even when publication buttons are pressed concurrently.

## Supporting Implementations and Contracts

- [Prisma integration registration, lifecycle, and transaction contracts](../../packages/prisma/README.md)
- [Public exports](../../packages/prisma/src/index.ts) and [Prisma peer dependency range](../../packages/prisma/package.json)
- [Synchronous and asynchronous module registration implementation](../../packages/prisma/src/module.ts)
- [Client boundary and transaction types](../../packages/prisma/src/types.ts)
- [`current()` and connection lifecycle implementation](../../packages/prisma/src/service.ts)
- [Per-container registration and lifecycle tests](../../packages/prisma/src/module.test.ts)
- [Sibling module visibility tests for asynchronous global registration](../../packages/prisma/src/module-global-visibility.test.ts)
- [HTTP, service, and repository integration experiment](../../packages/prisma/src/vertical-slice.test.ts)

[Previous: Running the Same Code in Different Environments](./ch09-configuration.md) - [Volume 1 Contents](./toc.md) - [Next: Making Post Publication a Single Operation](./ch11-publishing-transactions.md)
