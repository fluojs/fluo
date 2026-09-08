# How Drafts Differ from Published Posts

<!-- book:volume=01-fluoblog;chapter=05 -->

[Previous: Developing by Proving Behavior](./ch04-testing-from-the-start.md) | [Volume 1 Contents](./toc.md) | [Next: Turning External Input into Internal Data](./ch06-request-boundaries.md)

## Between the Save Button and the Publish Button

FluoBlog's first post, `Hello, Fluo!`, can now be retrieved over HTTP, and the service extracted from the controller can be called from tests. So far, all that mattered was that the post existed. When the operator starts writing a second post, a different need appears. They want to jot down a title and close the laptop, then decide for themselves when readers can see the finished text. If saving and making a post public are the same operation, a single autosave can release unfinished sentences.

At first, a single `published: boolean` seems sufficient. The problem lies in its relationship with other values. `published` might be true with no publication time, or the public address might be an empty string. If the list selects published posts but the detail lookup searches only by ID, readers who know the address can see unpublished posts too. This is not a flaw in the framework's routing. It is the result of not yet defining what the application recognizes as a post.

In this chapter, we define posts as an application-owned model. Fluo does not create a state machine or a posts table for us. `src/posts/post.ts` owns the rules for a post, while `src/posts/posts.service.ts` stores and finds multiple posts. We will connect HTTP input in the next chapter. We finish the model first because scheduled publishing tasks introduced later must use the same rules as the controller.

The execution baseline for these four chapters is the CLI-created `fluo-blog`, Node.js 24, and pnpm 10. The `src/...` paths in the code belong to the application you create. The repository's `examples/fluo-blog` provides runnable evidence for the early HTTP/DI path; it is not a separate snapshot implemented through this chapter. We use the test environment prepared in the previous chapter, and identify each code block below as either a complete file or a partial replacement.

## Define the Allowed Operations Before the States

In FluoBlog, a draft can be saved with an empty title and body. Preserving work in progress is better than refusing the Save button. We cannot, however, accept input that consumes unlimited memory, so we set length limits of 120 for the title, 50,000 for the body, and 80 for the slug. Length in this chapter means a JavaScript string's `length`: the number of UTF-16 code units. We do not promise that it exactly matches the number of visible characters.

Publishing requires non-whitespace characters in both the title and body, and a slug made of lowercase English letters and digits joined by hyphens. We do not automatically transliterate a Korean title into an address; the author chooses the slug. Automatic generation is convenient, but it requires separate decisions about whether a title change should change the URL and how to distinguish two posts with the same title. Explicit input is easier to explain in a small product.

This model does not allow editing the body of a published post or making it private again. Both are valid product choices, but they bring new requirements for revision history and the lifetime of public links. For now, the state transition is one-way: `draft -> published`. Editing a draft is `draft -> draft`, but it can overwrite a version someone else has read, so it is also a write that increments the version.

`version` starts at 1 on creation and increases by 1 after every successful change. The client submits the version it read as `expectedVersion`, and the service compares it with the current value. This value does not replace author authentication. "Who may write?" and "Who changed it first?" are different questions. Here, we handle the accident of one operator editing the same post in two tabs. Later chapters connect accounts and permissions to the existing `authorId`.

## Express the Rules in a Single Function Call

The following is the **complete `src/posts/post.ts` file**. It imports neither HTTP nor Fluo. Failures are distinguished by application error codes, and success returns a new snapshot.

