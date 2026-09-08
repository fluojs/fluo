# Separating Stored Data from Public Data

<!-- book:volume=01-fluoblog;chapter=07 -->

[Previous: Turning External Input into Internal Data](./ch06-request-boundaries.md) | [Volume 1 Contents](./toc.md) | [Next: Creating API Contracts Users Can Understand](./ch08-api-contracts.md)

## All We Did Was Add an Internal Field

FluoBlog's input boundary now rejects an `authorId` slipped into a request body. Reassured, the operator continues developing the service. Then they inspect a post detail response and discover another problem: even the store's `authorId`, `status`, and `version` are reaching the reader's browser. This does not mean all of these values are secret. The problem is that the stored object became the API without anyone deciding what should be public.

Consider a more concrete situation. Suppose we add `editorNote` to the storage model to support internal notes on the editing screen. If the controller returns the stored object unchanged, the reader API starts sending that new field on the same day. A reviewer who looks only at the data model change and concludes that "the response is unchanged" misses the incident. The same structure can recur when password hashes or tokens are added to an account model.

In this chapter, we create separate output models for the reader's list, the reader's detail view, and the result of a writing command. Decorators from `@fluojs/serialization` make these models emit only fields marked as public. The serialization package does not, however, decide which posts may be shown to whom. Selection by publication state stays in the previous chapter's `getPublished()` and `listPublished()`; we connect writing permissions in the later authentication and authorization chapters.

We now have three important boundaries. An input DTO describes values the requester may send, a domain snapshot contains values needed for internal rules, and a response DTO describes values the server promises to make public. Some shared field names do not mean one class must take on all three responsibilities.

## Lists and Details Read the Same Stored Row Differently

The reader's list shows only the ID, title, slug, and publication time. There is no reason to send the full body of every post when a list has 50 entries. The detail view adds `content` to those fields. Omitting `version` from public details is a product choice here: we have not yet promised readers a way to validate a cache against an editing version. Even if we introduce a cache validator later, whether to expose it as a public JSON field remains a separate decision.

Writing commands return `id`, `status`, `version`, and `publishedAt`. After creation, the client needs the version for its next save and must know whether publication succeeded. This is a receipt confirming a command's result, not a projection that reconstructs the entire editing screen. When we need a query specifically for that screen, we will design a separate route and response for authenticated authors. We do not turn the current public `GET /posts/:id` into a draft lookup.

Before publication, `publishedAt` is explicitly `null`. Distinguishing an absent field from an absent value lets the client maintain a consistent response shape. Public details, on the other hand, contain only published posts, so the publication time is always an ISO string. We reflect facts the server has already established in the contract, rather than making the frontend repeatedly ask, "What if this value is missing?" for every public post.

The following is the **complete `src/posts/post-response.dto.ts` file**. We create real instances rather than calling stored objects DTOs through type assertions. `@Expose({ excludeExtraneous: true })` enables an allowlist at the class level.

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

