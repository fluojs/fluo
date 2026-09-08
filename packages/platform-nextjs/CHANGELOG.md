# @fluojs/platform-nextjs

## [Unreleased]

## 1.1.0

### Minor Changes

- [#3730](https://github.com/fluojs/fluo/pull/3730) [`e65604b`](https://github.com/fluojs/fluo/commit/e65604be0e7c1f13f9193761e2196eda8756bf90) Thanks [@ayden94](https://github.com/ayden94)! - Add opt-in bounded text and custom body parsing without rewriting Content-Type
  or reconstructing Requests. HTTP owns BodyParser and BodyParserContext; runtime
  Web helpers implement byte-limited materialization, and Next plus the existing
  Workers Web option inheritance expose it. Custom parsers may delegate unchanged
  MIME behavior with context.parseDefault(). Existing default JSON/multipart and
  HEAD policies remain unchanged. Text mode does not guarantee authentication
  order: authenticate explicitly before application-owned JSON interpretation.

- [#3724](https://github.com/fluojs/fluo/pull/3724) [`6024e63`](https://github.com/fluojs/fluo/commit/6024e6339abc3c20ea0a1615b6e9ae869266f3f6) Thanks [@ayden94](https://github.com/ayden94)! - Add optional `include` and `exclude` Turbopack path conditions to
  `withFluoNextBackend`, plus `preserveModulePaths` to retain original TypeScript
  module paths instead of renaming loader output to JavaScript paths. These
  independent opt-ins prevent unrelated client SSR stores from being transformed
  and avoid the reproduced Next 16.3 SSR import identity failure. Existing helper
  defaults and user rule order remain unchanged.

- [#3727](https://github.com/fluojs/fluo/pull/3727) [`3c715d4`](https://github.com/fluojs/fluo/commit/3c715d467b9c587839c863a98a46b8d7b09318bb) Thanks [@ayden94](https://github.com/ayden94)! - Add opt-in `createNextAdapter({ headRouting: 'explicit-or-get' })` routing for
  Next automatic HEAD and direct HEAD exports. Select explicit HEAD, then ALL,
  then GET before one dispatch, preserve the original HEAD method and response
  metadata, and cancel active response streams before awaiting request cleanup.
  Handler-produced 404 responses never trigger a retry.

  The shared HTTP matcher accepts the corresponding adapter-owned
  `FrameworkRequest.headRouting` field. Existing generic routing and adapters
  without the option retain their defaults; no path wildcard grammar is added.

  Migration: consumers opting in can remove wrappers that rewrite HEAD to GET and
  discard the body. Middleware, guards, and handlers now observe the original
  HEAD instead of that wrapper's GET, so update method-based application branches.

- [#3725](https://github.com/fluojs/fluo/pull/3725) [`b90fba6`](https://github.com/fluojs/fluo/commit/b90fba6836b64160c9c903500a9b5832f7c0427d) Thanks [@ayden94](https://github.com/ayden94)! - Add opt-in `defineNextApplication({ key, load })` for sharing one lazy application
  Promise across Next server bundles in the same JavaScript global. Initialization
  success and failure remain cached; the caller owns shutdown and host restart,
  without automatic retries, HMR replacement, or cross-process sharing.

  Add `publicToken<T>(namespace)` and `PublicToken<T>` in core, with inferred
  `Container.resolve()` results in DI. Tokens retain `Symbol.for` identity and
  existing explicit `useExisting`, module visibility, scope, and class-token
  contracts. Existing lazy handlers keep their per-closure behavior.

### Patch Changes

- Updated dependencies [[`e65604b`](https://github.com/fluojs/fluo/commit/e65604be0e7c1f13f9193761e2196eda8756bf90), [`493b3da`](https://github.com/fluojs/fluo/commit/493b3dacafc247a81193ecfb6bf23387f71358d1), [`3c715d4`](https://github.com/fluojs/fluo/commit/3c715d467b9c587839c863a98a46b8d7b09318bb)]:
  - @fluojs/http@3.1.0

## 1.0.0

### Major Changes

- [#3709](https://github.com/fluojs/fluo/pull/3709) [`296e680`](https://github.com/fluojs/fluo/commit/296e68007178df231d70ceeaba5356b73087f0b0) Thanks [@ayden94](https://github.com/ayden94)! - Release the initial stable 1.0.0 decorator-first Next.js platform for `FluoFactory.create()`, supporting
  App Router Route Handlers and streaming Pages Router API Routes on Next.js 16.x
  (peer `>=16.0.0 <17`), Node.js `>=24.0.0 <27`, and `@fluojs/runtime`
  `>=3.0.0 <4`. Packaged decorator compiler integration uses Turbopack only;
  webpack and Edge Runtime are outside the support contract.

  `createNextAppRouterHandler()` returns one method-keyed handler record
  (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`) that route modules
  destructure directly into named App Router exports.

  Both router facades load the backend lazily on the first request. Application
  code owns Fluo bootstrap and close; Next.js owns the HTTP server and process
  lifecycle. The adapter exposes no raw WebSocket upgrade seam and does not
  extend Next.js routing with additional HTTP methods. Hybrid App/Pages Router
  server bundles each own a lazy Fluo application rather than sharing one
  process-wide singleton.

  Pages requests propagate client disconnects through Fluo's request signal, stop
  waiting on a disconnected lazy request without cancelling shared startup, and
  cancel pending response reads. Demand-driven input preserves raw bytes and
  delivers HTTP 413 before draining the remaining upload without closing the
  host-owned socket.

  Migration: Existing Next.js applications must use Next.js 16.x and Node.js
  `>=24.0.0 <27`, install Fluo runtime 3.x, configure `withFluoNextBackend()`,
  and connect one App Router or Pages Router catch-all to their Fluo backend.
  This is the package's first stable release; it does not provide compatibility
  with Next.js 15, Node.js 20/22, webpack, or Edge Runtime.