```ts
export type PostErrorCode =
  | 'POST_NOT_FOUND'
  | 'POST_INVALID_TEXT'
  | 'POST_VERSION_CONFLICT'
  | 'POST_NOT_DRAFT'
  | 'POST_NOT_PUBLISHABLE'
  | 'POST_SLUG_CONFLICT';

export class PostDomainError extends Error {
  constructor(
    readonly code: PostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PostDomainError';
  }
}

export type DraftText = Readonly<{
  title: string;
  content: string;
  slug: string;
}>;

type PostBase = DraftText & Readonly<{
  id: number;
  authorId: string;
  version: number;
}>;

export type DraftPost = PostBase & Readonly<{
  status: 'draft';
  publishedAt: null;
}>;

export type PublishedPost = PostBase & Readonly<{
  status: 'published';
  publishedAt: string;
}>;

export type PostSnapshot = DraftPost | PublishedPost;

function normalizeText(input: DraftText): DraftText {
  const title = input.title.trim();
  const slug = input.slug.trim();
  const content = input.content;
  if (title.length > 120 || content.length > 50_000 || slug.length > 80) {
    throw new PostDomainError('POST_INVALID_TEXT', 'Post text exceeds the length limit.');
  }
  return { title, content, slug };
}

function requireDraft(
  current: PostSnapshot,
  expectedVersion: number,
): asserts current is DraftPost {
  if (current.version !== expectedVersion) {
    throw new PostDomainError('POST_VERSION_CONFLICT', 'Another change was saved first.');
  }
  if (current.status !== 'draft') {
    throw new PostDomainError('POST_NOT_DRAFT', 'This operation requires a draft.');
  }
  if (!Number.isSafeInteger(current.version + 1)) {
    throw new Error('Post version exceeds the safe integer range.');
  }
}

export function createDraft(
  id: number,
  authorId: string,
  input: DraftText,
): DraftPost {
  if (!Number.isSafeInteger(id) || id < 1 || authorId.length === 0) {
    throw new Error('Invalid server-owned post identity.');
  }
  return Object.freeze({
    ...normalizeText(input),
    id,
    authorId,
    version: 1,
    status: 'draft',
    publishedAt: null,
  });
}

export function reviseDraft(
  current: PostSnapshot,
  expectedVersion: number,
  input: DraftText,
): DraftPost {
  requireDraft(current, expectedVersion);
  return Object.freeze({
    ...current,
    ...normalizeText(input),
    version: current.version + 1,
  });
}

export function publishPost(
  current: PostSnapshot,
  expectedVersion: number,
  now: Date,
): PublishedPost {
  requireDraft(current, expectedVersion);
  if (
    current.title.trim().length === 0
    || current.content.trim().length === 0
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(current.slug)
  ) {
    throw new PostDomainError('POST_NOT_PUBLISHABLE', 'Check the title, content, and public slug.');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error('The publishing clock returned an invalid date.');
  }
  return Object.freeze({
    ...current,
    status: 'published',
    publishedAt: now.toISOString(),
    version: current.version + 1,
  });
}
```

We could store `publishedAt` as `string | null` in every state. Splitting the types, however, lets TypeScript know that the time is a string once we check `status === 'published'`. This does not mean invalid database rows are repaired automatically. It is a promise about values that pass through this file's creation and mutation functions. We will still be responsible for restoring that promise when reading from a database later.

We preserve leading and trailing whitespace in the body because this is a technical blog that uses code examples and Markdown indentation. We check the length after `trim()` only when deciding whether a post can be published. The title and slug are trimmed on input. This is a small example of how applying the same normalization function to every string can change the meaning of the data.

Invalid identifiers and clocks throw an ordinary `Error`. The server supplies both values, so we distinguish them from document errors the user can correct and resubmit. In contrast, requesting publication with an empty body is an expected business failure. This distinction keeps the next chapter's HTTP boundary from hiding server defects behind `400` responses.

`Object.freeze()` performs a shallow freeze. Our snapshots currently contain only primitive values, so it is enough to prevent accidental changes to a returned object from changing state inside the store. The same guarantee will not automatically extend to a tags array or an author object added later. Rather than relying on the word immutable, check which references are actually shared.

## Separate Rules for One Post from Rules for Multiple Posts

We can judge the format of a slug by looking at one post. Detecting duplicate slugs requires looking at other published posts. If a pure function searches a global `Map` to perform that check, every test must clear global state, and replacing the store becomes harder. The service that can query multiple posts checks for duplicates and saves just once, after every check succeeds.

The following is the **complete `src/posts/posts.service.ts` file**. For now, this is an in-memory implementation in a single process. We do not create a generic Repository interface. Introducing an abstraction with `findMany`, `updateAny`, and `saveAnything` for this amount of behavior would obscure the operations that actually need atomic guarantees.

