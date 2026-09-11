# Developing with Evidence of Behavior

<!-- book:volume=01-fluoblog;chapter=04 -->

[Previous: Moving Logic Out of the Controller](./ch03-modules-and-di.md) | [Volume 1 contents](./toc.md) | [Next: What Makes a Draft Different from a Published Post?](./ch05-post-domain.md)

## Read-Only Features Can Regress Too

Because FluoBlog has no write API yet, it is easy to assume that its data cannot be changed incorrectly. But imagine the operator changing a title in a query result while formatting the title report. If the service returned its internal object directly, the next HTTP request would receive the changed title too. The post would have changed even though we never built a post-editing feature. This is why we introduced copying boundaries in the previous chapter.

Manually opening `/posts/1` once will not uncover this problem. The defect appears only when you change the query result and then read it again. Tests are valuable not just for confirming success repeatedly, but for recording the specific manipulation and observation that expose a failure we want to prevent. When code changes, a good test tells us not merely that something is different, but that callers can now alter the service's data.

We start from the current structure. `PostsService` owns a copy of the list injected through `INITIAL_POSTS` and returns further copies from `list()` and `findById()`. `PostsModule` registers the service and controller and exports the service. `PostsController` parses IDs and represents a missing post as `404`. Tests ask questions of each of these boundaries, but we do not answer every question by starting a server.

The code in this chapter consists of tests to add to the generated project. Preserve the greeting tests and existing app tests created by the CLI. Put the new post checks in `src/posts/` and `test/posts.e2e.test.ts`. Do not delete existing tests merely to make the new test results look better. The text provides files to write, execution procedures, and expected failures; it does not claim that this new test suite was run and passed during the writing of the manuscript.

## Tests Use the Same Decorator Language

Before writing tests, check the generated configuration. Continue using Node.js 24 and pnpm 10, with Vitest from the 4 series used by the current starter. `@fluojs/testing` helps with application configuration and request testing, but it is not the test runner itself. Vitest and the Babel dependencies must be installed.

```bash
pnpm add -D @babel/core @babel/plugin-proposal-decorators @babel/preset-typescript @fluojs/testing @fluojs/vite vitest
```

Below is the **complete configuration file** for `vitest.config.ts`. If the generated file matches, leave it as it is.

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin({ sourceMaps: true, transformBoundary: 'test' })],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['@fluojs/core/metadata-preload'],
  },
});
```

The following is the **complete file** for `babel.config.cjs` in the same project root.

```js
module.exports = {
  presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
  plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
};
```

The canonical plugin transforms standard decorators for application and test modules. Module classes declared inside tests need the same transformation, and metadata must preload before they evaluate. If an older configuration excluded `src/**/*.test.ts` from Babel processing, do not retain that exclusion. Interpreting a test file that cannot even be parsed as a DI failure or a business-rule failure sends diagnosis in the wrong direction.

Test mode and application mode share the same `@fluojs/vite` implementation. Enabling `experimentalDecorators` only in tests, or introducing a different reflection mechanism there, can change the meaning of the tested classes relative to the classes actually run.

## The Smallest Test: Can a Caller Change the Data?

The service's copying policy has nothing to do with the network. Constructing the class directly makes every input needed by a test visible. The following is the **complete file** for `src/posts/posts.service.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import type { Post } from './post';
import { PostsService } from './posts.service';

function makeSeed(): Post[] {
  return [{ id: 1, title: 'Hello, Fluo!', content: 'My first post.' }];
}

