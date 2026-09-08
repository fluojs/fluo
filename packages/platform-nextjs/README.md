# @fluojs/platform-nextjs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Connect an existing Fluo backend to Next.js App Router Route Handlers or Pages
Router API Routes without replacing Fluo's decorators, modules, factory, or
dependency injection.

## Table of Contents

- [Installation](#installation)
- [Shared Setup](#shared-setup)
- [App Router](#app-router)
- [Pages Router](#pages-router)
- [FluoFactory Integration](#fluofactory-integration)
- [Pipeline Compatibility](#pipeline-compatibility)
- [Decorator Compiler Wiring](#decorator-compiler-wiring)
- [Lifecycle](#lifecycle)
- [Process-local application accessor](#process-local-application-accessor)
- [Options](#options)
- [Runtime Contract](#runtime-contract)
- [Public API](#public-api)

## Installation

Supported hosts are Next.js **16.x** (peer `>=16.0.0 <17`) on Node.js
`>=24.0.0 <27`, with `@fluojs/runtime` `>=3.0.0 <4`. Next.js Edge Runtime is
not supported. See the [Node.js support contract](../../docs/reference/node-support.md).

If the application already uses Fluo, add only the adapter:

```bash
pnpm add @fluojs/platform-nextjs
```

For a new Fluo backend inside an existing Next.js application, add the Fluo
packages used by application source as direct dependencies too:

```bash
pnpm add \
  @fluojs/core \
  @fluojs/http \
  @fluojs/runtime \
  @fluojs/platform-nextjs
```

No separate Babel package, loader package, or handwritten decorator options
are required. The adapter ships the Next-specific decorator loader.

## Shared Setup

Enable the packaged decorator transform while preserving the rest of the
existing Next configuration:

```typescript
// next.config.ts
import { withFluoNextBackend } from '@fluojs/platform-nextjs/next-config';

export default withFluoNextBackend({});
```

Keep the existing decorated Fluo module unchanged:

```typescript
// src/app.module.ts
import { Module } from '@fluojs/core';
import {
  Controller,
  Get,
  HttpCode,
  Post,
  type RequestContext,
} from '@fluojs/http';

@Controller('/api')
class ApiController {
  @Get('/health')
  health() {
    return { status: 'ok' };
  }

  @Post('/echo')
  @HttpCode(201)
  echo(_input: undefined, context: RequestContext) {
    return { body: context.request.body };
  }
}

@Module({ controllers: [ApiController] })
export class AppModule {}
```

Create the adapter, pass it to `FluoFactory`, and start the application exactly
like every other Fluo HTTP platform:

```typescript
// src/backend.ts
import { createNextAdapter } from '@fluojs/platform-nextjs';
import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app.module';

export const nextAdapter = createNextAdapter();
export const app = await FluoFactory.create(AppModule, {
  adapter: nextAdapter,
});
await app.listen();
```

## App Router

Add one optional catch-all Route Handler:

```typescript
// app/api/[[...path]]/route.ts
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

Next.js still discovers one filesystem route. Fluo owns decorator metadata,
route matching, module bootstrap, dependency injection, request scope, body
parsing, errors, and controller dispatch behind that facade. Route Handlers
default to the Node.js runtime that Fluo backends require, so no `runtime`
override is needed.

## Pages Router

Create one optional catch-all API Route. The exported config disables Next's
built-in body parser so Fluo receives the original request stream.

```typescript
// pages/api/[[...path]].ts
import {
  createNextPagesRouterHandler,
  type NextPagesRouterConfig,
} from '@fluojs/platform-nextjs/pages-router';

export default createNextPagesRouterHandler(() =>
  import('../../src/backend').then(({ nextAdapter }) => nextAdapter),
);
export const config = {
  api: {
    bodyParser: false,
  },
} satisfies NextPagesRouterConfig;
```

The Pages bridge converts the raw `IncomingMessage` into a Web request, keeps
Fluo body parsing and size limits authoritative, and streams the Web response
back through `ServerResponse`.

Input is read on demand rather than queued ahead of the Fluo parser. An oversized
upload can receive HTTP 413 before it finishes; only after the response is sent
does the bridge discard the remaining input, without taking ownership of the
socket. Raw-body capture preserves the original bytes.

Client disconnects propagate to `context.request.signal` and cancel response
stream reads. A disconnect during lazy bootstrap ends that request without
dispatching it or cancelling the shared backend startup.

## FluoFactory Integration

The Next adapter follows the same platform contract as Fastify and the other
Fluo HTTP adapters. Application code creates the adapter, supplies it to
`FluoFactory.create()`, and calls `app.listen()`. The runtime constructs the
application and dispatcher, then attaches the dispatcher through
`NextHttpApplicationAdapter.listen()`.

The Next adapter does not create the application and does not open a socket.
It only exposes bound Web handlers after the dispatcher is attached, while
Next.js continues to own the HTTP server.

Route facades dynamically import `src/backend.ts` on the first request.
Import completion includes its top-level `FluoFactory.create()` and
`app.listen()`, so handlers cannot observe an unbound adapter. `next build`
compiles the backend chunk without executing that bootstrap.

## Pipeline Compatibility

Both router bridges normalize requests into the same Fluo dispatcher used by
the other HTTP platforms. The full application pipeline remains active:

- request `Cookie` headers and DTO `@FromCookie` binding
- response headers and multiple independent `Set-Cookie` values
- application and module middleware
- guards, interceptors, exception filters, and request observers
- `RequestDto` binding, global converters, and field-level `@Convert`
- request scope, body parsing, multipart handling, and raw body preservation

Fluo does not expose Nest's `Pipe` abstraction under that name. The equivalent
input transformation contract is a global `Converter` supplied to
`FluoFactory.create()` or a field-level `@Convert` on a `RequestDto`.

Next middleware may still rewrite request or response headers before or after
the Route Handler. Fluo controllers read the cookie header that reaches their
handler through `@FromCookie` or `RequestContext`, rather than Next's
component-oriented `cookies()` helper.

App Router and Pages Router are both supported in one hybrid Next application.
Because Next emits them as separate server route bundles, enabling both
catch-alls simultaneously creates one lazy Fluo application per bundle. Use
one catch-all during migration when process-wide singleton state is required,
or host Fluo separately when deterministic single-instance ownership matters.

## Decorator Compiler Wiring

`withFluoNextBackend()` adds the adapter's packaged loader to the server-side
Turbopack `*.ts` rule for application files, excluding browser and dependency
files. The loader applies the same Babel TC39 decorators
`2023-11` transform used by `@fluojs/vite` and returns JavaScript to Turbopack.

The packaged compiler integration supports Turbopack only, not webpack.
Keep decorated backend declarations in `.ts` files; the helper does not add
a `.tsx` rule. See the [compiler tooling table](../../docs/reference/toolchain-contract-matrix.md#build-configuration).

The Vite plugin itself cannot be inserted into Next.js because Vite and
Turbopack have different plugin contracts. The shared compiler recipe is the
reusable part; the adapter provides the Next-specific loader and config object.

Existing `turbopack` options, aliases, and rules are preserved. When an
application already has a `*.ts` rule, the Fluo decorator rule is appended.
The helper returns a new configuration object and does not mutate its input.

## Lifecycle

The backend module performs ordinary Fluo bootstrap once when the first route
request imports it:

```typescript
const nextAdapter = createNextAdapter();
const app = await FluoFactory.create(AppModule, {
  adapter: nextAdapter,
});
await app.listen();
```

The route handler caches one loader promise, so concurrent first requests share
the same backend import and startup. Application code owns the normal Fluo
`Application`. Calling
`Application.close()` runs the standard shutdown lifecycle and closes the
adapter. Requests sent afterward receive HTTP 503 problem JSON.

```typescript
await app.close('manual shutdown');
```

Next.js owns process startup and shutdown. The package does not register
process signal handlers or automatically create a second application after
explicit close.

## Process-local application accessor

Existing lazy handlers retain one Promise per closure. Choose the root export
`defineNextApplication({ key, load })` only when RSC, auth callbacks, and Route
Handlers must use one application in the same JS process and `globalThis`.
The Node/Next/runtime and decorator compiler prerequisites in Shared Setup remain.

| Field | Contract |
| --- | --- |
| Input | Fixed application-owned string `key`, argument-free async `load` |
| Default | Opt-in; existing lazy helpers are unchanged. Definition does not load |
| Output/order | The first invocation claims the key and stores a Promise before running load. Calls with that key return the exact same Promise |
| Failures | Sync throws and async rejections remain cached. Redefining with another loader retains the first result; there is no automatic retry |
| Ownership | The caller owns bootstrap/listen failure cleanup, consumer drain, `app.close()` or context/container disposal. The accessor registers no signals |
| Reload | HMR evaluation does not replace a live graph. After close, the Promise still yields the closed graph. No reset/evict API; restart the host to apply a new bootstrap |
| Isolation | Different keys, processes, workers, serverless instances, and JS globals are isolated. This is not a distributed singleton or a guarantee of one connection |
| Data | Do not capture request/actor/session data in key or load. Only application resource Promises belong in the global cache; pass request data as method arguments or through request scopes |
| Type/identity | All loaders using one key must agree on application type/contract. There is no runtime shape validation or class-name identity inference |

This file reuses `src/backend.ts` above without each bundle implementing its own
global Promise. Route every shared consumer through the accessor; mixing it with
direct backend imports can bootstrap outside this cache.

```typescript
// src/application.ts
import { defineNextApplication } from '@fluojs/platform-nextjs';

export const getApplication = defineNextApplication({
  key: 'my-blog/application/v1',
  load: () => import('./backend'),
});
```

The route facade obtains its adapter from the same graph.

```typescript
// app/api/[[...path]]/route.ts
import { createNextAppRouterHandler } from '@fluojs/platform-nextjs';
import { getApplication } from '../../../src/application';

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } =
  createNextAppRouterHandler(() => getApplication().then(({ nextAdapter }) => nextAdapter));
```

Keep service contracts separate from runtime class imports. Import the following
module from the existing `AppModule`. The owning module registers the provider and
alias once each; tokens injected from other modules must be exported.

```typescript
// src/posts-contract.ts
import { publicToken } from '@fluojs/core';

export interface PostsReader { title(): string }
export const POSTS = publicToken<PostsReader>('my-blog/posts/v1');
```

```typescript
// src/posts.module.ts
import { Module } from '@fluojs/core';
import { POSTS, type PostsReader } from './posts-contract';

class PostsService implements PostsReader {
  title() { return 'FluoBlog'; }
}

@Module({
  providers: [PostsService, { provide: POSTS, useExisting: PostsService }],
  exports: [POSTS],
})
export class PostsModule {}
```

Using this application function from RSC or auth callbacks also removes repeated
`container.resolve` calls and runtime class imports.

```typescript
// src/posts.ts
import { getApplication } from './application';
import { POSTS } from './posts-contract';

export async function getPosts() {
  return (await getApplication()).app.container.resolve(POSTS); // Promise<PostsReader>
}
```

Add aliases/exports only for tokens needing a public boundary. Existing class
token providers are not replaced, and distinct constructors with identical names
are not merged. `Symbol.for(...)` + `useExisting` + `resolve<PostsReader>(...)`
remains the valid manual recipe; `publicToken` only adds inference for that symbol.
Every declaration of one namespace must agree on the service contract.
Cyclic initialization in which load awaits its own accessor is unsupported.

`src/application-accessor.test.ts` covers concurrency, failure, module evaluation,
and pending/failed/successful close. `src/application-public-types.test.ts` compiles
emitted public declarations. `e2e/next.test.mjs` exercises separate RSC/auth/route
evaluations, overlapping initialization, key/process isolation, request-data
separation, and retained close/failure in an actual Next production build.

## Options

```typescript
const nextAdapter = createNextAdapter({
  maxBodySize: 1_048_576,
  rawBody: true,
});
const app = await FluoFactory.create(AppModule, {
  adapter: nextAdapter,
  // Ordinary Fluo CreateApplicationOptions stay here.
});
await app.listen();
```

- `maxBodySize`: non-negative maximum request body size in bytes
- `rawBody`: preserve parsed request bytes on `context.request.rawBody`
- Fluo runtime options remain ordinary `FluoFactory.create()` options

## Runtime Contract

- App Router Route Handlers and Pages Router API Routes
- Next.js 16.x (peer `>=16.0.0 <17`)
- Node.js `>=24.0.0 <27` hosting only; no Edge Runtime
- `@fluojs/runtime` peer `>=3.0.0 <4`
- `withFluoNextBackend()` in `next.config.ts` for Turbopack only
- request-lazy dynamic backend module import
- App Router exports: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`
- Pages Router default `NextApiHandler` export with `bodyParser: false`
- HTTP method availability remains bounded by Next.js routing; the adapter
  does not add `QUERY` or other custom method support beyond that host boundary
- Web-standard `Request` and `Response`
- No raw WebSocket upgrade seam
- No custom server or process signal ownership
- One lazy application per catch-all bundle, not a shared singleton across
  App Router and Pages Router server bundles by default. Explicit sharing follows
  the opt-in `defineNextApplication` contract

Use a Fluo Node or Fastify platform adapter when the application requires raw Node.js transport ownership, WebSocket upgrades, or an independently hosted backend.

## Public API

- `createNextAdapter(options)`: creates the HTTP adapter passed to `FluoFactory.create()`
- `NextAdapterOptions`: adapter-owned request parsing options
- `NextAdapterLoader`: dynamic canonical backend adapter loader
- `defineNextApplication(options)`: process-local application Promise accessor for an explicit key
- `NextApplicationOptions<T>`: application-owned key and async load contract
- `createNextAppRouterHandler(loadAdapter)`: creates method-keyed App Router handler exports (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`) ready for destructuring
- `NextHttpApplicationAdapter`: `HttpApplicationAdapter` with bound `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS` handlers
- `NextAppRouteHandler`: Web request handler type used by those bound methods
- `NextAppRouterMethodHandlers`: method-keyed App Router record returned by `createNextAppRouterHandler()`
- `createNextPagesRouterHandler(loadAdapter)`: creates a request-lazy streaming Pages Router API handler
- `NextPagesRouterConfig`: type-checks the required static `bodyParser: false` literal
- `withFluoNextBackend(config)`: exported from `@fluojs/platform-nextjs/next-config`; adds the packaged Turbopack decorator loader
- `decorators-loader`: packaged loader subpath used by the config helper

## Development Verification

From the repository root:

```bash
pnpm --filter '@fluojs/platform-nextjs...' build
pnpm --filter @fluojs/platform-nextjs typecheck
pnpm --filter @fluojs/platform-nextjs test
pnpm --filter @fluojs/platform-nextjs test:e2e
```

The unit suite includes shared Web portability checks and native Pages transport
regressions. The E2E suite stages package distribution files, builds a real
Next.js application, and verifies both routers over HTTP without source aliases.
