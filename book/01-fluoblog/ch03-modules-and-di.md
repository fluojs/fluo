# Moving Logic Out of the Controller

<!-- book:volume=01-fluoblog;chapter=03 -->

[Previous: Serving the First Post over HTTP](./ch02-first-http-route.md) | [Volume 1 contents](./toc.md) | [Next: Developing with Evidence of Behavior](./ch04-testing-from-the-start.md)

## The Boundary Revealed by a Second Caller

FluoBlog's first post can now be read over HTTP. While preparing the next post, the operator wants to check the post count and titles in the terminal before deployment. A small script that calls the API would work, but it would be convenient to run just the application's query rules without starting a server first. The object that currently holds the data, however, is `PostsController`. Querying posts requires knowing about HTTP input DTOs and `404` exceptions as well.

The problem is less that the controller is long than that different reasons for change are gathered in one place. Parsing an ID from a URL is an HTTP input policy. Finding and returning a post belongs to the posts feature. Delivering a missing result as `404` is, once again, an HTTP response policy. Reusing the query logic while bringing all three along means that a console command must understand HTTP exceptions, and even a simple data test must construct a request shape.

This chapter moves boundaries rather than adding features. We preserve `/posts`, `/posts/1`, `400` for an invalid ID, and `404` for a missing post. The previous chapter's `scripts/check-posts.mjs` should check the same contract before and after the refactoring. Changing URLs or the seed's field names merely because internal files changed would make it difficult to distinguish a structural failure from a feature change.

We will not begin with a generic repository interface or an external database. The data is still an in-memory array of posts. What we need is to put query logic in `PostsService`, make its initial data explicit, and let a feature module own assembly. Modules and DI are tools for revealing collaboration that already exists, not reasons to divide every class into tiny pieces.

## First, Move the Logic into a Service You Can Construct Directly

The smallest intermediate step is for `PostsService` to own the existing array along with `list()` and `findById()`. The controller converts the input ID into a number, asks the service for a result, and throws `NotFoundException` only when that result is absent. The service receives neither a request object nor a Fastify response. This relationship should be expressible through an ordinary TypeScript constructor call, independent of the framework.

Add one testing requirement: we want to create a blog with no posts and a blog with one post independently within the same test run. Changing a fixed seed inside the service for each test could make results depend on test order. Taking initial data through the constructor lets callers state each service's starting condition explicitly. This separates only the input we actually need now, rather than abstracting an external repository.

First, create `src/posts/post.tokens.ts`. The following is the **complete file**.

```ts
export const INITIAL_POSTS = Symbol('INITIAL_POSTS');
```

This token is a runtime value that identifies the initial list of posts. The interface expression `Post[]` itself cannot serve as a DI token because TypeScript types disappear at runtime. Creating another Symbol with the same description in a different file produces a different token. Both registration and injection must import `INITIAL_POSTS` from this file.

Now write the **complete file** `src/posts/posts.service.ts`. `Post` has the three fields `id`, `title`, and `content` defined in `src/posts/post.ts` in the previous chapter.

```ts
import { Inject } from '@fluojs/core';
import type { Post } from './post';
import { INITIAL_POSTS } from './post.tokens';

@Inject(INITIAL_POSTS)
export class PostsService {
  private readonly posts: Post[];

  constructor(initialPosts: readonly Post[]) {
    this.posts = initialPosts.map((post) => ({ ...post }));
  }

  list(): Post[] {
    return this.posts.map((post) => ({ ...post }));
  }

  findById(id: number): Post | undefined {
    const post = this.posts.find((candidate) => candidate.id === id);
    return post ? { ...post } : undefined;
  }
}
```

We copy at both the constructor and return boundaries. Without the constructor copy, a caller could later change the seed array or its objects and thereby alter the service's state. Without copies of return values, a caller in the same process could change internal state through a list or detail result. `private readonly posts` only prevents assigning another array to the field; it does not automatically make the array and its objects immutable.

