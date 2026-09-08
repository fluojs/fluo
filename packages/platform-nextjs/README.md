# @fluojs/platform-nextjs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Connect an existing Fluo backend to Next.js App Router Route Handlers or Pages
Router API Routes without replacing Fluo's decorators, modules, factory, or
dependency injection.

## Table of Contents

- [Installation](#installation)
- [Shared Setup](#shared-setup)
- [App Router](#app-router)
- [HEAD Routing](#head-routing)
- [Pages Router](#pages-router)
- [FluoFactory Integration](#fluofactory-integration)
- [Pipeline Compatibility](#pipeline-compatibility)
- [Decorator Compiler Wiring](#decorator-compiler-wiring)
- [Lifecycle](#lifecycle)
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

## HEAD Routing

Opt in at adapter construction when a GET-only Fluo route should answer Next's
automatic HEAD as well as an explicit `HEAD` export:

```typescript
import { createNextAdapter } from '@fluojs/platform-nextjs';

export const nextAdapter = createNextAdapter({
  headRouting: 'explicit-or-get',
});
```

Omission preserves existing method matching: a GET-only Fluo route does not
implicitly match HEAD. With this option, the shared HTTP matcher selects one
eligible explicit `@Head` route, otherwise `@All`, otherwise `@Get`. Method
priority precedes path specificity across those groups; normal static/parameter
and version rules apply within each group. `ALL` is a method wildcard, not a
path wildcard: Fluo catch-all path grammar remains unsupported.

Selection happens once before module middleware, guards, and the controller.
A route miss returns 404. A selected handler's 404 is final and never triggers
another dispatch. Application middleware, module middleware, guards, and
controller each run at most once, subject to normal short-circuit behavior.

The normalized request and native `Request` retain **HEAD**, including inside
middleware, guards, version extraction, conditional resolvers, and handlers.
The selected descriptor still identifies its declared method, such as GET.
Existing conditional-request and byte-range status/header rules therefore
remain active. The adapter returns a null body for every opted-in HEAD response,
including direct sends, route misses, errors, and unavailable/closed 503s,
preserving status, status text, representation headers, and independent cookies.
It does not invent a content length when the selected response did not supply one.

Active response streams are cancelled, then the dispatch lifecycle, iterator
cleanup, and request-scope disposal are awaited. Stream sources must cooperate
with cancellation and settle their iterator `return()`; cleanup failures retain
the dispatcher's observer/logging policy without a GET retry or replacement of
already committed metadata. Application-owned resources that never enter a
response stream remain application-owned. Prefer a `createByteRangeResponse`
stream factory when HEAD must avoid opening a byte source altogether.

**Migration:** remove the application wrapper that reconstructs a HEAD request
as GET and discards its body. Keep the standard
`createNextAppRouterHandler(loadAdapter)` facade. Export only `GET` to let Next
auto-HEAD call it, or export both `GET` and `HEAD`; both use the same policy.
Pages Router uses the same adapter option. Update method-based application
branches that previously observed GET to recognize the original HEAD. No
configuration or behavior change is required for consumers that leave this
option unset.

Evidence: [`head-routing.test.ts`](./src/head-routing.test.ts),
[`head-routing-public-types.test.ts`](./src/head-routing-public-types.test.ts),
and the packaged [Next 16 production E2E](./e2e/next.test.mjs), which compares
auto-HEAD, direct App Router HEAD, and Pages Router HEAD over real HTTP.

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

Applications with both a backend and client stores can declare compiler scope
and output path preservation in the second argument. This example assumes
decorated declarations and DTOs live under `src/backend/`.

```typescript
import {
  type FluoNextBackendOptions,
  withFluoNextBackend,
} from '@fluojs/platform-nextjs/next-config';

const backend = {
  include: 'src/backend/**',
  exclude: '**/*.test.ts',
  preserveModulePaths: true,
} satisfies FluoNextBackendOptions;

export default withFluoNextBackend({}, backend);
```

| Option | Default | Contract |
| --- | --- | --- |
| `include` | Omitted | Restrict eligible paths with a Turbopack path glob or `RegExp`. |
| `exclude` | Omitted | Exclude paths with a Turbopack path glob or `RegExp`. Both it and `include` apply. |
| `preserveModulePaths` | `false` | When `true`, omit `as: '*.js'` to retain the original `.ts` module path. |

Turbopack applies path conditions to project-relative paths under
`turbopack.root` (the Next project by default). The helper does not evaluate
patterns itself. `include`/`exclude` augment the existing
server/application/content conditions; they cannot re-include browser or foreign
dependency files. The existing content condition matches `@` followed by a word
character, so imports and comments can match without decorators. Client-module
SSR is not a browser compilation; declare its boundary with `include` or
`exclude`. The helper does not change the scope of existing user rules.

Omitting the options preserves the existing broad `*.ts` selection and
`as: '*.js'` output rule. With path preservation, the same Babel JavaScript
output is parsed under its original TypeScript filename; no version-specific
`type: 'ecmascript'` option is forced. Include every backend declaration and DTO:
decorated files outside the scope may not work without their own compiler
configuration. Compiler errors propagate through Next dev/build.

In the real Next 16.3.4 fixture, the legacy helper resolves the client store SSR
import as `./store.ts.js`, failing dev GET `/` and the production build.
Scope restriction and path preservation are independent opt-ins. See the
[real Next fixture](./e2e/README.md) for reproduction and version-specific
verification commands within the supported range.

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
- `headRouting`: optional `'explicit-or-get'` selection and bodyless HEAD lifecycle; see [HEAD Routing](#head-routing)
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
  App Router and Pages Router server bundles

Use a Fluo Node or Fastify platform adapter when the application requires raw Node.js transport ownership, WebSocket upgrades, or an independently hosted backend.

## Public API

- `createNextAdapter(options)`: creates the HTTP adapter passed to `FluoFactory.create()`
- `NextAdapterOptions`: adapter-owned request parsing and opt-in HEAD routing options
- `NextAdapterLoader`: dynamic canonical backend adapter loader
- `createNextAppRouterHandler(loadAdapter)`: creates method-keyed App Router handler exports (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`) ready for destructuring
- `NextHttpApplicationAdapter`: `HttpApplicationAdapter` with bound `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS` handlers
- `NextAppRouteHandler`: Web request handler type used by those bound methods
- `NextAppRouterMethodHandlers`: method-keyed App Router record returned by `createNextAppRouterHandler()`
- `createNextPagesRouterHandler(loadAdapter)`: creates a request-lazy streaming Pages Router API handler
- `NextPagesRouterConfig`: type-checks the required static `bodyParser: false` literal
- `withFluoNextBackend(config, options?)`: exported from `@fluojs/platform-nextjs/next-config`; adds the packaged Turbopack decorator loader with opt-in scope/path preservation
- `FluoNextBackendOptions`: `include`, `exclude`, and `preserveModulePaths` option type on the same `next-config` subpath
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
Next.js application through dev/build/start, and verifies both routers and client
store SSR over HTTP without source aliases. See the [fixture guide](./e2e/README.md).