describe('PostsService', () => {
  it('keeps a snapshot of the constructor input', () => {
    const seed = makeSeed();
    const service = new PostsService(seed);
    seed[0].title = 'Changed outside the service';
    seed.push({ id: 2, title: 'Another post', content: 'Outside data.' });

    expect(service.list()).toEqual(makeSeed());
  });

  it('does not expose its stored rows through list results', () => {
    const service = new PostsService(makeSeed());
    const rows = service.list();
    rows[0].title = 'Changed by a reader';
    rows.pop();

    expect(service.list()).toEqual(makeSeed());
  });

  it('does not expose its stored row through detail results', () => {
    const service = new PostsService(makeSeed());
    const post = service.findById(1);
    if (!post) {
      throw new Error('Expected the seeded post.');
    }
    post.content = 'Changed by a reader';

    expect(service.findById(1)).toEqual(makeSeed()[0]);
  });

  it('distinguishes an empty collection from a missing row', () => {
    const service = new PostsService([]);

    expect(service.list()).toEqual([]);
    expect(service.findById(1)).toBeUndefined();
  });

  it('does not substitute another post for a missing id', () => {
    const service = new PostsService(makeSeed());

    expect(service.findById(999)).toBeUndefined();
  });
});
```

Each test creates a new seed and a new service. Reusing a single global array across tests could make one test's changes become the next test's starting conditions. If you have to remember the order in which tests succeeded, they are not sufficiently isolated. `makeSeed()` is not a generic fixture tool intended to abstract the implementation; it is a small function that supplies the same reference data as fresh objects each time.

The first test attempts both to modify an object in the input array and to add an item. The second changes both a returned object's field and the returned array itself. It can therefore catch an accidental implementation that creates only a new array while still returning the original objects. The third checks the detail-query boundary separately. Safety of list results does not imply safety of detail results.

Let us also try a small experiment in which we can observe the failure. If we were at the point of first extracting the service in the previous chapter, we would write and run the second test first. If the correct implementation is already complete, temporarily replace only `PostsService.list()` with the following **incorrect method fragment**. Leave the other fields and methods in the previous chapter's service as they are.

```ts
list(): Post[] {
  return this.posts;
}
```

```bash
pnpm exec vitest run src/posts/posts.service.test.ts
```

Because an item was removed from the returned array, the list read again will differ from the seed, and the corresponding test should fail. If it fails because of an import error or decorator syntax error, we have not yet observed the intended failure. Fix the cause until the test reaches the point of failing because of data exposure, then restore the previous chapter's implementation that uses `map` and object copies. Running the same test again against the correct code should show that this regression is prevented.

This test does not insist that the service must use `map()` internally. A later switch to another data structure can still pass if it preserves the same observable results. That is why the test is more resilient to change than inspecting private fields or fixing the call count of a particular internal helper.

## Verify the Input Boundary with a Table

Not every string that looks numeric is a valid post ID. The previous chapter's `parsePostId()` checked positive decimal integer notation and the safe integer range. A short table-driven test can verify this policy quickly. The following is the **complete file** for `src/posts/post-id.test.ts`.

```ts
import { BadRequestException } from '@fluojs/http';
import { describe, expect, it } from 'vitest';
import { parsePostId } from './post-id';

describe('parsePostId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('accepts %s as %s', (input, expected) => {
    expect(parsePostId(input)).toBe(expected);
  });

  it.each([
    '',
    '0',
    '-1',
    '01',
    '1.5',
    '1garbage',
    ' 1',
    '1e3',
    '9007199254740992',
  ])('rejects %j', (input) => {
    expect(() => parsePostId(input)).toThrow(BadRequestException);
  });
});
```

The rejection cases do not repeat the same failure nine times. They represent distinct boundaries: empty input, the lower bound, negative numbers, noncanonical notation, fractions, partial parsing, whitespace, exponential notation, and excess precision. We check the classification `BadRequestException` without pinning the exact spelling of a human-readable error sentence. If the API operates on error codes rather than wording, the tests should follow that contract too.

This test alone does not prove an HTTP `400` response. Even if the function throws the right exception, the request result can differ if the controller does not call it or the exception never reaches the dispatcher. Conversely, putting every string combination into HTTP tests incurs the cost of repeatedly assembling the app just to find a small conversion bug. This is why combinations belong in fast function tests while representative failures remain in HTTP tests.

## Module Tests: Check the Same Assembly, Not Just the Same Classes

A direct-construction test can pass even with an incorrect `@Inject` because the test code manually supplies the correct constructor arguments. A missing service export from `PostsModule` does not affect direct construction either. Tests that compile the real module graph cover this gap.

The following is the **complete file** for `src/posts/posts.slice.test.ts`. A test-only consumer also checks that the service can be injected outside `PostsModule`.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  createTestingModule,
  type TestingModuleRef,
} from '@fluojs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { Post } from './post';
import { INITIAL_POSTS } from './post.tokens';
import { PostsModule } from './posts.module';
import { PostsService } from './posts.service';

@Inject(PostsService)
class PostsConsumer {
  constructor(private readonly posts: PostsService) {}

  count(): number {
    return this.posts.list().length;
  }
}

@Module({
  imports: [PostsModule],
  providers: [PostsConsumer],
})
class PostsSliceModule {}

describe('PostsModule', () => {
  let module: TestingModuleRef | undefined;

  afterEach(async () => {
    const owned = module;
    module = undefined;
    await owned?.container.dispose();
  });

  it('exports a service that an importing module can inject', async () => {
    module = await createTestingModule({
      rootModule: PostsSliceModule,
    }).compile();

    const consumer = await module.resolve(PostsConsumer);
    expect(consumer.count()).toBe(1);
  });

  it('accepts an empty seed through a pre-compile override', async () => {
    module = await createTestingModule({
      rootModule: PostsSliceModule,
    })
      .overrideProvider<readonly Post[]>(INITIAL_POSTS)
      .useValue([])
      .compile();

    const consumer = await module.resolve(PostsConsumer);
    expect(consumer.count()).toBe(0);
  });
});
```