Because all current fields hold primitive values, these copies are straightforward and sufficient. There is no need for a generic copying function that serializes and deserializes every value as JSON. If dates or nested objects appear later, we will need to revisit the return model. Do not describe the problem solved here as a guarantee of deep immutability for every future object.

`findById()` returns `undefined` for a missing result. A console report can treat it as a missing item, and an HTTP controller can convert it to `404`. Because the service does not import the HTTP package, caller-specific presentation policies do not need to live inside it. Whether `id` is a valid number, on the other hand, is a contract of the calling boundary. Do not copy the previous chapter's `parsePostId()` into the service. Any new external input path must validate its own input.

## Declaring Injection and Registering a Provider Are Different Jobs

Calling `new PostsService(seed)` directly in the controller would work for now. But that would let the controller decide which data initializes the service. Tests or other execution modes that need different initial data would then require changes to the controller as well. Move construction to the configuration boundary and let the controller receive the service it needs.

Below is the **complete replacement file** for `src/posts/posts.controller.ts`. `parsePostId` and `PostParamsDto` remain as implemented in the previous chapter.

```ts
import { Inject } from '@fluojs/core';
import { Controller, Get, NotFoundException, RequestDto } from '@fluojs/http';
import type { Post } from './post';
import { parsePostId } from './post-id';
import { PostParamsDto } from './post-params.dto';
import { PostsService } from './posts.service';

@Inject(PostsService)
@Controller('/posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list(): Post[] {
    return this.posts.list();
  }

  @Get('/:id')
  @RequestDto(PostParamsDto)
  get(input: PostParamsDto): Post {
    const post = this.posts.findById(parsePostId(input.id));
    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    return post;
  }
}
```

`@Inject(PostsService)` is a standard decorator applied to the class. It is not the older decorator syntax applied to constructor parameters or properties. It declares that the constructor's first argument should receive the instance resolved through the `PostsService` token. With multiple dependencies, the order of `@Inject(A, B)` must match the order of the constructor arguments. Do not expect automatic injection based on type names.

This declaration does not register a provider. The existence of a `PostsService` file and its import by the controller do not add the service to the module graph. A JavaScript import is a boundary for accessing code values; Fluo provider registration is a boundary for assembling objects to execute. Confusing the two can leave you with correct types in the editor but unresolved dependencies at runtime.

The **complete file** `src/posts/posts.module.ts` connects them as follows.

```ts
import { Module } from '@fluojs/core';
import type { Post } from './post';
import { INITIAL_POSTS } from './post.tokens';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

const initialPosts: Post[] = [
  { id: 1, title: 'Hello, Fluo!', content: 'My first post.' },
];

@Module({
  controllers: [PostsController],
  providers: [
    { provide: INITIAL_POSTS, useValue: initialPosts },
    PostsService,
  ],
  exports: [PostsService],
})
export class PostsModule {}
```

`controllers` defines HTTP entry points, `providers` defines values and services internal to the feature, and `exports` defines tokens exposed to other modules that use this module. Here, we expose only `PostsService`, not the initial array itself. If another feature could read and modify the seed directly, it would bypass the service's copying policy and query contract.

The initial data now lives at the configuration boundary rather than in the controller. This value provider is neither a database nor persistent storage. Restarting the process creates a new service from the same seed. Separating this limited input with a token is enough to inject empty data or specific test data, without introducing a `Repository<T>` layer that does not yet exist.

## Connect Only the Feature's Entry Point at the Root

The following is the **complete replacement file** for `src/app.ts`. It removes the previous chapter's direct registration of `PostsController` and imports `PostsModule` instead. Everything else is the generated starter configuration.

```ts
import { Global, Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { HealthModule } from '@fluojs/runtime';
import { GreetingModule } from './greeting/greeting.module';
import { PostsModule } from './posts/posts.module';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
    }),
    GreetingModule,
    HealthModule.forRoot(),
    PostsModule,
  ],
})
export class AppModule {}
```

