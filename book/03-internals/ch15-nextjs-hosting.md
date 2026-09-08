# Running Fluo Inside Next.js

<!-- book:volume=03-internals;chapter=15 -->

[Previous: Moving to Fetch-Based Runtimes](./ch14-fetch-adapters.md) | [Contents](./toc.md) | [Next: Building Your Own Adapter and Verifying Its Contract](./ch16-custom-adapter.md)

## Moving the UI Does Not Change the Order Service

A new designer has joined the shop that began as FluoBlog. The team wants to build the blog introduction and product screens in Next.js, which they already have experience operating. But they do not want to rewrite the code that derives an order's `customerId` from the authenticated user, or the inventory reservation and payment boundaries, in every Next Route Handler. They need a way to connect the existing Fluo module graph behind the HTTP server owned by Next, not a second shop backend.

As with the Worker in the previous chapter, the host passes in a `Request` and Fluo creates a `Response`. Next.js, however, is not a Worker. The supported combination is Node.js `>=24.0.0 <27`, Next.js 16.x, and runtime 3.x. This chapter uses Node24 and pnpm10 as its baseline. Edge Runtime, webpack integration, and raw WebSocket upgrades are outside this adapter's contract. The presence of the Fetch API is not grounds for assuming those features are available too.

Keeping the same product does not mean that modules are necessarily shared as singletons in the same process. Multiple deployment instances mean multiple applications. Enabling both Next's App Router and Pages Router catch-alls can create lazy applications in separate server route bundles. If order idempotency was implemented with a single in-memory `Set`, the problem would surface here, but its cause would be the wrong persistence boundary, not the adapter.

This chapter reuses `PostsModule` and `PostsReader` from Chapter 13. It does not assume a repository containing a finished shop at every step. Nor is it a sequential deployment instruction to delete Chapter 14's Worker experiment and migrate entirely to Next. It is an alternative path for comparing the same projection under another host. Authentication and payment providers are not needed for the public-post experiment, so we do not fill their places with fake authentication.

## Draw the Boundary Between the File Router and the Fluo Router

Next discovers a file, and Fluo interprets its own route metadata behind that file. When `/api/posts/1` arrives, Next's `app/api/[[...path]]/route.ts` receives the request. Fluo's `/api/posts/:id` is then selected. The catch-all does not automatically strip `/api`. If you keep the existing `/posts` controller and expect it to match `/api/posts/1`, the result is a 404.

The `/api` prefix in this chapter is an explicit choice for the Next hosting experiment. It is not an instruction to silently change the existing blog page addresses or production API addresses. In a real migration, decide whether Next pages, a reverse proxy, or an explicit redirect policy will preserve existing external addresses. Here, the Fluo routes also include the full `/api` path to expose the boundary between file routing and the dispatcher.

First, the following is the complete `next.config.ts`. If you have an existing Next configuration, preserve it by passing that object to the helper.

```typescript
import { withFluoNextBackend } from '@fluojs/platform-nextjs/next-config';

export default withFluoNextBackend({});
```

The helper adds a packaged Turbopack decorator loader for the server application's `*.ts` files. Browser and dependency files are excluded. It uses the same TC39 `2023-11` transformation recipe, but does not plug a Vite plugin into Next. Do not arbitrarily add another Babel loader or enable legacy decorator flags. If a `*.ts` rule already exists, the helper adds the Fluo rule while preserving the rule configuration, rather than destructively modifying the configuration object.

Put decorated classes in `.ts` files. Expecting the loader to transform UI JSX files with a `.tsx` extension changes the build boundary. The following example writes the React page with `createElement()` specifically to honor this constraint. You can also move actual UI components into separate, undecorated `.tsx` files and call them from a `.ts` router.

## Connect the API and a Printable Document to the Same Provider

Next screens and `@fluojs/react` have different roles. Next renders its own `page.tsx`. The `@Router` and `@Path` decorators in `@fluojs/react` declare pages on top of Fluo HTTP metadata. They do not replace Next's file router, nor do they automatically bring in Next's RSC or Server Actions system.

Why, then, use Fluo React inside Next? It is useful when retaining existing Fluo pages during a gradual migration or serving independent HTML documents that use the same services, guards, and request scope. Here we create a printable blog post. The following is the complete `src/app.ts` used in place of Chapter 13's experimental root. It still requires `PostsModule`, `PostsReader`, and `PublicPost` from `src/posts/posts.module.ts`.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import {
  createReactServerEntry,
  Path,
  ReactModule,
  Router,
  type ReactPageRenderer,
} from '@fluojs/react';
import { createElement } from 'react';
import { PostsModule, PostsReader } from './posts/posts.module';

