# Package-guide fixtures: Node-hosted platforms

Runnable composition evidence for the four Node-hosted platform package guides:

| Guide (site path) | Package | Fixture file |
| --- | --- | --- |
| `/docs/packages/platform-nodejs` | `@fluojs/platform-nodejs` | `node-adapter.test.ts` |
| `/docs/packages/platform-fastify` | `@fluojs/platform-fastify` | `fastify-adapter.test.ts` |
| `/docs/packages/platform-express` | `@fluojs/platform-express` | `express-adapter.test.ts` |
| `/docs/packages/platform-nextjs` | `@fluojs/platform-nextjs` | `next-adapter.test.ts` |

Guide pages: `apps/docs/content/docs/packages/platform-{nodejs,fastify,express,nextjs}.mdx`.
Shared application under test: `posts-app.ts` (one `AppModule` with
`HealthModule.forRoot()` plus a `PostsModule` that exercises DTO binding,
adapter-level `rawBody`, and buffered multipart files).

## What each fixture proves

- **`node-adapter.test.ts`** — the raw Node adapter serves the full dispatcher
  pipeline over a real `node:http` listener on an OS-assigned port
  (`host: '127.0.0.1', port: 0`); client `x-request-id` values propagate into
  the canonical 404 error envelope (`error.requestId`); `http` + `https`
  options and an out-of-range `port` throw at `create()` before any server
  exists. Composition: `createStaticAssetsMiddleware` (`@fluojs/http`) with
  `createNodeFileSystemAssetSource` (`@fluojs/platform-nodejs`) serves identity
  and precompressed (`.gz`) representations with `Content-Encoding`,
  `Vary: Accept-Encoding`, `Cache-Control` (including the runtime-appended
  `no-transform`), and falls through missing assets to fluo dispatch (404
  envelope). The asset root is an `mkdtemp` temp dir removed in `finally`.
- **`fastify-adapter.test.ts`** — the Fastify adapter serves the same
  application over a real Fastify listener (list/create/health/404 round trip);
  `rawBody: true` replays request bytes byte-exactly (`text` + `byteLength`,
  multibyte payload); buffered multipart materializes an uploaded file into
  the runtime-neutral `context.request.files` seam (`name`, `size`,
  `mimetype`). fluo POST routes answer `201` by default.
- **`express-adapter.test.ts`** — the Express adapter's native-middleware
  boundary over a real listener: a native handler that calls `next()` hands off
  into fluo dispatch (header set by native middleware observable on fluo
  responses); a native handler can end the response without entering fluo
  dispatch; a native `next(error)` stays in the Express error chain and is
  answered by the native error handler (arity 4 — Express identifies error
  middleware by runtime arity), never reaching fluo error filters.
- **`next-adapter.test.ts`** — the Next adapter's real dispatch surface
  (instance `fetch(request)` after `FluoFactory.create` + `app.listen()`,
  which binds the dispatcher without opening a socket): shared-pipeline round
  trips, `503` `application/problem+json` before dispatcher binding
  (`next_backend_adapter_not_ready`) and after `app.close()`
  (`next_backend_adapter_closed`), and opt-in
  `headRouting: 'explicit-or-get'` HEAD responses with a null body. **This
  does not exercise Next.js routing, compilation, or bundling** — that
  boundary is covered by the package's own production E2E
  (`packages/platform-nextjs/e2e/next.test.mjs`); no test here may be cited as
  Next E2E coverage.

All tests: no sleeps or polling; `await app.close()` in `finally`; OS-assigned
ports; no mocks standing in for the transport (raw Node, Fastify, and Express
tests run real listeners; the Next test runs the real adapter dispatch and is
labeled where Next itself is not exercised).

## Verification

Worktree: `docs-foundation`. Node: `v24`-series per repository `engines`
contract. Commands run from the worktree root:

1. `pnpm vitest run --project tooling tooling/docs/fixtures/package-guides/node-platforms --maxWorkers=1`
   → `Test Files 4 passed (4)`, `Tests 13 passed (13)` (three consecutive runs,
   ~1.8–2.3 s each, stable).
2. Red run before fixes (recorded honestly): 3 of 13 failed on asserted
   response details — fluo POST routes default to `201` (two assertions),
   and the static middleware emits `cache-control: public, max-age=3600,
   no-transform`. Assertions were corrected to the observed contract; no
   runtime code was changed to make tests pass.