The root module no longer needs to know how many controllers the posts feature contains or which seed token it uses. Do not also register `PostsService` in the root's `providers`. That is not the proper way to make a dependency visible; it duplicates ownership of the registration. If another feature needs the service, it should connect `PostsModule` through its own `imports` and use that module's export.

Do not copy the starter root's `@Global()` onto every feature module either. `PostsModule` has no global declaration. Hiding missing imports with global visibility makes the direction of dependencies between features harder to see in the code. As the application grows, explicit module connections help a newcomer understand the scope of a change.

In the new structure, a request flows from the root to the posts module, then to its controller and the injected service. `INITIAL_POSTS` is read when the service is constructed. We do not reinject the seed or create a new array provider on every GET request. The default singleton service is shared within the app context, and queries create copies to return to callers.

At this point, run the previous chapter's HTTP checks again. The list and detail seed, `400` for an invalid ID, and `404` for a missing ID must remain the same. Do not force the HTTP checks to expose the fact that the internal array no longer lives in the controller. Changing internal assembly while preserving the external contract is the success condition for this refactoring.

## Observing Registration and Replacement Directly in a Container

We can examine DI itself through a small experiment that does not use modules. The following is the **complete file** for `src/posts/di-probe.ts`. This is an independent experiment for observing the difference between registration and resolution, not code for inserting a container into an application request handler.

```ts
import assert from 'node:assert/strict';
import { Container, DuplicateProviderError } from '@fluojs/di';
import { INITIAL_POSTS } from './post.tokens';
import { PostsService } from './posts.service';

const container = new Container();
container.register(
  { provide: INITIAL_POSTS, useValue: [] },
  PostsService,
);

try {
  assert.throws(
    () => container.register({ provide: INITIAL_POSTS, useValue: [] }),
    DuplicateProviderError,
  );

  container.override({
    provide: INITIAL_POSTS,
    useValue: [
      { id: 1, title: 'Hello, Fluo!', content: 'My first post.' },
    ],
  });

  const first = await container.resolve(PostsService);
  const second = await container.resolve(PostsService);
  assert.equal(first, second);
  assert.equal(first.list().length, 1);
  assert.equal(first.findById(999), undefined);
  console.log('DI registration checks passed.');
} finally {
  await container.dispose();
}
```

```bash
pnpm exec vite build --ssr src/posts/di-probe.ts --outDir dist-di-probe
node dist-di-probe/main.js
```

The expected successful result is the final success message followed by exit. An assertion checks that a duplicate `register()` is rejected, and intentional replacement uses `override()`. Because replacement happens before the service is first constructed, this experiment does not cover the more complex lifecycle of replacing an object already in use. The assertion that two resolutions return the same reference demonstrates the default singleton behavior.

The `await` in `await container.resolve()` is not optional decoration. Providers can involve factories or asynchronous resolution, so the public API returns an asynchronous result. Do not write code that treats a Promise as an object merely because the service you are constructing is synchronous. After using a container, await `dispose()` to complete disposal. Even though the current service has no external resources, the rule for ending a caller-owned lifecycle remains the same.

Success in a standalone container does not also validate a module's `imports` and `exports`. The code above registers providers directly, so it does not cross the module visibility boundary. Configuration mistakes in the actual app require a separate module experiment.

## Creating a Second Caller Without HTTP

Let us implement the title report that motivated this chapter. Below is the **complete file** for `src/posts-summary.ts`.

```ts
import { Inject, Module } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';
import { PostsModule } from './posts/posts.module';
import { PostsService } from './posts/posts.service';

@Inject(PostsService)
class PostsSummary {
  constructor(private readonly posts: PostsService) { }

  render(): string {
    const rows = this.posts.list();
    return JSON.stringify({
      count: rows.length,
      titles: rows.map((post) => post.title),
    });
  }
}

@Module({
  imports: [PostsModule],
  providers: [PostsSummary],
})
class SummaryModule { }

const context = await FluoFactory.createApplicationContext(SummaryModule);
try {
  const summary = await context.get(PostsSummary);
  console.log(summary.render());
} finally {
  await context.close();
}
```