```ts
import { Inject } from '@fluojs/core';
import {
  createDraft,
  PostDomainError,
  publishPost,
  reviseDraft,
  type DraftText,
  type PostSnapshot,
  type PublishedPost,
} from './post.js';

export const POST_CLOCK = Symbol('POST_CLOCK');
export type PostClock = { now(): Date };

@Inject(POST_CLOCK)
export class PostsService {
  private readonly posts = new Map<number, PostSnapshot>();
  private nextId = 2;

  constructor(private readonly clock: PostClock) {
    const seed = createDraft(1, 'author-1', {
      title: 'Hello, Fluo!',
      content: 'My first post.',
      slug: 'hello-fluo',
    });
    this.posts.set(1, publishPost(seed, 1, new Date('2026-01-01T00:00:00.000Z')));
  }

  create(authorId: string, input: DraftText): PostSnapshot {
    const post = createDraft(this.nextId, authorId, input);
    this.posts.set(post.id, post);
    this.nextId += 1;
    return post;
  }

  get(id: number): PostSnapshot {
    const post = this.posts.get(id);
    if (!post) {
      throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
    }
    return post;
  }

  listPublished(): PublishedPost[] {
    return [...this.posts.values()].filter(
      (post): post is PublishedPost => post.status === 'published',
    );
  }

  getPublished(id: number): PublishedPost {
    const post = this.get(id);
    if (post.status !== 'published') {
      throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
    }
    return post;
  }

  revise(id: number, expectedVersion: number, input: DraftText): PostSnapshot {
    const next = reviseDraft(this.get(id), expectedVersion, input);
    this.posts.set(id, next);
    return next;
  }

  publish(id: number, expectedVersion: number): PublishedPost {
    const next = publishPost(this.get(id), expectedVersion, this.clock.now());
    const duplicate = [...this.posts.values()].some(
      (post) => post.status === 'published' && post.slug === next.slug,
    );
    if (duplicate) {
      throw new PostDomainError('POST_SLUG_CONFLICT', 'The public slug is already in use.');
    }
    this.posts.set(id, next);
    return next;
  }
}
```

The first seed has the same ID, title, and body as in the initial HTTP exercise. Since readers have already seen it, we put it in the published state, with version 2. New drafts start at ID 2 and version 1. `author-1` is the server-owned operator identifier for this exercise. It is a place to connect the account model later, not a promise to trust an `authorId` in the request body. The publication time is a fixed, testable seed value; actual new posts use the injected clock.

Creating the candidate object in `publish()` does not mean it has been saved. If the slug check fails, nothing is written to the `Map`, so the original draft and version remain intact. If the function mutated the original object, some state would already have changed even with this ordering. Creating a new snapshot is not merely a preference for a functional style; it is a way to handle partial failure.

Within one process, this method runs synchronously, with no `await` between the checks and `Map.set()`. In the current model, therefore, even if two HTTP requests call publish with the same version, the first call finishes saving before the second reads the latest version. Do not call this a distributed lock or a database transaction. The reasoning no longer holds as soon as the store becomes asynchronous, so the later chapters on Prisma and publication transactions must reestablish the guarantee with conditional updates and unique constraints.

## DI Connects External Values, Not the Rules

`PostClock` is a type alias. It does not exist when JavaScript runs, so we cannot write `@Inject(PostClock)`. The actual token is `POST_CLOCK`, and we place `@Inject(POST_CLOCK)` on the class. The following is the **complete `src/posts/posts.module.ts` for this chapter's service-level unit experiment**. The next chapter presents the final module that also retains the previous chapter's HTTP controller registration.

```ts
import { Module } from '@fluojs/core';
import { POST_CLOCK, PostsService, type PostClock } from './posts.service.js';

@Module({
  providers: [
    PostsService,
    {
      provide: POST_CLOCK,
      useValue: { now: () => new Date() } satisfies PostClock,
    },
  ],
  exports: [PostsService],
})
export class PostsModule {}
```

Other feature modules put `PostsModule` in their `imports` and inject `PostsService`. There is no need to expose the internal clock token to other features. Use this export boundary instead of registering `PostsService` in the `providers` of several modules in one app. Tests can verify behavior with `new PostsService(fixedClock)` even without a container. DI did not create testability; making the dependency explicit as a constructor argument did.

## A Test That Reproduces the Two-Tab Accident

The following is the **complete `src/posts/post.test.ts` file**. It assumes the Vitest standard-decorator transformation environment configured in the previous chapter. We do not assume that Node.js 24 can execute TypeScript decorator syntax as-is.