The purpose of a dedicated root module is not to copy the production `PostsModule`. It is to create a consumer that imports the real module and crosses the export boundary. Reassembling the service and seed through a new `providers` list inside the test could miss a registration absent from the production module. Importing the actual owning module unchanged is what matters.

The second test replaces only the value of `INITIAL_POSTS`. It does not fake `PostsService` itself, so the real service and injection relationship continue to run. The replacement happens before `compile()`. Changing an input during configuration rather than directly modifying an already constructed service makes the test's starting state and lifecycle explicit.

`afterEach` disposes of the container successfully returned to the test, whether the test succeeds or fails. It first detaches ownership from the variable and then awaits `dispose()`, so the old reference is not left for the next test. This file assumes the sequential execution of ordinary `it` tests; do not change them to `it.concurrent` while retaining a shared variable. Parallelizing the tests also requires changing the structure so that each test independently owns its container reference and disposal.

If `compile()` itself fails before returning a reference, the builder owns disposal of the internal container. If initialization and disposal both fail, an `AggregateError` preserving both failures may be reported. After a successful return, disposal belongs to the caller. Catching a failure and replacing it with an empty object, or ignoring a disposal error, can therefore allow the next test to begin in a broken test environment.

The failure experiment for this boundary is to remove `PostsService` temporarily from `PostsModule.exports`. The direct-construction tests may keep passing, but the first slice test should fail because it cannot assemble the consumer's dependency. Restore the export and check again. Observing this difference makes it clear that test layers detect different omissions rather than repeat the same check.

## HTTP Tests: Send a Request Instead of Calling a Controller Method

Now we check the contract for a reader using the app. `createTestApp()` from `@fluojs/testing` assembles the real runtime dispatcher without opening a TCP port. `app.request(...).send()` delivers a virtual request and returns the status, headers, and body. Unlike a direct call to `controller.get({ id: '1' })`, this executes route selection, DTO binding, and error-response writing together.

Below is the **complete file** for `test/posts.e2e.test.ts`.

```ts
import { createTestApp, type TestApp } from '@fluojs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app';

const expected = { id: 1, title: 'Hello, Fluo!', content: 'My first post.' };

describe('Post HTTP contract', () => {
  let app: TestApp | undefined;

  afterEach(async () => {
    const owned = app;
    app = undefined;
    await owned?.close();
  });

  it('returns a collection and the same post as a detail object', async () => {
    app = await createTestApp({ rootModule: AppModule });

    const list = await app.request('GET', '/posts').send();
    const detail = await app.request('GET', '/posts/1').send();

    expect(list.status).toBe(200);
    expect(list.body).toEqual([expected]);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual(expected);
  });

  it.each([
    ['/posts/999', 404, 'NOT_FOUND'],
    ['/posts/1garbage', 400, 'BAD_REQUEST'],
    ['/posts/9007199254740992', 400, 'BAD_REQUEST'],
  ])('maps %s to %s and %s', async (path, status, code) => {
    app = await createTestApp({ rootModule: AppModule });

    const response = await app.request('GET', path).send();

    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({
      error: { status, code },
    });
  });

  it('keeps independent read requests consistent', async () => {
    app = await createTestApp({ rootModule: AppModule });

    const responses = await Promise.all([
      app.request('GET', '/posts/1').send(),
      app.request('GET', '/posts/1').send(),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body).toEqual(expected);
    }
  });
});
```

This file also creates a fresh app for each test and closes it in `afterEach`. Sending invalid input in one test must not change the next test's data. The library supplies the request builder and response types, so we do not manually populate fake `FrameworkRequest` and `FrameworkResponse` objects. Those low-level representations are boundaries needed when developing an adapter or the dispatcher itself.