```bash
pnpm exec vite build --ssr src/posts-summary.ts --outDir dist-summary
node dist-summary/main.js
```

The expected report data is `{"count":1,"titles":["Hello, Fluo!"]}`. No HTTP server is opened. `PostsSummary` uses `PostsService` but knows nothing about the initial-array token. This is the value that `PostsModule`'s public boundary provides to an actual caller.

Now temporarily remove only `PostsService` from `PostsModule`'s `exports` and rebuild. The report module can no longer receive that service through injection, so a module visibility failure should become apparent. Looking only at the relationship between a controller and service inside the same module, by contrast, makes a missing export difficult to detect. Restore the export after observing the failure. The solution is not to duplicate the `PostsService` registration in the report, but for the owning module to provide the public token it intends to expose.

## A Singleton Is Not Storage for the Current User

The fact that a service is shared imposes a design constraint to remember. If `PostsService` stores `currentAuthorId` and overwrites it at the start of every request, two requests can see each other's author information. We do not need request-specific state now because we have only a read-only seed. When user features arrive later, pass the current user through method arguments or an appropriate request boundary rather than temporarily hiding it in a singleton field.

Fluo distinguishes the default singleton scope, request scope for each request, and transient scope for each resolution. Changing every provider to request scope does not automatically solve shared-state problems. It increases the cost of repeated construction, and a singleton depending on a request provider is rejected with `ScopeMismatchError`. Resolving a request provider directly from the root container is also incorrect. A child boundary created with `createRequestScope()` owns the request scope.

Circular dependencies cannot be fixed by renaming them either. If `PostsService` later needs `AccountsService` and a constructor dependency in the opposite direction appears as well, we must reconsider who coordinates which operation. `forwardRef()` can defer lookup of a token that has not yet been declared, but it does not break an actual constructor cycle. Rather than repeatedly attaching deferred references to a relationship that cannot work, moving coordination into a higher-level operation that uses both features makes the responsibilities easier to explain.

The separation in this chapter is not intended to maximize the number of classes. A one-off calculation can remain a function, and small logic with no external collaborators can be tested directly with `new`. DI belongs at configuration boundaries where the application must decide which collaborators to provide and for how long. When we add a shop to the same blog in Volume 2, we will use these boundaries first rather than move every module to a new process.

The current state is clear. `PostsModule` owns the initial data, `PostsService`, and `PostsController`. The controller handles ID binding and error representation; the service handles post queries and copying boundaries. External callers use only the exposed service. In the next chapter, we will establish automated evidence for these contracts through direct-construction tests, real module-graph tests, and virtual HTTP request tests.

## Evidence and Further Reading

- [Module, injection, and scope contracts in core](../../packages/core/README.md), [Public token types](../../packages/core/src/types.ts), [Public exports](../../packages/core/src/index.ts)
- [DI registration, replacement, and lifecycle contracts](../../packages/di/README.md), [Provider types](../../packages/di/src/types.ts), [Error classes](../../packages/di/src/errors.ts), [Container implementation](../../packages/di/src/container.ts)
- [Module assembly and standalone contexts in runtime](../../packages/runtime/README.md), [Module graph implementation](../../packages/runtime/src/module-graph.ts), [Module visibility regression tests](../../packages/runtime/src/module-graph-alias-visibility.test.ts)
- [Test boundaries for scopes and circular dependencies](../../packages/testing/src/module-lifecycle-resolution-regression.test.ts)

[Previous: Serving the First Post over HTTP](./ch02-first-http-route.md) | [Volume 1 contents](./toc.md) | [Next: Developing with Evidence of Behavior](./ch04-testing-from-the-start.md)