```ts
import { describe, expect, it } from 'vitest';
import { createDraft, publishPost } from './post.js';
import { PostsService } from './posts.service.js';

const fixedClock = { now: () => new Date('2026-06-01T09:00:00.000Z') };
const text = { title: 'First review', content: 'We tested a restart.', slug: 'first-review' };

describe('Post transitions', () => {
  it('keeps an empty draft unchanged after publishing fails', () => {
    const draft = createDraft(2, 'author-1', { title: '', content: '', slug: '' });
    expect(() => publishPost(draft, 1, fixedClock.now())).toThrow(
      expect.objectContaining({ code: 'POST_NOT_PUBLISHABLE' }),
    );
    expect(draft).toMatchObject({ status: 'draft', version: 1, publishedAt: null });
  });

  it('rejects the late writer when two tabs read the same version', () => {
    const service = new PostsService(fixedClock);
    const draft = service.create('author-1', text);
    const leftVersion = draft.version;
    const rightVersion = draft.version;
    service.revise(draft.id, leftVersion, { ...text, title: 'Saved first' });
    expect(() => service.revise(draft.id, rightVersion, text)).toThrow(
      expect.objectContaining({ code: 'POST_VERSION_CONFLICT' }),
    );
    expect(service.get(draft.id)).toMatchObject({ title: 'Saved first', version: 2 });
  });

  it('does not change the publication time or version on repetition', () => {
    const service = new PostsService(fixedClock);
    const draft = service.create('author-1', text);
    const published = service.publish(draft.id, 1);
    expect(published).toMatchObject({
      status: 'published', version: 2, publishedAt: '2026-06-01T09:00:00.000Z',
    });
    expect(() => service.publish(draft.id, 1)).toThrow(
      expect.objectContaining({ code: 'POST_VERSION_CONFLICT' }),
    );
    expect(() => service.publish(draft.id, 2)).toThrow(
      expect.objectContaining({ code: 'POST_NOT_DRAFT' }),
    );
    expect(service.get(draft.id)).toBe(published);
  });

  it('keeps the second post as a draft after a slug conflict', () => {
    const service = new PostsService(fixedClock);
    const first = service.create('author-1', text);
    const second = service.create('author-1', text);
    service.publish(first.id, 1);
    expect(() => service.publish(second.id, 1)).toThrow(
      expect.objectContaining({ code: 'POST_SLUG_CONFLICT' }),
    );
    expect(service.get(second.id)).toMatchObject({ status: 'draft', version: 1 });
    expect(() => service.getPublished(second.id)).toThrow(
      expect.objectContaining({ code: 'POST_NOT_FOUND' }),
    );
  });
});
```

Run `pnpm exec vitest run src/posts/post.test.ts` in your application. This file was not created and executed in an app while this manuscript was written, so do not read this as a recorded pass. The expected observation is that all four tests pass, with particular attention to whether the stored object's version and state remain unchanged after failure. Removing the version comparison from the initial implementation should make the two-tab test fail. An implementation that changes state before failing will be exposed by the slug-conflict test.

There is no need to put `setTimeout()` between two calls to imitate real concurrency. The condition behind this accident is that two editors held the same version. Expressing that condition as two variables makes the check follow the same order every time. An experiment with overlapping database requests will need a separate synchronization point, but we do not invent an asynchronous store in tests before one exists.

## Repeated Requests and Persistence Are Different Promises

The browser connection can drop before the publication response arrives. If the user publishes again with the same version, this implementation returns a conflict rather than replaying the successful response. The server changed state only once, but that does not guarantee the client conclusively observed one success. After a conflict, the editing screen can read the latest state and check whether the post has already been published. Replaying the same response requires a command identifier and stored results. `version` alone does not provide that feature.

When the process stops, new drafts disappear and only the seed is recreated. Registering a module as a singleton sets the sharing scope within the process; it does not save anything to disk. There is no need to stop a real production process to test this limitation in this chapter. Create two `PostsService` instances and check that a post created in the first is absent from the second: that reveals the scope of storage. This is also where our reason for moving to PostgreSQL in Chapter 10 begins.

A domain class does not have to become a complex hierarchy. If pure functions and immutable snapshots are sufficient, as they are here, keep them. If publication approval, withdrawal, or revision history later causes conditions to spread across multiple callers, extend the model while keeping state transitions together in one place. The strength of a small model is not having fewer rules, but making every current rule readable.

Drafts can now safely hold incomplete posts, and publication transitions only posts that satisfy the public requirements, once. The next chapter's problem is not a JavaScript object but an HTTP request. Passing the ID from `/posts/not-a-number` or `status: "published"` from a request body directly to this model would break the boundary we just established. Let us define the sources and allowed values of input and turn them into internal commands.

## Sources and Further Reading

- [Editorial contract](../EDITORIAL.md) and [finalized contents manifest](../series.json): the basis for post fields and product continuity.
- [`@fluojs/core` README](../../packages/core/README.md), [public exports](../../packages/core/src/index.ts): evidence for class-level `@Inject`, module registration, and the default singleton scope.
- [`@fluojs/http` exception implementation](../../packages/http/src/exceptions.ts): the boundary where we will translate domain failures into HTTP failures in the next chapter.
- [`@fluojs/validation` tests](../../packages/validation/src/validation.test.ts): evidence for keeping input validation separate from domain state transitions. The post rules in this chapter are application code defined in the text, not Fluo package APIs.

[Previous: Developing by Proving Behavior](./ch04-testing-from-the-start.md) | [Volume 1 Contents](./toc.md) | [Next: Turning External Input into Internal Data](./ch06-request-boundaries.md)