@Inject(PostsReader)
@Controller('/api/posts')
class ApiPostsController {
  constructor(private readonly posts: PostsReader) {}

  @Get('/:id')
  show(_input: undefined, context: RequestContext) {
    return this.posts.findPublished(context.request.params.id);
  }
}

@Inject(PostsReader)
@Router('/api/print/posts')
class PostPrintRouter {
  constructor(private readonly posts: PostsReader) {}

  @Path('/:id')
  show(_input: undefined, context: RequestContext) {
    const post = this.posts.findPublished(context.request.params.id);
    return createElement(
      'article',
      { 'data-post-id': String(post.id), 'data-version': String(post.version) },
      createElement('h1', null, post.title),
      createElement('p', null, post.content),
    );
  }
}

const renderPage: ReactPageRenderer = (page) =>
  createReactServerEntry(
    createElement(
      'html',
      { lang: 'en' },
      createElement(
        'head',
        null,
        createElement('meta', { charSet: 'utf-8' }),
        createElement('title', null, 'FluoBlog printable post'),
      ),
      createElement('body', null, page),
    ),
  );

@Module({
  imports: [
    PostsModule,
    ReactModule.forRoot({
      imports: [PostsModule],
      controllers: [PostPrintRouter],
      renderPage,
    }),
  ],
  controllers: [ApiPostsController],
})
export class AppModule {}
```

There are two kinds of explicit registration here. The root API controller sees the exports of `PostsModule` imported by the root, while the React router sees the same token through the `imports` inside `ReactModule.forRoot()`. The presence of a provider in a parent module does not justify omitting child-module visibility. We also avoid registering `PostsReader` again in each controller's `providers`, which would create two caches.

`renderPage` is an application-owned renderer. It takes a single `ReactElement`, builds a document shell, and returns a `ReactServerEntry`. `ReactModule.forRoot()` registers this renderer under a token and connects it to the existing HTTP pipeline. An API controller returning JSON does not enter React rendering. Conversely, returning a React element without a renderer produces the `react-ssr-missing-page-renderer` diagnostic, not automatic HTML.

This is deliberately a printable SSR document without hydration. Do not put an imaginary `/assets/client.js` into the React renderer. To preserve actual interactivity, you must separately configure an existing client bundle and a matching document tree. There is no feature that makes the Fluo renderer discover a Next page's hydration assets automatically. Before adding state-changing UI such as an order button to this example, decide whether Next or Fluo owns the document.

## Expose the Adapter Only After Lazy Bootstrap Completes

The following is the complete `src/backend.ts`. The adapter does not create the application. The runtime constructs the module graph and DI, then connects the dispatcher to the adapter through `app.listen()`.

```typescript
import { createNextAdapter } from '@fluojs/platform-nextjs';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app';

export const nextAdapter = createNextAdapter({
  maxBodySize: 1_048_576,
  rawBody: true,
});

export const app = await FluoFactory.create(AppModule, {
  adapter: nextAdapter,
});
await app.listen();
```

Here, `listen()` does not open a port. Next owns the socket, and the adapter provides a bound Web handler. Putting Chapter 13's `runFastifyApplication()` in this file creates an unnecessary second server and signal owner. This is why simply importing the existing main file fails as an approach.

The following complete `app/api/[[...path]]/route.ts` dynamically imports the backend on the first request. The `../../../src/backend` path goes up three levels from this file's directory to the project root.

```typescript
import { createNextAppRouterHandler } from '@fluojs/platform-nextjs/app-router';