3. A third failure mode was found and fixed in the fixture itself, not the
   packages: the native Express error handler was declared with three
   parameters, so Express registered it as regular middleware (Express selects
   error middleware by arity) and it answered `500` for every request reaching
   it while `next(error)` fell through to Express's default HTML handler.
   Restoring runtime arity 4 fixed both symptoms.
4. Typecheck: `pnpm exec tsc -p tsconfig.tools.json --noEmit` → 0 errors under
   `tooling/docs/fixtures/package-guides/node-platforms`. Remaining errors in
   the tools project are outside this track (sibling workstream
   `tooling/docs/fixtures/package-guides/foundation/**`).
5. Lint/LSP: `pnpm exec biome check tooling/docs/fixtures/package-guides/node-platforms`
   → clean (no fixes applied); LSP diagnostics on the directory → 0.
6. Scope: `git status --porcelain tooling/docs/fixtures/package-guides/node-platforms`
   shows only this directory as new; `apps/docs/content/docs/packages/` gained
   only the four owned `platform-*.mdx` files. No navigation/meta/index/config
   or package manifests touched; no commits made.

## Source and contract references

- `packages/platform-nodejs/src/node/internal-node.ts` — `NodeHttpApplicationAdapter.create`
  validation (port range, non-negative integer options, `http`/`https`
  exclusivity), listen retry lifecycle, close/drain, `getListenTarget`.
- `packages/platform-nodejs/src/node/internal-node-shutdown.ts` — signal
  registration, rollback, unregister aggregation, `process.exitCode` semantics.
- `packages/platform-nodejs/src/node/internal-node-response.ts` —
  `writeNodeAdapterErrorResponse` → `createErrorResponse(httpError, requestId)`
  (`packages/http/src/exceptions.ts`) — the `error.requestId` envelope field
  asserted in `node-adapter.test.ts`.
- `packages/platform-nodejs/src/node/node-static-assets.ts` +
  `packages/http/src/static-assets.ts` — filesystem source (realpath/
  `O_NOFOLLOW`/dev-ino checks, precompressed sibling selection) and middleware
  (dotfile default `ignore`, fall-through on miss, `Cache-Control`/`Vary`).
- `packages/platform-fastify/src/adapter.ts` — `FastifyAdapterOptions`
  (defaults: port `3000`, `maxBodySize` 1 MiB, `retryDelayMs` 150,
  `retryLimit` 20, `shutdownTimeoutMs` 10_000), native-route fast path +
  wildcard fallback, `configureFastify` seam timing, raw-body/multipart
  handling, listen/close concurrency rules.
- `packages/platform-express/src/adapter.ts` — `ExpressAdapterOptions` with
  `nativeMiddleware` (`RequestHandler | ErrorRequestHandler`) mounted in array
  order before the adapter Router and catch-all dispatch; safe-fallback and
  parity rules; `ExpressServer`/`getListenTarget` seams.
- `packages/platform-nextjs/src/{adapter,app-router,pages-router,lazy-adapter,next-config,application-accessor}.ts`
  — Web dispatch with `503` problem states, opt-in HEAD routing, closure
  loader memoization, Pages bridge contract (`bodyParser: false`), Turbopack
  rule wiring, keyed process-local accessor.
- `packages/runtime/src/types.ts` / `bootstrap.ts` — `FluoFactory.create`
  option surface (`cors`, `globalPrefix`, `middleware`, `securityHeaders`,
  `logger`, `shutdownRegistration`) and startup log lines
  (`FluoFactory Listening on …`, `fluo application successfully started.`).
- `packages/http/src/types.ts` — portable `FrameworkRequest.rawBody: Uint8Array`
  and `FrameworkRequestFile` (`fieldname`/`originalname`/`mimetype`/`buffer`/`size`).

## Not executed here (left to owning verification)

- Real Next.js dev/build/start behavior, Turbopack compilation of decorated
  backend files, and hybrid App+Pages bundling — covered by
  `packages/platform-nextjs/e2e/next.test.mjs` (requires `next` 16 install +
  production build; not run in this track).
- HTTPS/TLS listeners, `EADDRINUSE` retry exhaustion, forced-close after
  `shutdownTimeoutMs`, streaming multipart (`strategy: 'stream'`), early hints
  over the wire, and server-backed realtime upgrades — contract-covered by the
  packages' own suites (`HttpAdapterPortabilityHarness` targets listed in each
  package README); this track exercises the documented compositions instead of
  duplicating conformance harnesses.
- Publication gate items (docs production build, rendered desktop/mobile
  review, manifest/CI wiring) are lead-owned.
