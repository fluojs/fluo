# Who Can Edit This Post?

<!-- book:volume=01-fluoblog;chapter=15 -->

[Previous: Verifying Login State](./ch14-authentication.md) | [Volume 1 Contents](./toc.md) | [Next: Protecting Legitimate Users and the Service](./ch16-abuse-protection.md)

## A Logged-In Reader Edited Someone Else's Post

FluoBlog's second contributor saves a draft, then changes the number in the address. The editing screen does not show another post, but sending `PUT /posts/1` directly from the developer tools changes the original operator's post. The server checks only that the token is valid, then updates using the post ID in the request. Neither hiding the edit button in the interface nor adding a login check prevents this failure.

Authentication establishes the subject of a request. Authorization determines whether that subject may perform a particular operation on a particular resource. The `principal.subject` verified by the previous chapter's `BlogJwtStrategy` is a trusted user ID, but it does not imply ownership of every post. In this chapter, we check both the capability `posts:write` and the resource relationship `Post.authorId`. We also handle cases where editing was allowed at the time of the check but the state changes just before the save.

Our starting data is the same as in the previous chapter. `User.id` and the JWT `sub` are string user IDs; `Post.id` is a positive integer. A post has `authorId`, `title`, `content`, `slug`, `status`, `version`, and `publishedAt`. Keeping the rule established in Chapter 5, authors may fully replace the title, content, and slug of their own drafts. Published content is immutable; even its author cannot change it through this editing path. Publication status and `publishedAt` are not editable through this path. Empty draft values and duplicate proposed slugs remain allowed.

This rule is not the right answer for every publishing product. If correcting typos after publication becomes necessary, we can design a revision flow that creates a new draft or a separate operation that preserves publication history. That would be a product change explicitly revising the existing publication contract and tests, not something to introduce silently in this authorization chapter. For now, we check a person's permissions separately from which operations the current state allows.

## A Role Name Cannot Express Ownership

At first, it is tempting to permit edits whenever someone has an `author` role. But authors also read other authors' posts, and a reader can become an author the moment they write their first post. Classifying people by role name is different from checking who owns a particular post. FluoBlog issues `posts:write` to active accounts but permits editing only when the post's `authorId` matches their own ID. We do not create a bypass branch for requests that contain an administrator string.

`@RequireScopes` from `@fluojs/passport` checks that all specified scopes are present. The string `posts:*` does not automatically become a hierarchical permission that includes `posts:write`. Class and method scope requirements are merged, so do not put `posts:write` on a class and expect an empty list on one method to erase it. Method-level declarations are easier to read in a large controller that contains both public queries and protected writes.

Do not use `@UseOptionalAuth` on the editing path, either. That decorator is for routes that also allow guests; a route requiring scopes still needs a principal. Explicitly declare `@UseAuth('blog-jwt')` and the required scope on protected methods. Since `@UseAuth` already attaches `AuthGuard`, there is no reason to attach the same guard repeatedly under different names.

The following is the **complete file `src/posts/post-edit-policy.ts`**. This policy can decide without knowing about HTTP requests or Prisma clients. This small function is not the beginning of a generic policy engine; it keeps the quick check at the route and the check at the persistence boundary aligned to the same rule.

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

`canEditPost` decides only the authorization conditions: scope and ownership. A `true` result does not permit editing a published post; the service additionally checks draft status and version. `PostActor` is not a DTO to deserialize from an external body. HTTP code creates it from the authenticated principal. If a future internal operation uses it, create it only after verifying the identity that initiated that operation. A TypeScript type does not prove that data is trustworthy. If a controller forwards the body's `actor` unchanged, authorization fails even if this function is perfect. Read it together with the point where the HTTP code below extracts the actor.

## Keep Authoritative Values Out of Client Input

Do not ask the client to resend the `authorId` that the server already knows. Users may change only a draft's title, content, and slug. To keep two editing tabs from overwriting each other's latest save, accept the `version` read by the screen as `expectedVersion`. This is not the authoritative current version, either; it is the condition, "I edited the version I saw here." Compare it with the actual value and save only when they match.

The following is the **complete file `src/posts/post-edit-input.ts`**. It separates DTO binding from value checking and does not implicitly assume that validation decorators from another package have been registered. Validate the path parameter's format before converting it to a number. Do not accept loose conversions such as `parseInt('1junk')` producing `1`, or unconditionally accept numeric strings in JSON.

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

The limits of 120 for title, 50,000 for content, and 80 for slug use the same UTF-16 code units (`length`) as Chapters 5-6. An empty string is also valid draft text. These checks run after the JSON parser has already read the entire body, so they do not replace a maximum request size at the network level. The next chapter treats that as a separate boundary. The upper bound for `expectedVersion` accounts for the PostgreSQL integer range of the Prisma `Int` used here and the next increment. Even if such values seem unlikely in practice, the HTTP boundary can reject input that would exceed the type's range and become a database error.

