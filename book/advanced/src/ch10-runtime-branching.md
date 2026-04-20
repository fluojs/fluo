<!-- packages: @fluojs/runtime, @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: T16 Part 3 source-analysis draft for runtime branching across root, Node, and Web-standard execution surfaces -->

# 10. Runtime Branching: Node vs Web vs Edge

## 10.1 Fluo branches by package surface and adapter seams more than by giant runtime conditionals
By the time you reach Chapter 10, the most important realization is that Fluo's runtime portability is not driven by one giant `if (isNode) ... else if (isEdge) ...` block. The branch points are narrower and more architectural.

Most of the core bootstrap logic in `path:packages/runtime/src/bootstrap.ts:920-1202` is transport-neutral. It compiles module graphs, creates a DI container, registers runtime tokens, resolves lifecycle instances, runs hooks, and builds an application shell. None of that code asks whether it is running in Node, on the Web platform, or on an edge runtime.

The actual branching happens at the seams where host-specific capabilities matter. Those seams are visible in three places:
1. **Export Map**: The package export map decides which helpers are public on each subpath.
2. **Transport Adapters**: Adapters decide how raw requests and responses become framework objects.
3. **Orchestration**: Shutdown and server orchestration helpers live in host-specific files rather than the root runtime barrel.

Fluo keeps the common runtime shell centralized, then branches only at explicit surface boundaries. You can see this encoded in `path:packages/runtime/src/exports.test.ts:12-79`. The tests insist that the root barrel stays transport-neutral, Node-only helpers live on `./node`, and Web helpers on `./web`.

## 10.2 The root runtime barrel is intentionally transport-neutral and the export map enforces it
The root public surface, defined in `path:packages/runtime/src/index.ts:1-30`, exports bootstrap APIs, errors, diagnostics, and selected runtime tokens like `APPLICATION_LOGGER`. It does **not** export Node adapter helpers or Web request-dispatch helpers.

`path:packages/runtime/src/exports.test.ts:13-29` verifies this strictly. The root barrel must not expose `dispatchWebRequest` or `bootstrapHttpAdapterApplication`. This curation ensures that application logic depends only on what every host can rely on.

The package export map in `path:packages/runtime/package.json:27-56` makes this curation enforceable. It declares explicit subpaths:
- `.` (Portable root)
- `./node` (Node-specific)
- `./web` (Web-standard)
- `./internal/*` (Low-level seams)

This prevents accidental use of host-specific files through deep imports. If application code imports a Node helper, the import path itself declares the portability cost.

## 10.3 The Node branch packages server lifecycle, retries, compression, and shutdown
The public Node entrypoint in `path:packages/runtime/src/node.ts` is a curated façade over `path:packages/runtime/src/node/internal-node.ts`. Here, the runtime deals with capabilities that the root cannot assume: Node HTTP/HTTPS servers, sockets, listen retry behavior, and process-signal shutdown.

`NodeHttpApplicationAdapter` at `path:packages/runtime/src/node/internal-node.ts:108-194` is the core transport object. It owns the native server and tracks connections for drain-aware shutdown.
- **Listen with Retry**: `listenNodeServerWithRetry()` at `path:packages/runtime/src/node/internal-node.ts:294-320` retries `EADDRINUSE` failures.
- **Graceful Shutdown**: `closeNodeServerWithDrain()` at `path:packages/runtime/src/node/internal-node.ts:335-368` closes idle connections and force-closes sockets after a timeout.

`createNodeHttpAdapter()` packages these concerns into a portable `HttpApplicationAdapter`. `bootstrapNodeApplication()` then feeds this into the shared HTTP bootstrap path. Node-specific convenience does not smuggle ambient configuration; `path:packages/runtime/src/node/node.test.ts:14-48` shows the adapter defaults to port `3000` unless explicitly told otherwise.

## 10.4 The Web and Edge branch reuse the Web-standard Request/Response seam
The Web branch in `path:packages/runtime/src/web.ts:1-606` normalizes native Web `Request` and `Response` objects into Fluo's framework contract. The key APIs are `createWebRequestResponseFactory()` and `dispatchWebRequest()`.

`createWebFrameworkRequest()` performs the actual normalization:
- URL parsing and header mapping
- Cookie and multipart payload handling
- Body content resolution (JSON, Text, Form)
- SSE-friendly streaming via `WebResponseStream`

`path:packages/runtime/src/web.test.ts:7-146` verifies that this branch translates native `Request` into the framework shape, serializes errors into native `Response` objects, and enforces size limits on streaming bodies.

This normalization seam is how Fluo supports Edge runtimes (Cloudflare Workers, Deno, Bun). If the host gives you Web-standard `Request` and `Response` objects, the Web seam is the branch you attach to. Fluo doesn't need a dedicated `edge.ts` because Edge is conceptually a specialization of the Web-standard path.

## 10.5 Shared request/response factories: The narrow bridge
The file that makes the whole branching story click is `path:packages/runtime/src/adapters/request-response-factory.ts`. This is the host-agnostic bridge between raw I/O and the framework dispatcher.

The `RequestResponseFactory` interface requires five operations:
1. Create framework request from raw request.
2. Create abort signal from host primitive.
3. Create framework response.
4. Resolve request ID.
5. Write error response.

`dispatchWithRequestResponseFactory()` then handles the logic of creating the response, deriving the signal, creating the request, and invoking the dispatcher. This helper is the real anti-duplication seam. Node and Web branches do not re-implement dispatcher invocation or error fallback; they only supply different factories.

- **Node Factory**: `createNodeRequestResponseFactory()` at `path:packages/runtime/src/node/internal-node.ts:196-238`.
- **Web Factory**: `createWebRequestResponseFactory()` at `path:packages/runtime/src/web.ts:246-274`.

Both return the same interface. This ensures that host-specific divergence is narrow and explicit while higher-level behavior—module graph, container, lifecycle hooks, and dispatcher—remains identical across all environments. Fluo's runtime branching works because the framework branches late, at narrow transport seams, after most of the system has already become host-agnostic.