export function toPostSummary(post: PublishedPost): PostSummaryDto {
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

export function toPostWriteReceipt(post: PostSnapshot): PostWriteReceiptDto {
  return Object.assign(new PostWriteReceiptDto(), {
    id: post.id,
    status: post.status,
    version: post.version,
    publishedAt: post.publishedAt,
  });
}
```

The detail DTO inherits from the summary DTO without repeating the class options. Serialization metadata is inherited, and the nearest class configuration is used. The allowlist therefore remains active for details, exposing only the summary's four fields plus `content`. Use inheritance only when the public meanings genuinely form this kind of subset relationship. A write receipt is not an extension of a public summary, so it has its own class.

Avoiding a copy of the entire source with `Object.assign(new PublicPostDto(), post)` is intentional too. Even if the allowlist blocks the final output, keeping internal information out of the DTO in the first place is easier to inspect. Explicit mapping reveals the intent, while the allowlist guards against fields accidentally attached later. These are not the same check performed twice; they are the two stages of selecting data and enforcing the final output boundary.

A function that explicitly creates a simple public object can be sufficient for a small app. Once multiple controllers and nested DTOs begin sharing an output policy, however, common serialization through class metadata can reduce mistakes. Conversely, wrapping even a two-field health-check response in a meaningless hierarchy offers little benefit. This chapter's goal is not to turn every object into a DTO class.

## A Class Name Is Not an Output Filter

The following **type assertion fragment illustrating a failure** does not change the original object at runtime at all. `as` neither removes fields from JSON nor changes the constructor.

```ts
const claimedDto = storedPost as PublicPostDto;
return claimedDto;
```

In this fragment, `storedPost` is the previous chapter's `PostSnapshot`, and `PublicPostDto` is the class we just defined. This is a counterexample that must not be used in a controller. The source is a plain object, not an instance of a class with serialization decorators. In contrast, the prototype of `new PublicPostDto()` gives the serializer a real class to find.

Also be careful about creating an instance and then spreading it with `return { ...dto }`. The fields are copied, but the class identity and its connection to metadata disappear. If an unapproved field has been attached to the object, it can remain in the final plain object. After mapping from the domain to a response model, keep the instance intact until the interceptor processes it.

Another approach marks only dangerous fields with `@Exclude()`. This is convenient for removing a few fields from an existing internal class. But the author must remember to exclude every private field added in the future. For a public API, a policy that declares only fields to expose is less sensitive to extensions of the storage model. Whichever approach we choose, the first priority is avoiding a design that copies raw passwords or tokens into response objects.

## Connect the Serializer Before the Response Writer

The following is the **complete replacement `src/posts/posts.controller.ts` file**. We keep the input DTOs and domain error translation, and call the output mapper appropriate to each operation's result.

```ts
import { Inject } from '@fluojs/core';
import {
  Controller, Get, HttpCode, Post, Put, RequestDto, UseInterceptors,
} from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';
import { runPostCommand } from './post-http-error.js';
import { CreatePostDto, GetPostDto, PublishPostDto, ReplacePostDto } from './post-request.dto.js';
import { toPostSummary, toPostWriteReceipt, toPublicPost } from './post-response.dto.js';
import { PostsService } from './posts.service.js';

@Controller('/posts')
@Inject(PostsService)
@UseInterceptors(SerializerInterceptor)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list() {
    return this.posts.listPublished().map(toPostSummary);
  }

  @Get('/:id')
  @RequestDto(GetPostDto)
  get(input: GetPostDto) {
    return runPostCommand(() => toPublicPost(this.posts.getPublished(input.id)));
  }

  @Post()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return runPostCommand(() => toPostWriteReceipt(this.posts.create('author-1', {
      title: input.title, content: input.content, slug: input.slug,
    })));
  }

  @Put('/:id')
  @HttpCode(200)
  @RequestDto(ReplacePostDto)
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
  publish(input: PublishPostDto) {
    return runPostCommand(() => toPostWriteReceipt(
      this.posts.publish(input.id, input.expectedVersion),
    ));
  }
}
```

We supplied a class token to `@UseInterceptors(SerializerInterceptor)`, so the DI container must be able to resolve its instance. The following is the **complete replacement `src/posts/posts.module.ts` file**. `src/app.ts` continues to import this module, and the previous chapter's `src/main.ts` prepares metadata before dynamically importing the app.

```ts
import { Module } from '@fluojs/core';
import { SerializerInterceptor } from '@fluojs/serialization';
import { PostIdConverter } from './post-id.converter.js';
import { PostsController } from './posts.controller.js';
import { POST_CLOCK, PostsService, type PostClock } from './posts.service.js';

@Module({
  controllers: [PostsController],
  providers: [
    PostsService,
    PostIdConverter,
    SerializerInterceptor,
    { provide: POST_CLOCK, useValue: { now: () => new Date() } satisfies PostClock },
  ],
  exports: [PostsService],
})
export class PostsModule {}
```

The service retains the actual token connection `@Inject(POST_CLOCK)`, and the controller retains `@Inject(PostsService)`. `SerializerInterceptor` is a class with no additional dependencies. Registering it as a provider does not apply it to every response; the `UseInterceptors` metadata connects it to this controller's pipeline. Check registration and application separately.

The serialization package does not install `Symbol.metadata` as an import side effect. Keep the previous chapter's standard-decorator test configuration and metadata preload so that tests work even when they import response DTOs before the HTTP module. Depending on some other import happening to install the symbol first in the development server can cause a standalone DTO test to fail.

## A Response Already Sent Cannot Be Fixed Later

For a framework-managed response, the handler returns a DTO, an interceptor processes it, and the writer sends it. Calling `context.response.send()` directly, however, gives the handler ownership of the final response. When `next.handle()` finishes, `SerializerInterceptor` checks whether the response has already been committed and skips serialization if it has.

Thus, even a controller with the interceptor attached is not protected if it writes the raw stored object through `send()`. This is the response ownership contract, not an unusual implementation defect. Fields cannot be removed from bytes already sent, and sending a second response cannot correct them. When you need direct response ownership for something like CSV or a stream, construct the final payload first.

The following is the **complete `src/posts/send-public-post.ts` file, used only when direct sending is necessary**. It demonstrates an alternative boundary for the same data, not a route to add to this controller. `post` must be a value obtained through the service's `getPublished()`; this helper does not perform that lookup or make permission decisions for you.

```ts
import type { RequestContext } from '@fluojs/http';
import { serialize } from '@fluojs/serialization';
import type { PublishedPost } from './post.js';
import { toPublicPost } from './post-response.dto.js';