It also matters that the controller does not spread the request body into Prisma's `data`. Even if users add `authorId`, `status`, `version`, or `publishedAt` to the request, none appear in the returned `EditPostCommand`. Building fields from an allowlist prevents an external editing API from automatically exposing a newly added sensitive model column. Even with a shared policy that rejects unknown fields, explicitly constructing the persistence input is the final line of defense.

## Conditions Must Hold Between the Check and the Save

Looking up a post in a guard, comparing its author, and then running `update({ where: { id } })` in the controller is not enough. Another editing request can increment the version between those steps. A future ownership-transfer feature could also change the owner. An early check produces helpful errors, but it does not guarantee the preconditions of the write.

The following is the **complete file `src/posts/post-editing.service.ts`**. It uses Chapter 13's global Prisma registration and the generated `Post` model. The initial lookup classifies errors; the actual write applies only to a row matching all the ID, author, version, and status conditions. Checking the `updateMany` count is not a convenience: it is how the operation determines success. The service returns the `reviseDraft` result persisted by the successful write, and the controller converts it to the existing write-result DTO.

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

This application service is deliberately coupled to HTTP exceptions. We prioritize a small change that fits the existing post-save API. `canEditPost` itself knows nothing about HTTP, so its policy tests remain independent. If the same save command later serves a queue or another protocol, service errors can become domain results mapped by each adapter. We do not add Repository and error-conversion layers in advance for every caller that does not yet exist.

Wrapping the operation in a transaction does not automatically make a stale edit fail. Under ordinary concurrency, two transactions can read the same version. If both write with the condition `version = 4`, the first successful request increments the version to 5, and the later write finds no matching row. Do not treat that second request as a success. If publication commits first, the `status: 'draft'` condition also blocks a later edit. Reusing the `post.status` that was read would allow a request that read a published post too, so name the permitted state itself in the write condition. The final `version` in the response becomes the precondition for the next edit.

If the server reads the latest version and automatically retries a conflict, it can overwrite content the user has not seen. Retrying a network or serialization conflict is not the same problem as retrying an editing conflict. This path returns 409 and lets the editing screen preserve its own draft while comparing it with the latest content. There is no separate idempotency key yet. If the first save committed but only its response was lost, resending the same `expectedVersion` yields 409. That does not mean the save happened twice; it means the client should first check the latest state.

## Pass the Verified Actor from a Protected Route

The following is the **complete file `src/posts/post-editing.controller.ts`**. Move the existing `PUT /posts/:id` here. Apply it together with the complete public-controller replacement below to remove the old unauthenticated PUT. The response keeps the existing `id`, `status`, `version`, and `publishedAt`, and `runPostCommand` maps asynchronous domain failures.

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

The service rechecks scopes despite the guard because the next caller might omit that guard. In the HTTP path, Passport rejects early to reduce unnecessary storage work, while the service preserves its own write contract. Conversely, storing the current user for every request in a singleton-service field such as `this.currentUser` can mix up users across concurrent requests. Pass the actor as a request argument, not as global state.

## Protect the Remaining Creation and Publication Paths Too

Replace `src/posts/posts.controller.ts` with the following **complete public-GET-only file**. Remove all the anonymous `create`, `replace`, and `publish` methods from Chapters 8-12 from this file. Do not register the old controller for the same paths under another name. Editing retains the existing full-replacement contract of `PUT /posts/:id`; do not create a separate `PATCH` path.

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

This is the **complete `src/posts/post-writing.service.ts`**. The author of a new post is the authenticated account ID, and publication passes through Chapter 11's transaction for author comparison, conditional update, and publication recording. Check the scope at the service entry point too, so an internal call without a guard cannot skip authorization.

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

This is the **complete `src/posts/post-writing.controller.ts`**. It passes only the verified principal, not `author-1` or the body's `authorId`. Both creation and publication have guards.

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

The **complete `src/posts/posts.module.ts`** registers all repositories, converters, serializers, and authenticated write providers.

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

In Chapter 14, `PassportModule` globally exported `AuthGuard`, and `AuthModule` exported `BlogJwtStrategy`. This graph therefore connects all the way to actual token interpretation. Importing a class name is different from securing visibility of a module's providers. If `PostsModule` does not import `AuthModule`, the strategy name may be registered while the route's container still cannot find the strategy. Do not hide such a configuration error as a permissions-related 403.

The **complete `src/app.ts`** also includes all the separated controllers as documentation sources. `BlogDatabaseModule` remains the single global registration.

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

## What Should a Failure Response Reveal?

For this chapter's paths, an unauthenticated request is 401; a missing scope or another author's post is 403; a nonexistent post is 404; an outdated version or an attempt to edit a published post is 409; and invalid input is 400. Fluo's `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, and `BadRequestException` explicitly carry those respective statuses. Simply returning `false` from a guard makes the HTTP guard chain throw 403. If you intend 401 for missing credentials, use Passport's authentication path or an explicit exception.