The error checks verify both the HTTP status and the machine-readable fields in the body. A response with `NOT_FOUND` in its body but status `200` must fail. Wrapping the list in an object or turning the detail into an array also makes the first test fail. These values are data contracts distinguished by actual API consumers, so they are worth fixing in tests.

The concurrent-read check verifies that requests using the same service return the expected seed. It does not, however, validate future concurrent post edits or database transactions. The current implementation has no writes to coordinate between requests. Merely using `Promise.all()` is not proof of safety under contention. When concurrent editing becomes a requirement, we will need separate tests that explicitly control events such as the point at which two operations have read the same version.

## Locate the Failure, Then Move Up to the Surface You Need

After writing the four files, run only the new post tests once with the following command.

```bash
pnpm exec vitest run \
  src/posts/posts.service.test.ts \
  src/posts/post-id.test.ts \
  src/posts/posts.slice.test.ts \
  test/posts.e2e.test.ts
```

The expected result is that all selected tests pass. If a test fails, distinguish the layers. A service-test failure points to copying and query rules. If the service passes but the slice fails, check tokens, providers, and import/export configuration. If both layers pass but HTTP fails, examine route registration, DTOs, and error mapping. This narrows the possible causes instead of sending you back to rewrite the entire app from the start.

Virtual HTTP tests do not open a network connection, so they do not prove behavior involving port conflicts, real Fastify request parsing, or import paths in the execution artifacts. Check those issues by running Chapter 2's `scripts/check-posts.mjs` against a real server. Applying the same check not only to the development path but also to a server started with `pnpm start` after `pnpm build` lets you observe the build and listener boundaries separately.

Do not put fixed waits into tests. Instead of pausing for a few hundred milliseconds with `await new Promise(...)` and assuming things are probably ready, await the Promises returned by `compile()`, `createTestApp()`, `send()`, and `close()`. Each represents a concrete completion event. When testing asynchronous work later, prepare the completion event or a controllable Promise before starting the operation as well. Use timeouts only as failure bounds, and do not leave the successful ordering of events to chance.

Using many mocks is not the same as good isolation. Replacing both the controller and service with fakes while testing an HTTP contract can miss actual binding failures or omitted calls. The current tests have no external network or database, so using real collaborators costs little. When external dependencies appear, replace only those boundaries with explicit test doubles and record that separate real-integration checks are still required.

Nor does every function need a direct test. Fixing the call order of private helpers forces large-scale test changes the moment you adopt a better implementation. Observable contracts such as the current input copies, result copies, module visibility, and status codes, by contrast, remain valid across implementation changes. Explaining which regressions a test can detect is more useful than fixing error wording or internal line counts merely to raise a coverage number.

## A Small Safety Net Ready for the Next Feature

FluoBlog now has a small read-only feature and a safety net that distinguishes and verifies its behaviors. Running the program is still necessary, but people no longer need to remember every possible failure each time. Appropriate tests report configuration mistakes, input mistakes, and data exposure separately. We can also interpret passing tests within the limits of what those tests actually observed.

In the next chapter, the operator wants to save a post that is not finished yet. Listing every post as we do now could expose drafts to readers. We need new contracts for `status`, publication rules, and which posts queries should return. Rather than removing existing tests, we will keep the HTTP, DI, and copying contracts that remain valid and begin adding the new state rules with the smallest tests. This is where development starts to broaden the product's meaning while preserving the success of the first post.

## Evidence and Further Reading

- [The official testing path and TDD layers](../../packages/testing/README.md), [Public exports](../../packages/testing/src/index.ts), [Testing requirements contract](../../docs/contracts/testing-guide.md)
- [Virtual app implementation](../../packages/testing/src/app.ts), [Request builder and response types](../../packages/testing/src/http.ts), [Public app and module types](../../packages/testing/src/types.ts)
- [Module builder implementation](../../packages/testing/src/module.ts), [Compilation failure and disposal regression tests](../../packages/testing/src/module.compile-failure.test.ts)
- [Vite decorator transform boundary](../../packages/vite/README.md#decorator-transform-boundary), [Decorator transform implementation](../../packages/vite/src/decorators-plugin.ts)

[Previous: Moving Logic Out of the Controller](./ch03-modules-and-di.md) | [Volume 1 contents](./toc.md) | [Next: What Makes a Draft Different from a Published Post?](./ch05-post-domain.md)