export const {
  GET,
  POST,
  PUT,
  PATCH,
  DELETE,
  HEAD,
  OPTIONS,
} = createNextAppRouterHandler(() =>
  import('../../../src/backend').then(({ nextAdapter }) => nextAdapter),
);
```

The dynamic import resolves only after the top-level bootstrap and listen in `backend.ts` have completed. This avoids a window in which the facade receives an adapter not yet connected to the dispatcher. Multiple first requests share one loader promise. `next build` compiles the backend chunk but does not execute this lazy bootstrap, so a successful build is different from a successful database connection or production configuration validation.

The current lazy resolver caches the loader promise. Do not interpret it as a retry loop that runs a failed loader again for every request. If the first bootstrap fails because of a configuration error, correct the cause and use the host's restart or redeployment boundary. Trying to hide the failure by calling `FluoFactory.create()` on every request repeats module initialization and resource creation even for normal requests.

A new Next experiment app needs the following complete `app/layout.tsx`. Keep the original layout in an existing Next app.

```tsx
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
```

The following complete `app/page.tsx` provides an entry point for opening both boundaries in a browser.

```tsx
export default function Home() {
  return (
    <main>
      <h1>FluoBlog shop</h1>
      <ul>
        <li><a href="/api/posts/1">Read post JSON</a></li>
        <li><a href="/api/print/posts/1">Open printable post</a></li>
      </ul>
    </main>
  );
}
```

The print link is an independent HTTP navigation, not a component call that inserts an HTML document into the Next layout. Because ownership of the full-document response is separate, Next's layout and Fluo's `<html>` do not become nested. Preserving this distinction also makes it possible to describe a gradual migration that retains some existing Fluo pages.

## Test Concurrent First Requests and Requests After Close

The following complete `src/next-adapter.test.ts` assumes the earlier `AppModule` and the current Fluo standard-decorator Vitest configuration. It tests the public interfaces of the adapter and lazy facade without opening a Next server. An existing test configuration using the decorator plugin from `@fluojs/testing/vitest` is required; the Next config helper does not replace Vitest's transformation.

```typescript
import { createNextAdapter, createNextAppRouterHandler } from '@fluojs/platform-nextjs';
import { FluoFactory } from '@fluojs/runtime';
import { expect, it } from 'vitest';
import { AppModule } from './app';

it('shares one loader and keeps explicit close terminal at the facade', async () => {
  const adapter = createNextAdapter();
  const app = await FluoFactory.create(AppModule, { adapter });
  let loads = 0;

  try {
    await app.listen();
    const handlers = createNextAppRouterHandler(async () => {
      loads += 1;
      return adapter;
    });
    const [left, right] = await Promise.all([
      handlers.GET(new Request('http://next.test/api/posts/1')),
      handlers.GET(new Request('http://next.test/api/posts/1')),
    ]);
    expect(loads).toBe(1);

    for (const response of [left, right]) {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')?.split(';')[0])
        .toBe('application/json');
      expect(await response.json()).toEqual({
        id: 1,
        title: 'Hello, Fluo!',
        content: 'My first post.',
        slug: 'hello-fluo',
        version: 2,
        publishedAt: '2026-09-01T00:00:00.000Z',
      });
    }

    const print = await handlers.GET(
      new Request('http://next.test/api/print/posts/1'),
    );
    expect(print.status).toBe(200);
    expect(print.headers.get('content-type')?.split(';')[0]).toBe('text/html');
    await print.text();

    await app.close('test shutdown');
    const closed = await handlers.GET(
      new Request('http://next.test/api/posts/1'),
    );
    expect(loads).toBe(1);
    expect(closed.status).toBe(503);
    expect(closed.headers.get('content-type')).toBe('application/problem+json');
    expect(await closed.json()).toEqual({
      code: 'next_backend_adapter_closed',
      status: 503,
      title: 'Next backend adapter is closed',
      type: 'https://fluo.dev/problems/next-backend-adapter-closed',
    });
  } finally {
    await app.close();
  }
});
```

This test checks that two concurrent requests execute the loader only once, receive the same actual JSON, and return 503 problem JSON after an explicit close. It does not insert a sleep to manufacture concurrency between the first requests. Starting both promises before awaiting them together directly exposes whether they share the loader cache.

The HTML test in this code checks only the status, media type, and consumption of the body. For the actual contents of the printable document, open `/api/print/posts/1` on the Next development server and inspect `article[data-post-id="1"][data-version="2"]`, the title, and the content in the DOM. Do not claim that HTML structure and React rendering have been verified merely because the JSON API test is green. The missing resources `/api/posts/999` and `/api/print/posts/999` should both return 404; do not expect the latter to return a special HTML error document without configuring one.

Verify the actual host through Next 16's Turbopack development and deployment paths. After starting the application with `pnpm exec next dev`, you can send the following requests. These are reproduction commands, not results of a run already performed.

```bash
curl -i http://127.0.0.1:3000/api/posts/1
curl -i http://127.0.0.1:3000/api/print/posts/1
curl -i http://127.0.0.1:3000/api/posts/999
```

For deployment approval, repeat the checks on the actual server after `next build`. The package E2E builds a Next app from distribution files and verifies both routers over HTTP without source aliases. The test without a listener in this chapter does not replace that evidence. In particular, do not conclude that Next's file router accepts `QUERY` just because the adapter's `fetch` function handles a custom method. The App Router exports the seven methods listed above; the adapter does not expand the host's limits.

## Preserve Stream Ownership When Retaining the Pages Router

If the existing shop administration UI uses the Pages Router, use the following complete `pages/api/[[...path]].ts` instead of the App Router catch-all. Do not enable both catch-alls at the same migration step.

```typescript
import {
  createNextPagesRouterHandler,
  type NextPagesRouterConfig,
} from '@fluojs/platform-nextjs/pages-router';