Returning 403 for another person's post and 404 for a missing post makes their existence distinguishable. This blog exposes public post IDs, so we choose that distinction for the editing API as well. A product that must hide even the existence of private drafts should instead treat unauthorized lookups and missing resources as the same 404 and align the policy across all related paths. Changing one response code while search, error messages, or processing time still reveal existence is not complete concealment.

The exact timing of an account suspension matters too. If suspension commits after `BlogJwtStrategy` successfully looks up the current account, an in-progress save may finish. This chapter's policy does not retroactively cancel execution already approved by an authentication decision. A requirement such as a legal lock, where no write may finish after suspension commits, needs broader transaction boundaries so suspension and post writes follow the same locking rules. Merely looking up the account once more creates another gap between check and use.

## Verify Combinations of Author, Permission, and Version

Below is the **complete file `src/posts/post-edit-policy.test.ts`**. It checks the actual input combinations this policy decides, not roles or screen presentation. In particular, test a different person with the scope separately from the author without the scope; this detects a regression that removes either condition.

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

A policy-function test alone cannot prove that routes are protected. With the Node.js 24 application and a development PostgreSQL database, create users A and B and one draft belonging to A. Give both users valid tokens, then use B's token to edit A's post. Expect 403, with the title, content, and version all unchanged. Adding A's `authorId` and `roles: ['admin']` to the body causes Chapter 6's allowlist binder to reject unknown fields with 400; the data must remain unchanged in this case too. A's token with the correct version returns 200 and increments the version by exactly one.

For the race experiment, start two requests from A with the same `expectedVersion` using `Promise.all`, and inspect the results after both finish. With PostgreSQL's default READ COMMITTED path, expect one 200, one 409, and a final version increase of 1. Do not prescribe which title the first request to finish will save. Observe that one of the two candidates is stored intact and the other request does not overwrite it. Do not arrange the order with test-only time delays. If you separately use a higher isolation level, also verify the mapping of serialization failures.

Check effects not included in the save response too. The draft must remain `draft`, with `publishedAt` retaining its original value. An edit request against a published post owned by A must yield 409 even with the current version, leaving title, content, version, `slug`, and `publishedAt` all unchanged. Check the same invariants in a race where editing attempts its write after draft publication commits. A nonexistent ID yields 404, a missing token 401, and a string `expectedVersion` 400. Do not expect one response to list every error when several conditions are wrong. The first rejecting boundary among authentication, binding, policy, and persistence determines the result.

## Check for Bypasses Through Existing Write Paths over Real HTTP

Also replace Chapter 8's `src/posts/post-api.test.ts` with the following **complete file**. Creating descriptors for `PostsController` alone now exposes only the two public GET operations. Document all three registered controllers from the same list, and add authentication metadata to the existing checks for the input allowlist, output keys, and five operations.

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

The following is the **complete `scripts/post-authorization-check.mjs`**. Run `node scripts/post-authorization-check.mjs` against a dedicated test database with the migrations from Chapters 10-15 applied and a running local application. This experiment precedes Chapter 16's limits, and the accounts and posts it creates remain in that dedicated database. Do not run it against a production database. Use this authenticated-path check in place of the earlier chapter's anonymous HTTP script.

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

Additionally, sending creation, PUT, and publication requests with a valid test token that lacks `posts:write` must produce 403 for each. In the test database, confirm that a new post's `authorId` equals `user.id` in the login response, and that the post whose duplicate publication failed remains `draft/version=1/publishedAt=null` with no publication record. The two empty drafts created at the start have different IDs. This HTTP script and the real PostgreSQL experiments are reproduction procedures presented in the manuscript, not records of runs performed here.

The tests and PostgreSQL race experiments presented here were not run while writing this manuscript. The implementation was composed using the actual packages' scope, guard, and exception sources as evidence; migrations and route integration in your application are a separate reproduction scope. When verifying, check not just successful status codes but also that failures leave data unchanged.

FluoBlog now follows "Is this person logged in?" with "May this person edit this post?" But safely rejecting an unauthorized request is different from handling thousands of requests. The next chapter designs where request costs and limits belong so password guessing and repeated save-button clicks do not ruin the experience for legitimate readers.

## Evidence and Further Source Reading

- [HTTP route, guard, and exception contracts](../../packages/http/README.md)
- [HTTP public exports](../../packages/http/src/index.portable.ts), [guard-chain rejection behavior](../../packages/http/src/guards.ts)
- [HTTP exceptions with explicit status codes](../../packages/http/src/exceptions.ts)
- [Passport authentication and scope contracts](../../packages/passport/README.md)
- [Guard attachment by authentication decorators](../../packages/passport/src/decorators.ts), [scope-merging implementation](../../packages/passport/src/scope.ts)
- [Insufficient-scope and authentication-failure tests](../../packages/passport/src/guard.test.ts)
- [Prisma transaction boundary contract](../../packages/prisma/README.md)

[Previous Chapter](./ch14-authentication.md) | [Volume 1 Contents](./toc.md) | [Next Chapter](./ch16-abuse-protection.md)
