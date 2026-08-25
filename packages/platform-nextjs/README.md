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
- [Options](#options)
- [Runtime Contract](#runtime-contract)
- [Public API](#public-api)

## Installation

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

export const runtime = 'nodejs';

const handler = createNextAppRouterHandler(() =>
  import('../../../src/backend').then(({ nextAdapter }) => nextAdapter),
);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
```

Next.js still discovers one filesystem route. Fluo owns decorator metadata,
route matching, module bootstrap, dependency injection, request scope, body
parsing, errors, and controller dispatch behind that facade.

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
Turbopack TypeScript rule. The loader applies the same Babel TC39 decorators
`2023-11` transform used by `@fluojs/vite` and returns JavaScript to Turbopack.

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
- Next.js 16 or newer
- Node.js runtime only
- `withFluoNextBackend()` in `next.config.ts`
- request-lazy dynamic backend module import
- App Router exports: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`
- Pages Router default `NextApiHandler` export with `bodyParser: false`
- Web-standard `Request` and `Response`
- No raw WebSocket upgrade seam
- No custom server or process signal ownership
- One catch-all bundle and route configuration boundary

Use a Fluo Node or Fastify platform adapter when the application requires raw Node.js transport ownership, WebSocket upgrades, or an independently hosted backend.

## Public API

- `createNextAdapter(options)`: creates the HTTP adapter passed to `FluoFactory.create()`
- `NextAdapterOptions`: adapter-owned request parsing options
- `NextAdapterLoader`: dynamic canonical backend adapter loader
- `createNextAppRouterHandler(loadAdapter)`: creates a request-lazy App Router handler
- `NextHttpApplicationAdapter`: `HttpApplicationAdapter` with bound `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS` handlers
- `NextAppRouteHandler`: Web request handler type used by those bound methods
- `createNextPagesRouterHandler(loadAdapter)`: creates a request-lazy streaming Pages Router API handler
- `NextPagesRouterConfig`: type-checks the required static `bodyParser: false` literal
- `withFluoNextBackend(config)`: exported from `@fluojs/platform-nextjs/next-config`; adds the packaged Turbopack decorator loader
- `decorators-loader`: packaged loader subpath used by the config helper