export default createNextPagesRouterHandler(() =>
  import('../../src/backend').then(({ nextAdapter }) => nextAdapter),
);

export const config = {
  api: { bodyParser: false },
} satisfies NextPagesRouterConfig;
```

`bodyParser: false` is a declaration of ownership over the original stream, not a performance preference. If Next parses JSON first, it changes Fluo's byte-exact raw-body capture and bounded-read boundary. The Pages bridge converts `IncomingMessage` into a Web request and reads it when needed, then streams the Web response to `ServerResponse`. It can send 413 for an oversized upload before reading it to the end, and drains the remaining input after sending the response. The bridge does not take ownership of the socket.

To reuse Chapter 13's webhook instrument on this path, explicitly set its route to `/api/payments/webhooks` and compare the same byte-array receipt. This is an additional experiment that connects the earlier controller with the correct prefix, not a feature claimed to be already registered in the current `AppModule`. Checking whether removing `bodyParser: false` breaks the original-byte contract reveals why that configuration line is needed.

Another failure occurs when the browser cancels a request during lazy bootstrap. The Pages bridge terminates that request without dispatching it, but does not cancel shared backend startup. One customer's disconnected connection must not disrupt initialization for other customers waiting concurrently. Cancellation of an active response stream propagates to `context.request.signal` and response reader cancellation. Native Pages transport tests cover this behavior; matching JSON from a simple `fetch` call does not establish it.

## Choose Not to Add More Deployment and Rendering Owners

The Next adapter does not register process signal handlers. After `app.close()`, the same facade keeps returning 503 instead of automatically creating a new application. This differs from the restart after a successful Worker lazy close in Chapter 14. Rather than generalize shutdown policy into a single shared helper call, document what the host owns.

Singleton sharing between App Router and Pages Router bundles is not guaranteed either. Importing the same file in a test and receiving the same instance is not evidence for the deployment model. If you need deterministic ownership of a single backend instance or raw WebSocket upgrades, keeping a separate backend with a Fastify or Node adapter is clearer. Using Next does not require pulling an already-working order server inside it.

The same applies to `@fluojs/react`. If Next owns all screens, Fluo can provide only a JSON API. Register a renderer alongside it only when there is a concrete reason to retain existing Fluo HTML pages. This chapter's printable document uses the stable SSR path and does not mix an experimental RSC subpath with Next's Flight implementation. Ownership of responses, assets, and navigation matters more than their shared React name.

We have now seen enough of what an adapter should and should not do. In the next chapter, instead of creating a new web framework, we build a small host-owned adapter that reuses the existing Web factory. We then use tests to examine the difference between "it compiles" and "it honors the contract."

## Evidence and Reproduction Scope

- [Next.js README](../../packages/platform-nextjs/README.md), [public exports](../../packages/platform-nextjs/src/index.ts), [package subpaths and peer ranges](../../packages/platform-nextjs/package.json).
- [Next adapter implementation](../../packages/platform-nextjs/src/adapter.ts), [lazy loader cache](../../packages/platform-nextjs/src/lazy-adapter.ts), [config helper](../../packages/platform-nextjs/src/next-config.ts).
- [Pages bridge](../../packages/platform-nextjs/src/pages-bridge.ts), [Pages transport tests](../../packages/platform-nextjs/src/pages-bridge.test.ts), [Web portability tests](../../packages/platform-nextjs/src/portability.test.ts), [actual Next E2E](../../packages/platform-nextjs/e2e/next.test.mjs).
- [React README](../../packages/react/README.md), [public exports](../../packages/react/src/index.ts), [ReactModule registration](../../packages/react/src/module.ts), [dispatcher SSR tests](../../packages/react/src/dispatcher-ssr.test.ts).

The tests and browser procedures in this chapter are reproduction material with explicit expected results. They do not claim that a new Next app's build, browser, or deployment verification was run and passed while writing the manuscript.

[Previous: Moving to Fetch-Based Runtimes](./ch14-fetch-adapters.md) | [Contents](./toc.md) | [Next: Building Your Own Adapter and Verifying Its Contract](./ch16-custom-adapter.md)