export async function sendPublicPost(
  post: PublishedPost,
  context: RequestContext,
): Promise<void> {
  const payload = serialize(toPublicPost(post));
  await context.response.send(payload);
}
```

For an ordinary JSON API, returning a DTO is shorter and makes responsibilities clear. Using the response object when direct sending offers no benefit makes you consider ownership of status codes and error handling as well as serialization. The fact that `SerializerInterceptor` skips its work here does not mean every other interceptor also skips its work. Other interceptors can continue transforming the chain's return value, so do not generalize one package's guarantee to the entire pipeline.

## Test the Allowlist with an Accidental Field Addition

The following is the **complete `src/posts/post-response.test.ts` file**. Rather than stopping at a comparison of normal JSON, it creates a regression where internal fields are accidentally attached to a DTO. It also checks that `serialize()` does not modify the original snapshot.

```ts
import { describe, expect, it } from 'vitest';
import { Expose, Transform, serialize } from '@fluojs/serialization';
import { createDraft, publishPost } from './post.js';
import { toPostSummary, toPostWriteReceipt, toPublicPost } from './post-response.dto.js';

const draft = createDraft(2, 'author-1', {
  title: 'Output boundary',
  content: 'Keep internal data inside.',
  slug: 'output-boundary',
});
const published = publishPost(draft, 1, new Date('2026-06-01T09:00:00.000Z'));

describe('Post output boundary', () => {
  it('keeps only the detailed public fields, including inherited metadata', () => {
    const dto = Object.assign(toPublicPost(published), {
      authorId: 'internal-author',
      editorNote: 'Do not publish this note.',
    });
    expect(serialize(dto)).toEqual({
      id: 2,
      title: 'Output boundary',
      content: 'Keep internal data inside.',
      slug: 'output-boundary',
      publishedAt: '2026-06-01T09:00:00.000Z',
    });
    expect(published.authorId).toBe('author-1');
    expect(Object.hasOwn(published, 'editorNote')).toBe(false);
  });

  it('separates list data from command receipts', () => {
    expect(serialize([toPostSummary(published)])).toEqual([{
      id: 2,
      title: 'Output boundary',
      slug: 'output-boundary',
      publishedAt: '2026-06-01T09:00:00.000Z',
    }]);
    expect(serialize(toPostWriteReceipt(draft))).toEqual({
      id: 2, status: 'draft', version: 1, publishedAt: null,
    });
  });

  it('requires an explicit conversion for bigint JSON values', () => {
    const raw = { count: 9007199254740993n };
    expect(() => JSON.stringify(serialize(raw))).toThrow(TypeError);

    @Expose({ excludeExtraneous: true })
    class CounterProbe {
      @Expose()
      @Transform((value) => String(value))
      count = 9007199254740993n;
    }

    expect(JSON.stringify(serialize(new CounterProbe()))).toBe(
      '{\"count\":\"9007199254740993\"}',
    );
  });
});
```

Run `pnpm exec vitest run src/posts/post-response.test.ts` in your app. This manuscript does not claim a pass: the test was not created and run in an actual app during writing. Disabling the class-level allowlist in the first test should expose internal fields and make the test fail. We intentionally attach extra fields to the DTO because testing only the mapper would miss this regression.

The third test does not implement a post counter; it is an **isolated source-contract experiment** with non-JSON values. `serialize()` is not an engine that coerces every value into a JSON type. A `bigint` remains unchanged, and opaque values such as `Date`, `Map`, `Set`, and `Promise` can also be preserved. A `Date` may convert itself during the final JSON write, but not every built-in value produces such useful results. "It was serialized" and "it became the intended wire JSON" are separate checks.

`@Transform()` takes one current field value and synchronously returns a new value. Do not assume this callback can query a database or access other DTO fields. If asynchronous work is needed, such as looking up a user's display name, finish it in the service or before the mapper. The same boundary explains why Volume 2 sends decimal strings in JSON even when it uses `bigint` for amounts internally. This experiment does not create an actual order or payment.

### Failures When Nested Objects Appear

If we later add an author's public name, marking `author` with `@Expose()` on the parent DTO does not remove email addresses or password hashes from its children. If the child value is a plain object, its enumerable fields are traversed. The principle of creating a separate public author DTO and filling only necessary values must apply at that level too.

To prevent infinite recursion, circular references are cut to `undefined` at active back edges. By contrast, when two fields share the same already-processed reference, the serialized reference is reused. This is not a good reason to put bidirectional ORM relationships directly into responses. During JSON conversion, an object's `undefined` properties disappear, while array entries can become `null`, making the contract depend on the shape of the relationship graph. Public DTOs should expand only the necessary relationships in one direction.

## Confirm the Same Selection at the Network Boundary

The following is the **complete `scripts/response-boundary-check.mjs` file**. Start the local in-memory app afresh and run it with Node.js 24. Unlike the unit tests, it can also check whether interceptor registration was missed or a real route returns a different object.

```js
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:3000';
async function json(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, value: await response.json() };
}
const created = await json('POST', '/posts', {
  title: 'Public shape', content: 'A public paragraph.', slug: 'public-shape',
});
assert.equal(created.status, 201);
assert.deepEqual(Object.keys(created.value).sort(), ['id', 'publishedAt', 'status', 'version']);
assert.equal(created.value.publishedAt, null);
const id = created.value.id;
assert.equal((await json('GET', `/posts/${id}`)).status, 404);
const published = await json('POST', `/posts/${id}/publish`, { expectedVersion: 1 });
assert.equal(published.status, 200);
const detail = await json('GET', `/posts/${id}`);
assert.equal(detail.status, 200);
assert.deepEqual(
  Object.keys(detail.value).sort(),
  ['content', 'id', 'publishedAt', 'slug', 'title'],
);
const list = await json('GET', '/posts');
assert.equal(list.status, 200);
const item = list.value.find((post) => post.id === id);
assert.ok(item);
assert.deepEqual(Object.keys(item).sort(), ['id', 'publishedAt', 'slug', 'title']);
assert.equal(detail.value.publishedAt, published.value.publishedAt);
console.log('Response boundary checks passed.');
```

The expected result is the final success message. This is not a record of network verification performed while writing the manuscript. We assert the exact set of keys because the public field set is precisely what this test targets. That differs from a test that pins explanatory sentences in documentation. If a body appears in the list or a version leaks into public details, the test should fail for a real contract change.

Passing serialization tests alone does not prove that drafts cannot be exposed. The script above separately checks that the same ID returns `404` before publication. An output filter decides which fields of an object to send, but the service decides whether that object may be returned at all. Keeping these failures in separate assertions makes their causes clear.

## The Cost and Benefit of Maintaining Public Models

Adding an operational field to the storage model no longer automatically expands public JSON. Conversely, adding a public field requires changing the mapper and DTO, along with the documentation schema introduced later. This is a deliberate cost of change. Separating storage changes from changes to the contract promised to readers lets us improve internals without accidentally breaking frontend expectations.

We do not yet need to wrap every response in `{ data, meta }` or build an inheritance tree for every DTO. The current list is an array; details and command results are objects. Let us explicitly extend the list contract in the chapter that needs pagination. Trying to prepare a small response for every future requirement can make the fields used today harder to read.

In the next chapter, we will not leave these output choices solely in people's memories. We will create an API contract that lets frontend authors distinguish `201` from `200`, `null` from a string, and `400` from `409`. Serialization decorators do not automatically complete OpenAPI response documentation, so we will explicitly connect the point where actual responses meet the document.

## Sources and Further Reading

- [`@fluojs/serialization` README](../../packages/serialization/README.md), [public exports](../../packages/serialization/src/index.ts): the contracts for allowlists, metadata preinstallation, and synchronous value transformation.
- [Serialization engine](../../packages/serialization/src/serialize.ts), [serialization tests](../../packages/serialization/src/serialize.test.ts), [inheritance tests](../../packages/serialization/src/metadata-inheritance.test.ts): where to confirm the behavior of nesting, inheritance, plain objects, and non-JSON values.
- [SerializerInterceptor implementation](../../packages/serialization/src/serializer-interceptor.ts), [response ownership tests](../../packages/serialization/src/serializer-interceptor.test.ts): evidence that serialization is skipped after commitment.
- [HTTP interceptor resolution](../../packages/http/src/interceptors.ts), [`@fluojs/core` README](../../packages/core/README.md): support for class-token DI registration and preload order.

[Previous: Turning External Input into Internal Data](./ch06-request-boundaries.md) | [Volume 1 Contents](./toc.md) | [Next: Creating API Contracts Users Can Understand](./ch08-api-contracts.md)
